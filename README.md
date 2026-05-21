# A股指数实时看板

> 项目代号：**A股指数实时看板**（位置：`D:\work-AI\codex\成交量实时数据网页\`）

显示 **上证指数 / 深证成指 / 北证50** 的价格、涨跌、成交额、成交量、涨跌家数，以及三大指数汇总和集思录 A股温度。

## 用法

**直接双击 `index.html`，用 Chrome 打开即可。**

不需要启动任何服务。Python 脚本是"数据后台刷新器"，由 Windows 任务计划自动跑，不用手动操心。

## 数据时效行为

| 场景 | 显示内容 |
|---|---|
| 盘中（9:30–11:30, 13:00–15:00） | 实时价格 + 当日累计成交额/量（3 秒刷新）|
| 盘后 | 当日收盘价 + 当日总成交额/量 |
| 非交易日（周末 / 节假日） | 最近一个交易日的收盘数据（卡片标注交易日日期）|

## 文件清单

| 文件 | 作用 |
|---|---|
| `index.html` | 主页面骨架，引用拆分后的样式和脚本 |
| `assets/styles.css` | 页面样式 |
| `assets/trading-calendar.js` | A股交易日历，当前内置 2026 年交易所休市安排 |
| `assets/data-interfaces.js` | 行情、广度、分时、K 线等数据接口 |
| `assets/status-logic.js` | 本地配置、选中指数、市场状态判定 |
| `assets/render.js` | 卡片、汇总、温度、分时图等渲染函数 |
| `assets/app.js` | 启动、定时刷新、设置面板和接口/渲染编排 |
| `jsl_temperature.js` | 集思录 A股温度快照，可由 GitHub Actions 自动生成 |
| `.github/workflows/update-jsl-temperature.yml` | 云端自动刷新集思录温度并提交数据文件 |
| `assets/remote-data-config.js` | 可选远程数据地址，本地打开也能加载云端最新版 |
| `assets/jsl-remote-loader.js` | 加载远程 `jsl_temperature.js`，并优先使用更新的数据 |
| `gen_jsl_temperature.py` | 刷新集思录温度（由 schtasks 定时跑）|
| `tools/validate.mjs` | 本地轻量验证：HTML 引用、JS 语法、数据结构、Python 编译 |
| `项目总结.md` | 完整项目文档 |

## 集思录温度自动更新

浏览器无法稳定直连集思录的 POST 接口读取结果，所以项目改为“云端自动生成静态 JS”：

1. 把项目推到 GitHub。
2. 在仓库 Settings → Actions → General 里允许 workflow 写入仓库。
3. GitHub Actions 会在交易日上午和下午各刷新一次 `jsl_temperature.js`。
4. 如果用 GitHub Pages 打开页面，会自然读到更新后的同仓库数据。

如果仍然是本地双击 `index.html`，但希望读取 GitHub Pages 上的最新版，把 `assets/remote-data-config.js` 里的地址改成你的 Pages 地址：

```
window.JSL_TEMPERATURE_REMOTE_URL = "https://你的用户名.github.io/你的仓库名/jsl_temperature.js";
```

## 运行 Python 脚本

**Windows 上必须用 `py`，不能用 `python`**（Store 自带的 `python` 是占位 shim，exit 49 不输出）：

```
py gen_jsl_temperature.py
```

日常不需要在本机跑 `gen_jsl_temperature.py`；它主要给 GitHub Actions 或手动排查使用。

## 本地验证

改完前端或数据脚本后，可以跑一次：

```
node tools/validate.mjs
```

验证内容包括：HTML 引用的本地资源是否存在、看板 JS 是否可解析、`jsl_temperature.js` 结构是否正常、Python 脚本是否可编译。

需要巡检外部接口字段是否仍符合预期时，使用联网检查：

```
node tools/validate.mjs --live
```

页面运行时仍会在内部记录接口契约状态，便于调试字段变更；接口健康卡片默认不显示。

## 交易日历

市场状态优先使用 `assets/trading-calendar.js` 的 A 股休市日历。当前录入 2026 年上交所年度休市安排：元旦、春节、清明、劳动节、端午、中秋、国庆及公告中的周末休市日。未覆盖年份会退回到“工作日开市、周末休市”的粗略判断，并在状态标题中标注。

## 数据来源

- **东方财富 push2 / clist / trends2**（JSONP，无需 key）：指数行情、个股涨跌幅、分时走势
- **腾讯 qt.gtimg.cn**（JSONP，兜底）：指数行情备用
- **集思录 get_last_indicator**（Python POST，公开接口无需 cookie）：官方口径 A股温度
