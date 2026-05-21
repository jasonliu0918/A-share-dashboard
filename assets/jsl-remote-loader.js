// 集思录温度远程加载器
// 浏览器不能稳定直连集思录 POST 接口；这里加载 GitHub Pages/静态 CDN 上由 Actions 更新的 JS。

function parseJslFetchedAt(data) {
  if (!data || !data.fetchedAt) return 0;
  const normalized = String(data.fetchedAt).replace(" ", "T");
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : 0;
}

function loadScriptOnce(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      if (s.parentNode) s.parentNode.removeChild(s);
      reject(new Error("timeout"));
    }, timeoutMs);
    s.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (s.parentNode) s.parentNode.removeChild(s);
      resolve();
    };
    s.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (s.parentNode) s.parentNode.removeChild(s);
      reject(new Error("script error"));
    };
    s.src = url;
    document.head.appendChild(s);
  });
}

async function loadRemoteJslTemperature() {
  const url = (window.JSL_TEMPERATURE_REMOTE_URL || "").trim();
  if (!url) return false;
  const local = window.JSL_TEMPERATURE || null;
  const remoteKey = "__REMOTE_JSL_TEMPERATURE__";
  const previousRemote = window[remoteKey];
  try {
    delete window[remoteKey];
  } catch {}
  const before = window.JSL_TEMPERATURE;
  const sep = url.includes("?") ? "&" : "?";
  await loadScriptOnce(`${url}${sep}_=${Date.now()}`);
  const loaded = window.JSL_TEMPERATURE;
  if (loaded && loaded !== before && typeof loaded.temperature === "number") {
    const localTs = parseJslFetchedAt(local);
    const loadedTs = parseJslFetchedAt(loaded);
    if (!local || loadedTs >= localTs) return true;
    window.JSL_TEMPERATURE = local;
    return false;
  }
  if (previousRemote) window[remoteKey] = previousRemote;
  return false;
}
