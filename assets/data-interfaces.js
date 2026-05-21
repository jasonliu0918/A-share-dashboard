// 数据接口
// 从 index.html 拆分；保持浏览器普通脚本加载方式，共享全局作用域。

const EM_HOSTS = [
  "push2delay.eastmoney.com",
  "push2.eastmoney.com",
  "82.push2.eastmoney.com",
  "push2his.eastmoney.com",
];
const EM_FIELDS = "f43,f44,f45,f46,f47,f48,f60,f86,f169,f170";

// 涨跌家数按"市场"聚合 — 每个指数对应一个东财 clist fs
// 上证=沪A(主板+科创板)，深证=深A(主板+创业板)，北证=北交所
// 创业板指=创业板，科创50=科创板；沪深300/其它无自然市场 → 不显示
const BREADTH_FS = {
  "000001": "m:1+t:2,m:1+t:23",     // 沪A
  "399001": "m:0+t:6,m:0+t:80",     // 深A
  "899050": "m:0+t:81+s:2048",      // 北交所
  "399006": "m:0+t:80",             // 创业板
  "000688": "m:1+t:23",             // 科创板
};

const INTERFACE_CONTRACTS = {
  emQuote: { label: "东财行情", required: ["data.f43", "data.f48", "data.f86"] },
  qqQuote: { label: "腾讯行情", required: ["~3 最新价", "~30 时间", "~37 成交额"] },
  breadth: { label: "东财涨跌家数", required: ["data.diff[].f3", "data.diff[].f20"] },
  limitPool: { label: "涨跌停股池", required: ["data.total 或 data.pool"] },
  allPb: { label: "全A PB", required: ["data.diff[].f23"] },
  trends: { label: "分时走势", required: ["data.trends[]", "data.preClose"] },
  kline: { label: "日线K线", required: ["data.klines[][6] 成交额"] },
  margin: { label: "融资余额", required: ["FIN_BALANCE", "LOAN_BALANCE"] },
  bond: { label: "10年国债", required: ["EMM00166466"] },
};
const interfaceHealth = {};

function recordInterfaceHealth(name, ok, detail = "") {
  const item = INTERFACE_CONTRACTS[name] || { label: name };
  interfaceHealth[name] = {
    ok: !!ok,
    label: item.label,
    detail: String(detail || ""),
    checkedAt: new Date().toISOString(),
  };
}

function snapshotInterfaceHealth() {
  return Object.entries(interfaceHealth)
    .map(([name, item]) => ({ name, ...item }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

// ===== 基础工具 =====
function fmt(n, digits=2) {
  if (n === null || n === undefined || isNaN(n)) return "--";
  return Number(n).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function div100(v) { return v == null ? null : Number(v) / 100; }
function numOrNull(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }

// ===== JSONP =====
function jsonp(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const cbName = "__emcb_" + Math.random().toString(36).slice(2) + "_" + Date.now();
    const s = document.createElement("script");
    let done = false;
    const cleanup = () => {
      try { delete window[cbName]; } catch {}
      if (s.parentNode) s.parentNode.removeChild(s);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true; cleanup(); reject(new Error("timeout"));
    }, timeoutMs);
    window[cbName] = (data) => {
      if (done) return;
      done = true; clearTimeout(timer); cleanup(); resolve(data);
    };
    s.onerror = () => {
      if (done) return;
      done = true; clearTimeout(timer); cleanup(); reject(new Error("script error"));
    };
    s.src = url + (url.includes("?") ? "&" : "?") + "cb=" + cbName;
    document.head.appendChild(s);
  });
}

// ===== 东财行情 =====
async function fetchOneEm(secid) {
  const qs = `secid=${encodeURIComponent(secid)}&fields=${EM_FIELDS}&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  let lastErr = null;
  for (const host of EM_HOSTS) {
    try {
      const j = await jsonp(`https://${host}/api/qt/stock/get?${qs}`);
      const d = (j && j.data) || null;
      if (!d || d.f43 == null || d.f43 === "-") throw new Error("empty");
      let tradeDate = null;
      if (d.f86) {
        const t = new Date(d.f86 * 1000);
        tradeDate = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
      }
      const parsed = {
        price:      div100(d.f43),
        prev_close: div100(d.f60),
        change:     div100(d.f169),
        change_pct: div100(d.f170),
        volume:     numOrNull(d.f47),
        amount:     numOrNull(d.f48),
        trade_date: tradeDate,
        trade_ts:   numOrNull(d.f86),
        source:     `em:${host}`,
      };
      recordInterfaceHealth("emQuote", true, host);
      return parsed;
    } catch (e) { lastErr = e; }
  }
  recordInterfaceHealth("emQuote", false, lastErr ? lastErr.message : "all hosts failed");
  throw lastErr || new Error("all em hosts failed");
}

// ===== 腾讯行情 =====
function fetchOneQq(qqCode) {
  return new Promise((resolve, reject) => {
    const varName = "v_" + qqCode;
    try { delete window[varName]; } catch {}
    const s = document.createElement("script");
    const cleanup = () => { if (s.parentNode) s.parentNode.removeChild(s); };
    const timer = setTimeout(() => { cleanup(); recordInterfaceHealth("qqQuote", false, "timeout"); reject(new Error("timeout")); }, 6000);
    s.onload = () => {
      clearTimeout(timer);
      try {
        const raw = window[varName];
        if (!raw || typeof raw !== "string") throw new Error("no data");
        const fields = raw.split("~");
        const price = Number(fields[3]);
        const prevClose = Number(fields[4]);
        const volume = Number(fields[6]);
        const change = Number(fields[31]);
        const changePct = Number(fields[32]);
        const amountWan = Number(fields[37]);
        const tsStr = fields[30] || "";
        let tradeDate = null, tradeTs = null;
        if (tsStr.length >= 14) {
          const y = tsStr.slice(0,4), mo = tsStr.slice(4,6), da = tsStr.slice(6,8);
          const h = tsStr.slice(8,10), mi = tsStr.slice(10,12), se = tsStr.slice(12,14);
          tradeDate = `${y}-${mo}-${da}`;
          tradeTs = Math.floor(new Date(`${y}-${mo}-${da}T${h}:${mi}:${se}`).getTime() / 1000);
        } else if (tsStr.length >= 8) {
          tradeDate = `${tsStr.slice(0,4)}-${tsStr.slice(4,6)}-${tsStr.slice(6,8)}`;
        }
        if (!Number.isFinite(price)) throw new Error("parse failed");
        cleanup();
        recordInterfaceHealth("qqQuote", true, qqCode);
        resolve({
          price: price,
          prev_close: Number.isFinite(prevClose) ? prevClose : null,
          change: Number.isFinite(change) ? change : null,
          change_pct: Number.isFinite(changePct) ? changePct : null,
          volume: Number.isFinite(volume) ? volume : null,
          amount: Number.isFinite(amountWan) ? amountWan * 10000 : null,
          trade_date: tradeDate,
          trade_ts: tradeTs,
          source: "tencent:qt.gtimg.cn",
        });
      } catch (e) { cleanup(); recordInterfaceHealth("qqQuote", false, e.message || e); reject(e); }
    };
    s.onerror = () => { clearTimeout(timer); cleanup(); recordInterfaceHealth("qqQuote", false, "script error"); reject(new Error("script error")); };
    s.src = `https://qt.gtimg.cn/q=${qqCode}&_=${Date.now()}`;
    document.head.appendChild(s);
  });
}

async function fetchOne(target) {
  const primary = CFG.source === "qq" ? () => fetchOneQq(target.qq) : () => fetchOneEm(target.secid);
  const backup  = CFG.source === "qq" ? () => fetchOneEm(target.secid) : () => fetchOneQq(target.qq);
  try { return await primary(); }
  catch (e1) {
    try { return await backup(); }
    catch (e2) { throw new Error(`primary:${e1.message} | backup:${e2.message}`); }
  }
}

// ===== 涨跌家数（clist 分页聚合） =====
// 对每个 fs（市场），翻页拉 f3（涨跌幅%），本地统计 up/down/flat
async function fetchBreadthForFs(fs) {
  const PAGE = 100;
  let up = 0, down = 0, flat = 0, total = 0, pn = 1;
  let mcapSum = 0; // f20 总市值（元）
  while (pn <= 60) { // 最多 6000 只，当前A股约 5400
    const qs =
      `pn=${pn}&pz=${PAGE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}` +
      `&fields=f2,f3,f20&ut=bd1d9ddb04089700cf9c27f6f7426281`;
    let j = null, lastErr = null;
    for (const host of EM_HOSTS) {
      try {
        j = await jsonp(`https://${host}/api/qt/clist/get?${qs}`, 7000);
        break;
      } catch (e) { lastErr = e; }
    }
    if (!j || !j.data) throw lastErr || new Error("clist empty");
    const rows = Array.isArray(j.data.diff) ? j.data.diff : [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const pct = Number(r.f3);
      if (!Number.isFinite(pct)) { flat++; }
      else if (pct > 0) up++;
      else if (pct < 0) down++;
      else flat++;
      const mc = Number(r.f20);
      if (Number.isFinite(mc) && mc > 0) mcapSum += mc;
    }
    total = Number(j.data.total) || total;
    if (pn * PAGE >= total) break;
    pn++;
  }
  recordInterfaceHealth("breadth", true, `rows:${total || up + down + flat}`);
  return { up, down, flat, mcap: mcapSum };
}

// ===== 涨停/跌停股池（push2ex 专用接口） =====
// 涨停: getTopicZTPool   跌停: getTopicDTPool
// 优先读 data.total，缺失/为 0 时回退到 data.pool.length；pagesize 设 3000 足够覆盖极端日
async function fetchLimitPoolTotal(api, sort, date) {
  const qs =
    `ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=3000&sort=${encodeURIComponent(sort)}&date=${date}` +
    `&_=${Date.now()}`;
  const url = `https://push2ex.eastmoney.com/${api}?${qs}`;
  const j = await jsonp(url, 8000);
  const t = Number(j && j.data && j.data.total);
  if (Number.isFinite(t) && t > 0) {
    recordInterfaceHealth("limitPool", true, api);
    return t;
  }
  const pool = j && j.data && j.data.pool;
  if (Array.isArray(pool)) {
    recordInterfaceHealth("limitPool", true, `${api}:pool`);
    return pool.length;
  }
  console.warn("[limit-pool] unexpected response", url, j);
  recordInterfaceHealth("limitPool", false, `${api}:unexpected response`);
  return 0;
}

const limitCache = { data: null, ts: 0, date: null };
const LIMIT_TTL_MS = 20_000;
async function getLimitCounts(date) {
  if (!date) return null;
  const now = Date.now();
  if (limitCache.data && limitCache.date === date && now - limitCache.ts < LIMIT_TTL_MS) {
    return limitCache.data;
  }
  try {
    const [u, d] = await Promise.all([
      fetchLimitPoolTotal("getTopicZTPool", "fbt:asc", date),
      fetchLimitPoolTotal("getTopicDTPool", "fund:asc", date),
    ]);
    const data = { limitUp: u, limitDown: d };
    limitCache.data = data; limitCache.ts = now; limitCache.date = date;
    return data;
  } catch (e) {
    recordInterfaceHealth("limitPool", false, e.message || e);
    return limitCache.date === date ? limitCache.data : null;
  }
}

const breadthCache = {}; // { code: {data, ts} }
const BREADTH_TTL_MS = 20_000; // 20 秒内复用，避免每 tick 都全市场翻页
async function getBreadth(code) {
  const fs = BREADTH_FS[code];
  if (!fs) return null;
  const now = Date.now();
  const c = breadthCache[code];
  if (c && (now - c.ts < BREADTH_TTL_MS)) return c.data;
  try {
    const data = await fetchBreadthForFs(fs);
    breadthCache[code] = { data, ts: now };
    return data;
  } catch (e) {
    recordInterfaceHealth("breadth", false, e.message || e);
    return c ? c.data : null;
  }
}

// ===== A股温度（全A PB 中位数 → 历史分位） =====
// 拉全A（沪A+深A+北交所）的 PB（f23），取中位数，在 pb_history.js 的近10年分布里求分位
const TEMP_FS = "m:1+t:2,m:1+t:23,m:0+t:6,m:0+t:80,m:0+t:81+s:2048";
async function fetchAllPbMedian() {
  const PAGE = 100;
  const pbs = [];
  let pn = 1, total = 0;
  while (pn <= 80) { // 全A 约 5400 只
    const qs =
      `pn=${pn}&pz=${PAGE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(TEMP_FS)}` +
      `&fields=f23&ut=bd1d9ddb04089700cf9c27f6f7426281`;
    let j = null, lastErr = null;
    for (const host of EM_HOSTS) {
      try { j = await jsonp(`https://${host}/api/qt/clist/get?${qs}`, 8000); break; }
      catch (e) { lastErr = e; }
    }
    if (!j || !j.data) {
      recordInterfaceHealth("allPb", false, lastErr ? lastErr.message : "clist empty");
      throw lastErr || new Error("clist empty");
    }
    const rows = Array.isArray(j.data.diff) ? j.data.diff : [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const pb = Number(r.f23);
      // 过滤负 PB（净资产为负）和 0/缺失，这与乐咕乐股口径一致
      if (Number.isFinite(pb) && pb > 0) pbs.push(pb);
    }
    total = Number(j.data.total) || total;
    if (pn * PAGE >= total) break;
    pn++;
  }
  if (pbs.length === 0) {
    recordInterfaceHealth("allPb", false, "no pb");
    throw new Error("no pb");
  }
  pbs.sort((a, b) => a - b);
  const n = pbs.length;
  const median = n % 2 ? pbs[(n - 1) / 2] : (pbs[n/2 - 1] + pbs[n/2]) / 2;
  recordInterfaceHealth("allPb", true, `samples:${n}`);
  return { median, sampleSize: n };
}

// 在已排序数组里用二分求"严格小于 v 的个数" → 百分位
function percentileRank(sortedAsc, v) {
  let lo = 0, hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length * 100;
}

function classifyTemp(t) {
  if (t < 20) return { cls: "cold", label: "冰点" };
  if (t < 40) return { cls: "cool", label: "偏冷" };
  if (t < 60) return { cls: "cool", label: "温和" };
  if (t < 80) return { cls: "warm", label: "偏热" };
  return { cls: "hot", label: "过热" };
}

// ===== 分时图（东财 trends2） =====
// 返回：{ points: [{minute, price}], prev }
// minute = 0..240 映射：9:30→0, 11:30→120, 13:00→120, 15:00→240
function timeStrToMinute(str) {
  // str 如 "2026-04-21 09:35"
  const m = /(\d{1,2}):(\d{2})/.exec(str || "");
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  const t = h * 60 + mi;
  const open = 9*60 + 30, noon = 11*60 + 30, pm = 13*60, close = 15*60;
  if (t <= open) return 0;
  if (t <= noon) return t - open;
  if (t <= pm) return 120;
  if (t <= close) return 120 + (t - pm);
  return 240;
}

async function fetchTrends(target) {
  const qs = `secid=${encodeURIComponent(target.secid)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&iscca=0&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  for (const host of EM_HOSTS) {
    try {
      const j = await jsonp(`https://${host}/api/qt/stock/trends2/get?${qs}`, 8000);
      const d = (j && j.data) || null;
      if (!d || !Array.isArray(d.trends) || d.trends.length === 0) throw new Error("empty");
      const points = d.trends.map(line => {
        const parts = line.split(",");
        const price = Number(parts[1]);
        const minute = timeStrToMinute(parts[0]);
        if (!Number.isFinite(price) || minute == null) return null;
        return { minute, price };
      }).filter(p => p != null);
      if (points.length === 0) throw new Error("no points");
      recordInterfaceHealth("trends", true, target.code);
      return { points, prev: numOrNull(d.preClose) };
    } catch (e) { /* try next host */ }
  }
  recordInterfaceHealth("trends", false, target.code);
  throw new Error("all hosts failed");
}

// ===== 合计成交额近3日（沪+深+北证50 日线 K 求和） =====
async function fetchKline3d(secid) {
  const qs = `secid=${encodeURIComponent(secid)}&klt=101&fqt=0&end=20500000&lmt=1` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60` +
    `&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  for (const host of EM_HOSTS) {
    try {
      const j = await jsonp(`https://${host}/api/qt/stock/kline/get?${qs}`, 7000);
      const lines = j && j.data && Array.isArray(j.data.klines) ? j.data.klines : null;
      if (!lines || lines.length === 0) throw new Error("empty");
      // 字段顺序：日期,开,收,高,低,成交量(手),成交额(元),振幅,涨跌幅,涨跌额
      const rows = lines.map(s => {
        const p = s.split(",");
        return { date: p[0], amount: Number(p[6]) };
      });
      recordInterfaceHealth("kline", true, secid);
      return rows;
    } catch {}
  }
  recordInterfaceHealth("kline", false, secid);
  throw new Error("kline failed");
}
