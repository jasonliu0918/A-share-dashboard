"""
生成 A股温度历史分布文件（给前端看板用）

输出：pb_history.js  —— 暴露 window.PB_HISTORY
  {
    sorted10y:  [...],   // 近10年 PB 中位数序列，升序
    sortedAll:  [...],   // 全历史
    meta: { start, end, count10y, countAll, generated, latestPb }
  }

口径：全A 等权 PB 中位数（akshare stock_a_all_pb 的 middlePB 字段）
用法：每天（或按需）重新运行一次，更新 pb_history.js
"""
import json
from pathlib import Path

import akshare as ak
import pandas as pd


def main():
    df = ak.stock_a_all_pb()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)

    s_all = df["middlePB"].astype(float)
    cutoff = df["date"].iloc[-1] - pd.DateOffset(years=10)
    s_10y = df.loc[df["date"] >= cutoff, "middlePB"].astype(float)

    out = {
        "sortedAll": sorted(round(float(x), 4) for x in s_all),
        "sorted10y": sorted(round(float(x), 4) for x in s_10y),
        "meta": {
            "start": df["date"].iloc[0].strftime("%Y-%m-%d"),
            "end": df["date"].iloc[-1].strftime("%Y-%m-%d"),
            "countAll": int(len(s_all)),
            "count10y": int(len(s_10y)),
            "latestPb": round(float(s_all.iloc[-1]), 4),
            "generated": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    }

    path = Path(__file__).parent / "pb_history.js"
    js = "window.PB_HISTORY = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    path.write_text(js, encoding="utf-8")
    print(f"已写入 {path}")
    print(f"  全历史 {out['meta']['start']} ~ {out['meta']['end']}, 共 {out['meta']['countAll']} 日")
    print(f"  近10年 {out['meta']['count10y']} 日, 最新 PB 中位数 {out['meta']['latestPb']}")


if __name__ == "__main__":
    main()
