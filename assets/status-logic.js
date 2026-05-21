// 状态逻辑与本地配置
// 从 index.html 拆分；保持浏览器普通脚本加载方式，共享全局作用域。

// ===== 全部支持的指数 =====
const ALL_TARGETS = [
  { code: "000001", name: "上证指数", secid: "1.000001", qq: "sh000001", group: "main" },
  { code: "399001", name: "深证成指", secid: "0.399001", qq: "sz399001", group: "main" },
  { code: "899050", name: "北证50",   secid: "0.899050", qq: "bj899050", group: "main" },
  { code: "000300", name: "沪深300", secid: "1.000300", qq: "sh000300", group: "extra" },
  { code: "399006", name: "创业板指", secid: "0.399006", qq: "sz399006", group: "extra" },
  { code: "000688", name: "科创50",   secid: "1.000688", qq: "sh000688", group: "extra" },
];

// ===== 配置管理 =====
const CFG_KEY = "dashboard_cfg_v2";
const DEFAULT_CFG = {
  interval: 3000,
  source: "em",
  visible: ["000001", "399001", "899050", "000300", "399006", "000688"],
  showMini: true,
  showExtraGroup: true,
  miniInterval: 30,
};
function loadCfg() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...DEFAULT_CFG };
    const c = JSON.parse(raw);
    return { ...DEFAULT_CFG, ...c };
  } catch { return { ...DEFAULT_CFG }; }
}
function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
let CFG = loadCfg();

const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const marketBadge = document.getElementById("market-badge");
const lastAmount = {};
const miniCache = {}; // { code: { points: [[t,price]], prev, lastFetch } }

function activeTargets() {
  return ALL_TARGETS.filter(t => CFG.visible.includes(t.code));
}

function dateToYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getAshareCalendarStatus(date = new Date()) {
  const ymd = dateToYmd(date);
  const dow = date.getDay();
  const year = date.getFullYear();
  const cal = typeof A_SHARE_TRADING_CALENDAR !== "undefined" ? A_SHARE_TRADING_CALENDAR : null;
  const hasYear = !!(cal && cal.meta && Array.isArray(cal.meta.years) && cal.meta.years.includes(year));
  const isWeekend = dow === 0 || dow === 6;
  const isClosedByCalendar = !!(cal && cal.closedDates && cal.closedDates.has(ymd));
  if (hasYear) {
    return {
      ymd,
      isTradingDay: !isWeekend && !isClosedByCalendar,
      known: true,
      reason: isClosedByCalendar ? "交易所休市日" : (isWeekend ? "周末休市" : "交易日"),
    };
  }
  return {
    ymd,
    isTradingDay: !isWeekend,
    known: false,
    reason: isWeekend ? "周末休市" : "交易日历未覆盖，按工作日兜底",
  };
}

function shouldAutoRefreshMarket(market, now = new Date()) {
  if (!market || !market.isTradingDay) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 9 * 60 + 25 && minutes <= 15 * 60 + 1;
}

// ===== 市场状态判定 =====
// 返回 { kind: "preopen"|"live"|"close"|"rest", label, title }
// - live: 今天且在交易时段
// - close: 今天且已收盘（15:00 之后）
// - rest: 周末/节假日/数据是之前交易日
function classifyMarket(items) {
  const now = new Date();
  const cal = getAshareCalendarStatus(now);
  const todayStr = cal.ymd;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const inMorning = minutes >= 9*60+30 && minutes < 11*60+30;
  const inAfternoon = minutes >= 13*60 && minutes < 15*60;
  const afterClose = minutes >= 15*60;

  // 检查是否有任一指数的 trade_date 是今天
  const anyToday = items.some(it => it.trade_date === todayStr);
  const latest = items.map(it => it.trade_date).filter(Boolean).sort().pop();

  if (!cal.isTradingDay) {
    return {
      kind: "rest",
      label: latest ? `休市 · 上一交易日 ${latest}` : "休市",
      title: `${cal.reason}${cal.known ? "" : "（交易日历未覆盖）"}`,
      isTradingDay: false,
      calendarKnown: cal.known,
    };
  }

  if (anyToday && (inMorning || inAfternoon)) {
    return { kind: "live", label: "● 盘中交易", title: "正在交易时段", isTradingDay: true, calendarKnown: cal.known };
  }
  if (anyToday && afterClose) {
    return { kind: "close", label: "● 今日收盘", title: "已收盘，显示当日收盘数据", isTradingDay: true, calendarKnown: cal.known };
  }
  if (!anyToday && minutes < 9*60+30) {
    return {
      kind: "preopen",
      label: latest ? `盘前 · 上一交易日 ${latest}` : "盘前",
      title: "交易日盘前，等待今日行情",
      isTradingDay: true,
      calendarKnown: cal.known,
    };
  }
  if (anyToday) {
    return { kind: "close", label: "● 今日收盘", title: "交易日数据", isTradingDay: true, calendarKnown: cal.known };
  }
  return {
    kind: "rest",
    label: latest ? `数据延迟 · 上一交易日 ${latest}` : "等待行情",
    title: "今天是交易日，但行情接口尚未返回今日交易日",
    isTradingDay: true,
    calendarKnown: cal.known,
  };
}

function renderMarketBadge(items) {
  const m = classifyMarket(items);
  marketBadge.className = "market-badge " + m.kind;
  marketBadge.textContent = m.label;
  marketBadge.title = m.title;
}
