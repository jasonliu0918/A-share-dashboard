# -*- coding: utf-8 -*-
"""
生成 assets/stock_codes.js —— 全市场 A 股代码清单(按市场分组,腾讯代码格式)。

用途:当客户端东财 clist(涨跌家数/总市值来源)被网络屏蔽/故障时,
前端改用腾讯批量个股行情翻页,本地统计涨跌家数 + 原始总市值。
翻页需要一份"全市场代码清单",而这份清单本身也依赖 clist,
所以放到 GitHub Actions 服务端每周生成一次(境外 runner 通常能访问东财)。

输出结构(assets/stock_codes.js):
  window.STOCK_CODES = {
    "updatedAt": "...",
    "counts": {"000001": 2400, "399001": 2900, "899050": 260},
    "markets": {
      "000001": ["sh600000","sh600001",...,"sh688001",...],   # 沪A(主板+科创板)
      "399001": ["sz000001",...,"sz300001",...],              # 深A(主板+创业板)
      "899050": ["bj430047",...]                              # 北A(全北交所)
    }
  }
  # 科创板(000688)= 沪A 里 sh68* 派生;创业板(399006)= 深A 里 sz30*/sz301* 派生(前端处理)

沪或深任一失败则软退出(exit 0)、保留仓库既有清单,不写脏数据。
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# 市场 → (东财 fs, 腾讯前缀)
MARKETS = {
    "000001": ("m:1+t:2,m:1+t:23", "sh"),   # 沪A:主板+科创板
    "399001": ("m:0+t:6,m:0+t:80", "sz"),   # 深A:主板+创业板
    "899050": ("m:0+t:81+s:2048", "bj"),    # 北A:全北交所
}

HOSTS = [
    "push2.eastmoney.com",
    "push2delay.eastmoney.com",
    "82.push2.eastmoney.com",
    "pushguest.eastmoney.com",
]
HOST_RETRIES = 2
PAGE = 100

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://quote.eastmoney.com/",
    "Accept": "application/json, text/plain, */*",
}

OUT_PATH = Path(__file__).resolve().parent.parent / "assets" / "stock_codes.js"


def _get_page(fs, pn):
    params = {
        "pn": pn, "pz": PAGE, "po": 1, "np": 1, "fltt": 2, "invt": 2,
        "fid": "f12", "fs": fs, "fields": "f12", "ut": "bd1d9ddb04089700cf9c27f6f7426281",
    }
    last = None
    for host in HOSTS:
        for attempt in range(HOST_RETRIES):
            try:
                r = requests.get(f"https://{host}/api/qt/clist/get",
                                 params=params, headers=HEADERS, timeout=20)
                r.raise_for_status()
                data = (r.json() or {}).get("data")
                if data is None:
                    raise ValueError("data=null")
                return data
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"page {pn} 全主机失败: {last}")


def fetch_market_codes(fs, prefix):
    codes = []
    pn = 1
    total = None
    while pn <= 80:
        data = _get_page(fs, pn)
        if total is None:
            total = int(data.get("total") or 0)
        rows = data.get("diff") or []
        if not rows:
            break
        for r in rows:
            code = str(r.get("f12") or "").strip()
            if code:
                codes.append(prefix + code)
        if pn * PAGE >= (total or 0):
            break
        pn += 1
        time.sleep(0.2)
    # 去重保序
    seen = set()
    uniq = [c for c in codes if not (c in seen or seen.add(c))]
    return uniq


def main() -> int:
    markets = {}
    for mkt, (fs, prefix) in MARKETS.items():
        try:
            codes = fetch_market_codes(fs, prefix)
            print(f"[ok] {mkt} ({prefix}): {len(codes)} 只")
            markets[mkt] = codes
        except Exception as e:  # noqa: BLE001
            print(f"[fail] {mkt}: {e}")
            markets[mkt] = []

    # 沪、深必须成功(北交所可选)。软失败：clist 故障时不写脏数据、以 0 退出，
    # 保留仓库既有清单;等 clist 恢复的下一次定时任务再生成。
    if not markets.get("000001") or not markets.get("399001"):
        print("[skip] 沪或深代码清单缺失(clist 故障/限流)。保留既有清单,本次不更新。")
        return 0

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": {k: len(v) for k, v in markets.items()},
        "markets": markets,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(
        "// 自动生成,请勿手改。由 scripts/update_stock_codes.py 每周更新。\n"
        f"window.STOCK_CODES = {body};\n",
        encoding="utf-8",
    )
    print(f"[done] 写入 {OUT_PATH.name}: " +
          ", ".join(f"{k}={len(v)}" for k, v in markets.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
