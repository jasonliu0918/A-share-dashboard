"""
抓取集思录首页 A股温度，写成 jsl_temperature.js 供看板前端引入

集思录的 get_last_indicator 接口是公开的，无需登录/cookie。
前端因 CORS 无法直连，所以用这个脚本抓好后落成静态 JS 文件，看板 <script> 引入即可。

用法：py gen_jsl_temperature.py  （需要刷新时手动跑一下，然后刷新网页）
"""
import json
from pathlib import Path

import requests

URL = "https://www.jisilu.cn/data/indicator/get_last_indicator/"


def main():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.jisilu.cn/",
        "Origin": "https://www.jisilu.cn",
    }
    resp = requests.post(URL, headers=headers, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    temp = data.get("median_pb_temperature")
    if temp is None:
        raise RuntimeError(f"未返回 median_pb_temperature，接口可能已改版。返回键: {list(data)[:15]}")

    import datetime as dt
    out = {
        "temperature": float(temp),
        "priceDate": data.get("price_dt"),
        "medianPb": float(data["median_pb"]) if data.get("median_pb") is not None else None,
        "medianPe": float(data["median_pe"]) if data.get("median_pe") is not None else None,
        "medianPeTemperature": float(data["median_pe_temperature"]) if data.get("median_pe_temperature") is not None else None,
        "fetchedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    path = Path(__file__).parent / "jsl_temperature.js"
    path.write_text(
        "window.JSL_TEMPERATURE = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"[ok] 集思录 A股温度 = {temp}  (价格日期 {out['priceDate']})")
    print(f"[ok] 已写入 {path}")


if __name__ == "__main__":
    main()
