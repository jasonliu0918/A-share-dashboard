# -*- coding: utf-8 -*-
"""
生成 assets/amt3d.js —— A股近若干交易日「合计成交额」(指数口径：上证+深证+北证50)。

在 GitHub Actions(境外 runner)里跑，用 requests 直连东财日K线接口取历史成交额。
和前端「今天实时 f48」同源同口径(东财指数成交额，单位元)，避免口径漂移。
已实测：GitHub 境外 runner 能正常访问 push2his.eastmoney.com。

数据结构(assets/amt3d.js)：
  window.AMT3D_DATA = {
    "updatedAt": "2026-09-04T13:02:31Z",
    "unit": "元",
    "source": "eastmoney_kline",
    "days": [ {"date":"2026-09-02","amountYuan":1.23e12,"parts":{"sh":.,"sz":.,"bj":.}}, ... ]  # 旧->新
  }

沪或深任一市场拉不到则以非零码退出，让 Actions 明确报错、不写脏数据。
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# 与前端 fetchAndRenderAmt3d 完全一致的三个指数
INDICES = {
    "sh": "1.000001",  # 上证指数
    "sz": "0.399001",  # 深证成指
    "bj": "0.899050",  # 北证50
}

# 东财主机：K线属历史数据，push2his 优先；其余兜底
HOSTS = [
    "push2his.eastmoney.com",
    "push2.eastmoney.com",
    "82.push2.eastmoney.com",
    "push2delay.eastmoney.com",
]

KEEP_DAYS = 30      # 前端只用 3 天，多保留便于排查/节假日/回滚
FETCH_LMT = 60      # 多拉一些交易日做缓冲
HOST_RETRIES = 2    # 东财对境外/数据中心 IP 偶发限流，单主机适度重试（过多反而更易被封）
RUN_RETRIES = 2     # 整轮重试（沪或深缺失时）

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://quote.eastmoney.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

OUT_PATH = Path(__file__).resolve().parent.parent / "assets" / "amt3d.js"


def fetch_index_daily(secid: str):
    """拉单个指数最近 FETCH_LMT 个交易日的 (date, amountYuan)。多主机兜底。"""
    # fields2 只取 f51(日期) 和 f57(成交额/元)，klines 每行就是 "date,amount"
    params = {
        "secid": secid,
        "klt": "101",      # 日线
        "fqt": "0",
        "end": "20500000",
        "lmt": str(FETCH_LMT),
        "fields1": "f1",
        "fields2": "f51,f57",
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
    }
    last_err = None
    for host in HOSTS:
        url = f"https://{host}/api/qt/stock/kline/get"
        for attempt in range(1, HOST_RETRIES + 1):
            try:
                r = requests.get(url, params=params, headers=HEADERS, timeout=20)
                r.raise_for_status()
                data = (r.json() or {}).get("data") or {}
                klines = data.get("klines") or []
                out = {}
                for line in klines:
                    parts = line.split(",")
                    if len(parts) < 2:
                        continue
                    date = parts[0]
                    try:
                        amt = float(parts[1])
                    except ValueError:
                        continue
                    if amt > 0:
                        out[date] = amt
                if out:
                    print(f"[ok] {secid} via {host} (try {attempt}): {len(out)} 天")
                    return out
                print(f"[warn] {secid} via {host} (try {attempt}): 返回空 klines")
            except Exception as e:  # noqa: BLE001
                last_err = e
                print(f"[fail] {secid} via {host} (try {attempt}): {e}")
            time.sleep(1.5 * attempt)  # 退避
    print(f"[error] {secid}: 所有主机都失败 (last={last_err})")
    return {}


def main() -> int:
    sh = sz = bj = {}
    for run in range(1, RUN_RETRIES + 1):
        sh = fetch_index_daily(INDICES["sh"])
        sz = fetch_index_daily(INDICES["sz"])
        bj = fetch_index_daily(INDICES["bj"])
        if sh and sz:
            break
        print(f"[retry] 第 {run} 轮沪或深缺失，{6*run}s 后重试整轮…")
        time.sleep(6 * run)

    # 主要市场(沪、深)缺失：软失败——不写、不提交，保留仓库既有 amt3d.js。
    # 以 0 退出，避免东财对境外 IP 偶发限流时 Actions 频繁标红；数据是否更新看 amt3d.js 的 commit。
    if not sh or not sz:
        print("[skip] 上证或深证成交额缺失（重试后仍失败，可能被东财限流）。"
              "保留仓库既有 amt3d.js，本次不更新。")
        return 0

    # 以沪、深都存在的日期为准；北证50 缺失则按 0 计入(占比极小)
    dates = sorted(set(sh) & set(sz))
    if not dates:
        print("[error] 沪深无共同交易日。")
        return 1

    days = []
    for d in dates:
        s, z, b = sh.get(d, 0.0), sz.get(d, 0.0), bj.get(d, 0.0)
        days.append({
            "date": d,
            "amountYuan": s + z + b,
            "parts": {"sh": s, "sz": z, "bj": b},
        })

    days = days[-KEEP_DAYS:]  # 旧 -> 新

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "unit": "元",
        "source": "eastmoney_kline",
        "days": days,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(
        "// 自动生成，请勿手改。由 scripts/update_amt3d.py 每交易日收盘后更新。\n"
        f"window.AMT3D_DATA = {body};\n",
        encoding="utf-8",
    )
    latest = days[-1]
    print(f"[done] 写入 {OUT_PATH.name}: {len(days)} 天，最新 {latest['date']} "
          f"合计 {latest['amountYuan']/1e8:.0f} 亿")
    return 0


if __name__ == "__main__":
    sys.exit(main())
