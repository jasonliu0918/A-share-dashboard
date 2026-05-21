// 渲染
// 从 index.html 拆分；保持浏览器普通脚本加载方式，共享全局作用域。

function renderMini(code, points, prev, isUp) {
  const svg = document.getElementById(`mini-${code}`);
  if (!svg) return;
  const W = 300, H = 72, PAD_X = 2, PAD_TOP = 2, AXIS_H = 14;
  const plotBottom = H - AXIS_H;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const prices = points.map(p => p.price);
  const vals = prices.slice();
  if (prev != null) vals.push(prev);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const TOTAL_MIN = 240;
  const x = m => PAD_X + (W - PAD_X*2) * (m / TOTAL_MIN);
  const y = v => PAD_TOP + (plotBottom - PAD_TOP) * (1 - (v - lo) / (hi - lo));

  let path = "";
  points.forEach((p, i) => {
    path += (i === 0 ? "M" : "L") + x(p.minute).toFixed(1) + "," + y(p.price).toFixed(1) + " ";
  });
  const lastX = x(points[points.length - 1].minute);
  const area = path + `L${lastX.toFixed(1)},${plotBottom} L${x(points[0].minute).toFixed(1)},${plotBottom} Z`;
  const prevY = prev != null ? y(prev) : null;
  const cls = isUp ? "up" : "down";

  // 时间轴：9:30 / 11:30-13:00（中午休市虚线）/ 15:00
  const axisY = plotBottom;
  const labelY = H - 3;
  const midX = x(120);
  const axis =
    `<line class="axis" x1="${PAD_X}" y1="${axisY}" x2="${W-PAD_X}" y2="${axisY}" />` +
    `<line class="axis-tick" x1="${PAD_X}" y1="${axisY}" x2="${PAD_X}" y2="${axisY+3}" />` +
    `<line class="axis-tick" x1="${midX}" y1="${axisY}" x2="${midX}" y2="${axisY+3}" />` +
    `<line class="axis-tick" x1="${W-PAD_X}" y1="${axisY}" x2="${W-PAD_X}" y2="${axisY+3}" />` +
    `<line class="axis-noon" x1="${midX}" y1="${PAD_TOP}" x2="${midX}" y2="${axisY}" />` +
    `<text class="axis-label" x="${PAD_X+2}" y="${labelY}" text-anchor="start">9:30</text>` +
    `<text class="axis-label" x="${midX}" y="${labelY}" text-anchor="middle">11:30/13:00</text>` +
    `<text class="axis-label" x="${W-PAD_X-2}" y="${labelY}" text-anchor="end">15:00</text>`;

  svg.innerHTML =
    (prevY != null ? `<line class="prev" x1="0" y1="${prevY.toFixed(1)}" x2="${W}" y2="${prevY.toFixed(1)}" />` : "") +
    `<path class="area ${cls}" d="${area}" />` +
    `<path class="line ${cls}" d="${path.trim()}" />` +
    axis;
}

async function updateMini(target, isUp) {
  if (!CFG.showMini) return;
  const now = Date.now();
  const cache = miniCache[target.code];
  const intervalMs = (CFG.miniInterval || 30) * 1000;
  if (cache && cache.lastFetch && now - cache.lastFetch < intervalMs) {
    renderMini(target.code, cache.points, cache.prev, isUp);
    return;
  }
  try {
    const { points, prev } = await fetchTrends(target);
    miniCache[target.code] = { points, prev, lastFetch: now };
    renderMini(target.code, points, prev, isUp);
  } catch {/* 保留旧图 */}
}

// ===== 卡片模板 =====
function cardTemplate(t) {
  return `
  <div class="card" id="card-${t.code}">
    <div class="card-head">
      <div class="name-line"><span class="name">${t.name}</span><span class="code">${t.code}</span></div>
      <div class="breadth-line" id="breadth-${t.code}">
        <span class="label">涨跌家数：</span>
        <span class="up-n">--</span><span class="sep">/</span><span class="down-n">--</span><span class="sep">/</span><span class="flat-n">--</span>
      </div>
    </div>
    <div class="price" id="price-${t.code}">--</div>
    <div class="change" id="change-${t.code}">-- (--%)</div>
    <svg class="mini ${CFG.showMini ? "" : "hidden"}" id="mini-${t.code}"></svg>
    <div class="metrics" style="grid-template-columns: 1fr;">
      <div class="metric">
        <div class="label">成交额</div>
        <div class="value" id="amount-${t.code}">--<span class="unit">亿</span></div>
      </div>
    </div>
    <div class="tag" id="tag-${t.code}"></div>
  </div>`;
}

function rebuildGrids() {
  const grid = document.getElementById("grid-indices");
  const group = document.getElementById("group-indices");
  const targets = ALL_TARGETS.filter(t => CFG.visible.includes(t.code));
  grid.innerHTML = targets.map(cardTemplate).join("");
  group.style.display = targets.length ? "" : "none";
  // 更新汇总副标题（汇总仅计"三大指数"）
  const sub = document.getElementById("summary-sub");
  sub.textContent = "";
}

// ===== 渲染卡片 =====
function renderItem(it) {
  const priceEl  = document.getElementById(`price-${it.code}`);
  const changeEl = document.getElementById(`change-${it.code}`);
  const amountEl = document.getElementById(`amount-${it.code}`);
  const tagEl    = document.getElementById(`tag-${it.code}`);
  if (!priceEl) return;

  if (!it.available) {
    priceEl.textContent = "暂无数据";
    changeEl.textContent = "";
    amountEl.innerHTML = `--<span class="unit">亿</span>`;
    const breadthEl = document.getElementById(`breadth-${it.code}`);
    if (breadthEl) {
      breadthEl.innerHTML =
        `<span class="label">涨跌家数：</span>` +
        `<span class="up-n">--</span><span class="sep">/</span>` +
        `<span class="down-n">--</span><span class="sep">/</span>` +
        `<span class="flat-n">--</span>`;
    }
    if (tagEl) tagEl.innerHTML = `<span class="badge">数据源不可用</span>`;
    return;
  }

  priceEl.textContent = fmt(it.price, 2);
  const cls = (it.change ?? 0) >= 0 ? "up" : "down";
  const sign = (it.change ?? 0) >= 0 ? "+" : "";
  changeEl.className = "change " + cls;
  priceEl.className = "price " + cls;
  changeEl.textContent = `${sign}${fmt(it.change,2)}  (${sign}${fmt(it.change_pct,2)}%)`;

  const amtYi = it.amount != null ? it.amount / 1e8 : null;
  amountEl.innerHTML = amtYi != null
    ? `${fmt(amtYi,2)}<span class="unit">亿</span>`
    : `—<span class="unit"></span>`;

  const breadthEl = document.getElementById(`breadth-${it.code}`);
  if (breadthEl) {
    const hasBreadth = it.up_count != null || it.down_count != null || it.flat_count != null;
    if (hasBreadth) {
      const u = it.up_count ?? 0, d = it.down_count ?? 0, f = it.flat_count ?? 0;
      breadthEl.innerHTML =
        `<span class="label">涨跌家数：</span>` +
        `<span class="up-n">${u.toLocaleString("zh-CN")}</span><span class="sep">/</span>` +
        `<span class="down-n">${d.toLocaleString("zh-CN")}</span><span class="sep">/</span>` +
        `<span class="flat-n">${f.toLocaleString("zh-CN")}</span>`;
    } else {
      breadthEl.innerHTML =
        `<span class="label">涨跌家数：</span>` +
        `<span class="flat-n" style="font-size:11px;">—</span>`;
    }
  }

  if (amtYi != null) {
    const peak = Math.max(lastAmount[it.code] ?? 0, amtYi);
    lastAmount[it.code] = peak;
  }

  if (tagEl) {
    tagEl.innerHTML = "";
  }
}

function renderMarketCap(results, breadths) {
  // 按市场聚合：上证A=000001, 深证A=399001, 北证A=899050（复用 BREADTH_FS 的 mcap 结果）
  const map = {};
  results.forEach((r, i) => {
    const b = breadths[i];
    if (b && b.mcap != null) map[r.code] = b.mcap;
  });
  const TRI = 1e12; // 万亿 = 1e12 元
  const sh = map["000001"], sz = map["399001"], bj = map["899050"];
  const setEl = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (v != null && v > 0) ? (v / TRI).toFixed(2) : "--";
  };
  setEl("mcap-sh", sh);
  setEl("mcap-sz", sz);
  setEl("mcap-bj", bj);
  let total = 0, hasAny = false;
  [sh, sz, bj].forEach(v => { if (v != null && v > 0) { total += v; hasAny = true; } });
  setEl("mcap-total", hasAny ? total : null);
  const tEl = document.getElementById("mcap-time");
  if (tEl) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,"0");
    const mm = String(now.getMinutes()).padStart(2,"0");
    tEl.textContent = `${hh}:${mm}`;
  }
}

function renderSummary(items) {
  // 只统计"三大指数"分组（上证/深证/北证50），扩展指数不计入合计
  const mainCodes = new Set(ALL_TARGETS.filter(t => t.group === "main").map(t => t.code));
  let totalAmount = 0, totalVolume = 0;
  let hasAmount = false, hasVolume = false;
  let totalUp = 0, totalDown = 0, totalFlat = 0;
  let hasBreadth = false;
  items.forEach(it => {
    if (!mainCodes.has(it.code)) return;
    if (it.amount != null) { totalAmount += it.amount; hasAmount = true; }
    if (it.volume != null) { totalVolume += it.volume; hasVolume = true; }
    if (it.up_count != null || it.down_count != null || it.flat_count != null) {
      totalUp += it.up_count ?? 0;
      totalDown += it.down_count ?? 0;
      totalFlat += it.flat_count ?? 0;
      hasBreadth = true;
    }
  });
  const lc = window.__limitCounts;
  const hasLimit = !!lc;
  const lupStr = hasLimit ? lc.limitUp.toLocaleString("zh-CN") : "--";
  const ldnStr = hasLimit ? lc.limitDown.toLocaleString("zh-CN") : "--";
  const sumAmtEl = document.getElementById("sum-amount");
  const sumBrEl  = document.getElementById("sum-breadth");
  const subEl    = document.getElementById("summary-sub");
  if (subEl) {
    const latest = items.map(it => it.trade_date).filter(Boolean).sort().pop();
    subEl.textContent = latest ? `交易日 ${latest}` : "";
  }
  if (sumAmtEl) {
    sumAmtEl.innerHTML = hasAmount
      ? `${fmt(totalAmount / 1e8, 2)}<span class="unit">亿元</span>`
      : `--<span class="unit">亿元</span>`;
  }
  if (sumBrEl) {
    const upStr   = hasBreadth ? totalUp.toLocaleString("zh-CN")   : "--";
    const downStr = hasBreadth ? totalDown.toLocaleString("zh-CN") : "--";
    const flatStr = hasBreadth ? totalFlat.toLocaleString("zh-CN") : "--";
    sumBrEl.innerHTML =
      `<div class="row up"><span class="k">上涨</span><span class="n up-n">${upStr}</span></div>` +
      `<div class="row down"><span class="k">下跌</span><span class="n down-n">${downStr}</span></div>` +
      `<div class="row flat"><span class="k">平盘</span><span class="n flat-n">${flatStr}</span></div>` +
      `<div class="row limit-up"><span class="k">涨停</span><span class="n lup-n">${lupStr}</span></div>` +
      `<div class="row limit-down"><span class="k">跌停</span><span class="n ldn-n">${ldnStr}</span></div>`;
  }
}

function renderJslTemperature() {  const numEl = document.getElementById("jsl-temp-num");
  const tagEl = document.getElementById("jsl-temp-tag");
  const subEl = document.getElementById("jsl-temp-sub");
  const data = window.JSL_TEMPERATURE;
  if (!data || typeof data.temperature !== "number") {
    numEl.textContent = "--";
    numEl.className = "temp-num";
    tagEl.textContent = "未生成";
    tagEl.className = "temp-tag tag-cool";
    subEl.textContent = "运行 py gen_jsl_temperature.py 生成";
    return;
  }
  const t = data.temperature;
  const cls = classifyTemp(t);
  numEl.textContent = t.toFixed(2);
  numEl.className = "temp-num temp-" + cls.cls;
  tagEl.textContent = cls.label;
  tagEl.className = "temp-tag tag-" + cls.cls;
  const bits = [];
  if (data.priceDate) bits.push(data.priceDate);
  if (data.medianPb != null) bits.push(`PB中位数 ${data.medianPb.toFixed(2)}`);
  if (data.medianPeTemperature != null) bits.push(`PE温度 ${data.medianPeTemperature.toFixed(1)}`);
  subEl.textContent = bits.join(" · ") || "集思录 median_pb_temperature";
}

function renderMarginRows(rows, container, subEl) {
  if (!rows || rows.length === 0) {
    container.innerHTML = `<span style="color:var(--muted);font-size:13px;">暂无数据</span>`;
    return;
  }
  const maxRzye = Math.max(...rows.map(r => r.rzye));
  container.innerHTML = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    const prev = i > 0 ? rows[i - 1].rzye : null;
    const diff = prev != null ? r.rzye - prev : null;
    const diffSign = diff == null ? "" : diff >= 0 ? "+" : "";
    const diffColor = diff == null ? "" : diff >= 0 ? "color:var(--up)" : "color:var(--down)";
    const barPct = maxRzye > 0 ? (r.rzye / maxRzye * 100).toFixed(1) : 0;
    const datePart = r.date.slice(5);
    return `
      <div style="display:flex;align-items:center;gap:6px;font-size:${isLast ? "14px" : "12px"};${isLast ? "font-weight:600;" : "color:var(--muted);"}">
        <span style="min-width:36px;">${datePart}</span>
        <div style="flex:1;background:#eef2f7;border-radius:3px;height:${isLast ? "6px" : "4px"};overflow:hidden;">
          <div style="width:${barPct}%;height:100%;background:${isLast ? "var(--accent)" : "#94a3b8"};border-radius:3px;"></div>
        </div>
        <span style="min-width:62px;text-align:right;">${r.rzye.toFixed(0)}<span style="font-size:10px;color:var(--muted);font-weight:400;margin-left:2px;">亿</span></span>
        ${diff != null ? `<span style="min-width:48px;font-size:11px;${diffColor}">${diffSign}${diff.toFixed(0)}</span>` : `<span style="min-width:48px;"></span>`}
      </div>`;
  }).join("");
  if (subEl) subEl.textContent = `数据截至 ${rows[rows.length - 1].date} · 东方财富`;
}

function renderInterfaceHealth() {
  const status = document.getElementById("interface-health-status");
  const sub = document.getElementById("interface-health-sub");
  const time = document.getElementById("interface-health-time");
  if (!status || typeof snapshotInterfaceHealth !== "function") return;
  const items = snapshotInterfaceHealth();
  if (items.length === 0) {
    status.textContent = "--";
    status.className = "";
    if (sub) sub.textContent = "等待首轮数据检查";
    return;
  }
  const failed = items.filter(item => !item.ok);
  const now = new Date();
  if (time) {
    time.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  if (failed.length === 0) {
    status.textContent = "正常";
    status.className = "temp-cool";
    if (sub) sub.textContent = `已检查 ${items.length} 个接口契约`;
    return;
  }
  status.textContent = `${failed.length} 项异常`;
  status.className = "temp-hot";
  if (sub) {
    sub.textContent = failed.slice(0, 2)
      .map(item => `${item.label}: ${item.detail || "字段异常"}`)
      .join("；");
  }
}
