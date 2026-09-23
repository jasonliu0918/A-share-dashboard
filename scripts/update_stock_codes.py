# -*- coding: utf-8 -*-
"""
生成 assets/stock_codes.js —— 全市场 A 股代码清单(按市场分组,腾讯代码格式)。

来源:上交所/深交所/北交所**官方**股票列表(经 akshare),完全不依赖东财 clist。
所以即使东财 clist 故障,这份清单照常能生成,前端腾讯翻页兜底(涨跌家数 + 原始总市值)
就一直可用。GitHub Actions(境外 runner)访问交易所官网通常正常。

输出结构(assets/stock_codes.js):
  window.STOCK_CODES = {
    "updatedAt": "...",
    "source": "exchange_official",
    "counts": {"000001": 2400, "399001": 2900, "899050": 260},
    "markets": {
      "000001": ["sh600000",...,"sh688001",...],   # 沪A(主板+科创板)
      "399001": ["sz000001",...,"sz300001",...],    # 深A(主板+创业板)
      "899050": ["bj430047",...]                    # 北A(全北交所)
    }
  }
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import akshare as ak

OUT_PATH = Path(__file__).resolve().parent.parent / "assets" / "stock_codes.js"


def _code_col(df):
    """找出 DataFrame 里的"代码"列名。"""
    for c in df.columns:
        if "代码" in str(c):
            return c
    raise KeyError(f"找不到代码列: {list(df.columns)}")


def _norm(codes, prefix):
    out, seen = [], set()
    for c in codes:
        s = str(c).strip()
        if not s or not s.isdigit():
            continue
        s = s.zfill(6)
        qc = prefix + s
        if qc not in seen:
            seen.add(qc)
            out.append(qc)
    return out


def _retry(fn, tries=3, gap=3):
    last = None
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"  重试 {i+1}/{tries} 失败: {e}")
            time.sleep(gap * (i + 1))
    raise last


def sh_codes():
    codes = []
    for sym in ("主板A股", "科创板"):
        df = _retry(lambda s=sym: ak.stock_info_sh_name_code(symbol=s))
        codes += list(df[_code_col(df)])
    return _norm(codes, "sh")


def sz_codes():
    df = _retry(lambda: ak.stock_info_sz_name_code(symbol="A股列表"))
    return _norm(list(df[_code_col(df)]), "sz")


def bj_codes():
    df = _retry(lambda: ak.stock_info_bj_name_code())
    return _norm(list(df[_code_col(df)]), "bj")


def main() -> int:
    markets = {}
    for mkt, fn in (("000001", sh_codes), ("399001", sz_codes), ("899050", bj_codes)):
        try:
            codes = fn()
            print(f"[ok] {mkt}: {len(codes)} 只")
            markets[mkt] = codes
        except Exception as e:  # noqa: BLE001
            print(f"[fail] {mkt}: {e}")
            markets[mkt] = []

    # 沪、深必须成功(北交所可选)。软失败:保留仓库既有清单,不写脏数据。
    if not markets.get("000001") or not markets.get("399001"):
        print("[skip] 沪或深官方列表缺失,保留既有清单,本次不更新。")
        return 0

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "exchange_official",
        "counts": {k: len(v) for k, v in markets.items()},
        "markets": markets,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(
        "// 自动生成,请勿手改。由 scripts/update_stock_codes.py 每周更新(来源:交易所官方列表)。\n"
        f"window.STOCK_CODES = {body};\n",
        encoding="utf-8",
    )
    print(f"[done] 写入 {OUT_PATH.name}: " +
          ", ".join(f"{k}={len(v)}" for k, v in markets.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
