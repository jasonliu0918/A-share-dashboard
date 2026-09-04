// 应用入口与任务编排
// 从 index.html 拆分；保持浏览器普通脚本加载方式，共享全局作用域。

// ===== 主循环 =====
let tickTimer = null;
async function tick() {
  const targets = activeTargets();
  if (targets.length === 0) {
    statusEl.className = "status";
    statusText.textContent = "未选中任何指数";
    return;
  }
  try {
    const results = await Promise.all(targets.map(async t => {
      try {
        const info = await fetchOne(t);
        return { code: t.code, name: t.name, secid: t.secid, ...info, available: info.price != null };
      } catch (e) {
        return { code: t.code, name: t.name, available: false, error: String(e) };
      }
    }));

    // 并行拉涨跌家数（每个 fs 独立缓存 + TTL），合并到对应 item
    const breadths = await Promise.all(results.map(async r => {
      if (!r.available) return null;
      return await getBreadth(r.code);
    }));
    breadths.forEach((b, i) => {
      if (!b) return;
      results[i].up_count = b.up;
      results[i].down_count = b.down;
      results[i].flat_count = b.flat;
    });
    renderMarketCap(results, breadths);

    // 涨停/跌停数量：取最新 trade_date 调东财 push2ex 接口（与涨跌家数同频率）
    const latestTradeDate = results.map(r => r.trade_date).filter(Boolean).sort().pop();
    const ymd = latestTradeDate ? latestTradeDate.replace(/-/g, "") : null;
    const limit = await getLimitCounts(ymd);
    window.__limitCounts = limit; // renderSummary 取用

    results.forEach(renderItem);
    renderSummary(results);
    window.__lastResults = results;
    renderMarketBadge(results);
    renderInterfaceHealth();

    // 异步刷新分时图（不阻塞 tick）
    if (CFG.showMini) {
      results.forEach(r => {
        if (!r.available) return;
        const t = ALL_TARGETS.find(x => x.code === r.code);
        if (!t) return;
        const isUp = (r.change ?? 0) >= 0;
        updateMini(t, isUp);
      });
    }

    // 异步刷新合计成交额（与三大指数同频率）
    fetchAndRenderAmt3d();

    const okCount = results.filter(r => r.available).length;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,"0");
    const mm = String(now.getMinutes()).padStart(2,"0");
    const ss = String(now.getSeconds()).padStart(2,"0");
    if (okCount === 0) {
      statusEl.className = "status err";
      statusText.textContent = `获取失败 · ${hh}:${mm}:${ss}`;
    } else {
      statusEl.className = "status ok";
      statusText.textContent = `已连接 · ${hh}:${mm}:${ss}${okCount < results.length ? ` (${okCount}/${results.length})` : ""}`;
    }
  } catch (e) {
    statusEl.className = "status err";
    statusText.textContent = "获取失败: " + e.message;
  }
}

function startTick() {
  if (tickTimer) clearInterval(tickTimer);
  tick().then(() => {
    // 根据本次获取的数据判断是否是交易日
    const results = window.__lastResults || [];
    const market = classifyMarket(results);

    // 交易日 09:25-15:01 才持续刷新；周末、法定休市日和盘后只显示一次。
    if (shouldAutoRefreshMarket(market)) {
      tickTimer = setInterval(() => {
        const market = classifyMarket(window.__lastResults || []);
        if (!shouldAutoRefreshMarket(market)) {
          clearInterval(tickTimer);
          tickTimer = null;
          return;
        }
        tick();
      }, CFG.interval);
    }
  });
}

// ===== 设置抽屉 =====
const drawer = document.getElementById("drawer");
const drawerMask = document.getElementById("drawer-mask");

function openDrawer() {
  // 填充当前值
  document.getElementById("cfg-interval").value = String(CFG.interval);
  document.getElementById("cfg-source").value = CFG.source;
  document.getElementById("cfg-mini").checked = !!CFG.showMini;
  document.getElementById("cfg-extra-group").checked = !!CFG.showExtraGroup;
  document.getElementById("cfg-mini-interval").value = CFG.miniInterval || 30;
  const box = document.getElementById("cfg-targets");
  box.innerHTML = ALL_TARGETS.map(t => `
    <label class="cfg-check">
      <input type="checkbox" data-code="${t.code}" ${CFG.visible.includes(t.code) ? "checked" : ""}>
      ${t.name} <span style="color:var(--muted);font-size:11px;">(${t.code} · ${t.group === "main" ? "三大" : "扩展"})</span>
    </label>
  `).join("");
  drawer.classList.add("open");
  drawerMask.classList.add("open");
}
function closeDrawer() {
  drawer.classList.remove("open");
  drawerMask.classList.remove("open");
}

document.getElementById("btn-gear").addEventListener("click", openDrawer);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
drawerMask.addEventListener("click", closeDrawer);

document.getElementById("cfg-save").addEventListener("click", () => {
  const newCfg = {
    interval: Number(document.getElementById("cfg-interval").value) || DEFAULT_CFG.interval,
    source: document.getElementById("cfg-source").value === "qq" ? "qq" : "em",
    showMini: document.getElementById("cfg-mini").checked,
    showExtraGroup: document.getElementById("cfg-extra-group").checked,
    miniInterval: Math.max(10, Math.min(600, Number(document.getElementById("cfg-mini-interval").value) || 30)),
    visible: Array.from(document.querySelectorAll("#cfg-targets input[type=checkbox]"))
      .filter(el => el.checked).map(el => el.dataset.code),
  };
  CFG = { ...CFG, ...newCfg };
  saveCfg(CFG);
  rebuildGrids();
  closeDrawer();
  startTick();
});

document.getElementById("cfg-reset").addEventListener("click", () => {
  if (!confirm("恢复默认设置？")) return;
  CFG = { ...DEFAULT_CFG };
  saveCfg(CFG);
  rebuildGrids();
  closeDrawer();
  startTick();
});

// ===== 启动 =====
rebuildGrids();
startTick();
if (typeof loadRemoteJslTemperature === "function") {
  loadRemoteJslTemperature().finally(renderJslTemperature);
} else {
  renderJslTemperature();
}
renderInterfaceHealth();
setTimeout(() => fetchAndRenderMargin(), 2000);
setTimeout(() => fetchAndRenderBond(), 3000);
setInterval(() => fetchAndRenderBond(), 10 * 60 * 1000);

// 10年期国债收益率弹层
const bondHelp = document.getElementById("bond-help");
const bondModal = document.getElementById("bond-modal");
const bondModalMask = document.getElementById("bond-modal-mask");
const bondModalClose = document.getElementById("bond-modal-close");
function openBondModal(e) { if (e) e.preventDefault(); bondModal.style.display = "block"; bondModalMask.style.display = "block"; }
function closeBondModal() { bondModal.style.display = "none"; bondModalMask.style.display = "none"; }
if (bondHelp) bondHelp.addEventListener("click", openBondModal);
if (bondModalMask) bondModalMask.addEventListener("click", closeBondModal);
if (bondModalClose) bondModalClose.addEventListener("click", closeBondModal);

function fetchAndRenderMargin() {
  const container = document.getElementById("margin-rows");
  const subEl = document.getElementById("margin-sub");
  if (!container) return;
  container.innerHTML = `<span style="color:var(--muted);font-size:13px;">加载中…</span>`;

  const url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    + "?reportName=RPTA_WEB_MARGIN_DAILYTRADE"
    + "&columns=STATISTICS_DATE,FIN_BALANCE,LOAN_BALANCE,FIN_BUY_AMT"
    + "&pageNumber=1&pageSize=3"
    + "&sortColumns=STATISTICS_DATE&sortTypes=-1";

  // 此接口 JSONP 参数名是 callback 而非 cb，单独实现
  const cbName = "__emrz_" + Math.random().toString(36).slice(2);
  const s = document.createElement("script");
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    try { delete window[cbName]; } catch {}
    if (s.parentNode) s.parentNode.removeChild(s);
    recordInterfaceHealth("margin", false, "timeout");
    renderInterfaceHealth();
    container.innerHTML = `<span style="color:var(--muted);font-size:13px;">获取失败（超时）</span>`;
  }, 8000);
  window[cbName] = (j) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { delete window[cbName]; } catch {}
    if (s.parentNode) s.parentNode.removeChild(s);
    try {
      const rows = (j.result.data || []).slice(0, 3).reverse().map(r => ({
        date: r.STATISTICS_DATE.slice(0, 10),
        rzye: Number(r.FIN_BALANCE),
        rqye: Number(r.LOAN_BALANCE),
        rzMrje: Number(r.FIN_BUY_AMT),
      }));
      recordInterfaceHealth("margin", true, rows[rows.length - 1] ? rows[rows.length - 1].date : "empty");
      renderMarginRows(rows, container, subEl);
      renderInterfaceHealth();
    } catch (e) {
      recordInterfaceHealth("margin", false, e.message || e);
      renderInterfaceHealth();
      container.innerHTML = `<span style="color:var(--muted);font-size:13px;">解析失败</span>`;
    }
  };
  s.onerror = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (s.parentNode) s.parentNode.removeChild(s);
    recordInterfaceHealth("margin", false, "script error");
    renderInterfaceHealth();
    container.innerHTML = `<span style="color:var(--muted);font-size:13px;">获取失败</span>`;
  };
  s.src = url + "&callback=" + cbName;
  document.head.appendChild(s);
}

// ===== 10年期国债收益率（东财 datacenter RPTA_WEB_TREASURYYIELD） =====
function fetchAndRenderBond() {
  const rateEl = document.getElementById("bond-rate");
  const dateEl = document.getElementById("bond-date");
  if (!rateEl) return;

  // 拉最近 10 行，跳过节假日（中债字段 EMM00166466 在假期为 null，但同表里 EMG* 是美债）
  const url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    + "?reportName=RPTA_WEB_TREASURYYIELD"
    + "&columns=ALL"
    + "&pageNumber=1&pageSize=10"
    + "&sortColumns=SOLAR_DATE&sortTypes=-1";

  const cbName = "__bondcb_" + Math.random().toString(36).slice(2);
  const s = document.createElement("script");
  let done = false;
  const timer = setTimeout(() => {
    if (done) return; done = true;
    try { delete window[cbName]; } catch {}
    if (s.parentNode) s.parentNode.removeChild(s);
    recordInterfaceHealth("bond", false, "timeout");
    renderInterfaceHealth();
    rateEl.textContent = "--";
  }, 8000);
  window[cbName] = (j) => {
    if (done) return; done = true; clearTimeout(timer);
    try { delete window[cbName]; } catch {}
    if (s.parentNode) s.parentNode.removeChild(s);
    try {
      const rows = (j && j.result && j.result.data) || [];
      if (rows.length === 0) throw new Error("empty");
      // 严格只看中债 10 年期字段；rows 已按日期倒序，找最近一个非空值
      let hit = null;
      for (const r of rows) {
        if (r && r.EMM00166466 != null) {
          const v = Number(r.EMM00166466);
          if (Number.isFinite(v)) { hit = { v, date: r.SOLAR_DATE }; break; }
        }
      }
      if (hit == null) throw new Error("no rate field");
      rateEl.textContent = hit.v.toFixed(4);
      if (dateEl && hit.date) dateEl.textContent = String(hit.date).slice(0, 10);
      recordInterfaceHealth("bond", true, hit.date || "");
      renderInterfaceHealth();
    } catch (e) {
      recordInterfaceHealth("bond", false, e.message || e);
      renderInterfaceHealth();
      rateEl.textContent = "--";
    }
  };
  s.onerror = () => {
    if (done) return; done = true; clearTimeout(timer);
    if (s.parentNode) s.parentNode.removeChild(s);
    recordInterfaceHealth("bond", false, "script error");
    renderInterfaceHealth();
    rateEl.textContent = "--";
  };
  s.src = url + "&callback=" + cbName;
  document.head.appendChild(s);
}

async function fetchAndRenderAmt3d() {
  const container = document.getElementById("amt-rows");
  const subEl = document.getElementById("amt-sub");
  if (!container) return;

  // 历史(前2天)用仓库预生成的静态数据 assets/amt3d.js（每交易日收盘后由 GitHub Actions 更新，
  // 走 github.io 分发，任何客户端网络都能读；避免依赖被部分网络屏蔽的东财 push2his 日K线）。
  const AMT = window.AMT3D_DATA;
  const histDays = (AMT && Array.isArray(AMT.days)) ? AMT.days : null;

  // 今天日期与是否交易日：复用全站交易日历
  const cal = getAshareCalendarStatus(new Date());
  const todayStr = cal.ymd;

  // 今天成交额：主指数当日实时成交额之和（走 push2delay/clist，基本任何网络可达）
  let todayYuan = null, hasTodayLive = false;
  const results = window.__lastResults;
  if (Array.isArray(results)) {
    const mainCodes = new Set(ALL_TARGETS.filter(t => t.group === "main").map(t => t.code));
    let sum = 0, has = false, anyToday = false;
    results.forEach(it => {
      if (!mainCodes.has(it.code)) return;
      if (it.trade_date === todayStr) anyToday = true;
      if (it.amount != null) { sum += it.amount; has = true; }
    });
    if (has) todayYuan = sum;
    hasTodayLive = anyToday && has && sum > 0;
  }

  let rows = null;   // [{ date, amtYi|null, kind:'hist'|'today', pending? }]
  let note = "";
  if (histDays && histDays.length) {
    if (cal.isTradingDay) {
      // 历史 = 早于今天的最近2个交易日（收盘确认值）；今天 = 实时
      const hist = histDays.filter(d => d.date < todayStr).slice(-2)
        .map(d => ({ date: d.date, amtYi: d.amountYuan / 1e8, kind: "hist" }));
      const todayRow = hasTodayLive
        ? { date: todayStr, amtYi: todayYuan / 1e8, kind: "today" }
        : { date: todayStr, amtYi: null, kind: "today", pending: true };
      rows = [...hist, todayRow];
      note = "沪+深+北证50 · 今日实时，前2日收盘值";
    } else {
      // 非交易日：展示静态最近3个交易日
      rows = histDays.slice(-3).map(d => ({ date: d.date, amtYi: d.amountYuan / 1e8, kind: "hist" }));
      note = "沪+深+北证50 · 收盘确认" + (AMT.updatedAt ? " · 更新 " + AMT.updatedAt.slice(0, 10) : "");
    }
  } else if (todayYuan != null && todayYuan > 0) {
    // 静态历史缺失：至少显示今日实时
    rows = [{ date: todayStr, amtYi: todayYuan / 1e8, kind: "today" }];
    note = "沪+深+北证50 · 仅今日实时（历史数据暂不可用）";
  } else {
    container.innerHTML = `<span style="color:var(--muted);font-size:13px;">历史数据暂不可用</span>`;
    if (subEl) subEl.textContent = "";
    return;
  }

  const nums = rows.map(r => r.amtYi).filter(v => v != null && v > 0);
  const maxAmt = nums.length ? Math.max(...nums) : 0;
  container.innerHTML = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    const prev = i > 0 ? rows[i - 1].amtYi : null;
    const diff = (r.amtYi != null && prev != null) ? r.amtYi - prev : null;
    const diffSign = diff == null ? "" : diff >= 0 ? "+" : "";
    const diffColor = diff == null ? "" : diff >= 0 ? "color:var(--up)" : "color:var(--down)";
    const barPct = (maxAmt > 0 && r.amtYi != null) ? (r.amtYi / maxAmt * 100).toFixed(1) : 0;
    const datePart = r.date.slice(5);
    const valHtml = (r.amtYi == null)
      ? `<span style="color:var(--muted);font-size:12px;">盘中待更新</span>`
      : `${r.amtYi.toFixed(0)}<span style="font-size:10px;color:var(--muted);font-weight:400;margin-left:2px;">亿</span>`;
    let tail;
    if (r.kind === "today") {
      tail = `<span style="min-width:48px;font-size:10px;color:var(--accent);">今日</span>`;
    } else if (diff != null) {
      tail = `<span style="min-width:48px;font-size:11px;${diffColor}">${diffSign}${diff.toFixed(0)}</span>`;
    } else {
      tail = `<span style="min-width:48px;"></span>`;
    }
    return `
      <div style="display:flex;align-items:center;gap:6px;font-size:${isLast ? "14px" : "12px"};${isLast ? "font-weight:600;" : "color:var(--muted);"}">
        <span style="min-width:36px;">${datePart}</span>
        <div style="flex:1;background:#eef2f7;border-radius:3px;height:${isLast ? "6px" : "4px"};overflow:hidden;">
          <div style="width:${barPct}%;height:100%;background:${isLast ? "var(--accent)" : "#94a3b8"};border-radius:3px;"></div>
        </div>
        <span style="min-width:56px;text-align:right;">${valHtml}</span>
        ${tail}
      </div>`;
  }).join("");
  if (subEl) subEl.textContent = note;
}
