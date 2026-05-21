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
  const SECIDS = ["1.000001", "0.399001", "0.899050"];
  try {
    const all = await Promise.all(SECIDS.map(fetchKline3d));
    // 按日期合并
    const byDate = {};
    all.forEach(arr => arr.forEach(({date, amount}) => {
      if (!Number.isFinite(amount)) return;
      byDate[date] = (byDate[date] || 0) + amount;
    }));
    const rows = Object.entries(byDate)
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .slice(-1)
      .map(([date, amt]) => ({ date, amtYi: amt / 1e8 }));
    if (rows.length === 0) {
      container.innerHTML = `<span style="color:var(--muted);font-size:13px;">暂无数据</span>`;
      return;
    }
    const r = rows[0];
    recordInterfaceHealth("kline", true, r.date);
    container.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;justify-content:center;">
        <span style="font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;">${r.amtYi.toFixed(0)}</span>
        <span style="font-size:12px;color:var(--muted);">亿</span>
      </div>`;
    if (subEl) subEl.textContent = `沪+深+北证50`;
  } catch (e) {
    // K线失败（常见于非交易时段接口异常），用三大指数的实时成交额合计兜底
    const results = window.__lastResults;
    if (Array.isArray(results)) {
      const mainCodes = new Set(ALL_TARGETS.filter(t => t.group === "main").map(t => t.code));
      let total = 0, has = false, latestDate = "";
      results.forEach(it => {
        if (!mainCodes.has(it.code)) return;
        if (it.amount != null) { total += it.amount; has = true; }
        if (it.trade_date && it.trade_date > latestDate) latestDate = it.trade_date;
      });
      if (has) {
        const amtYi = total / 1e8;
        container.innerHTML = `
          <div style="display:flex;align-items:baseline;gap:8px;justify-content:center;">
            <span style="font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;">${amtYi.toFixed(0)}</span>
            <span style="font-size:12px;color:var(--muted);">亿</span>
          </div>`;
        if (subEl) subEl.textContent = `沪+深+北证50（实时合计）`;
        return;
      }
    }
    container.innerHTML = `<span style="color:var(--muted);font-size:13px;">获取失败</span>`;
  }
}
