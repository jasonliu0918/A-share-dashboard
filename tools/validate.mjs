import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ok = [];

function pass(message) {
  ok.push(message);
  console.log(`[ok] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function readProjectFile(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function compileJs(source, label) {
  new vm.Script(source, { filename: label });
}

const html = await readProjectFile("index.html");

const cssRefs = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi)].map((m) => m[1]);
const scriptRefs = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["'][^>]*>/gi)].map((m) => m[1]);

for (const ref of [...cssRefs, ...scriptRefs]) {
  if (!existsSync(join(root, ref))) fail(`Missing referenced asset: ${ref}`);
}
pass(`HTML references ${cssRefs.length} CSS file(s) and ${scriptRefs.length} JS file(s)`);

const dashboardScripts = scriptRefs.filter((ref) => !["pb_history.js", "jsl_temperature.js"].includes(ref));
const dashboardSources = [];
for (const ref of dashboardScripts) {
  const source = await readProjectFile(ref);
  compileJs(source, ref);
  dashboardSources.push(source);
}
compileJs(dashboardSources.join("\n"), "dashboard-combined.js");
pass("dashboard script syntax");

const dataContext = {
  window: {},
  document: { createElement: () => ({}), head: { appendChild: () => {} } },
  setTimeout,
  clearTimeout,
};
vm.createContext(dataContext);
vm.runInContext(
  `${await readProjectFile("assets/trading-calendar.js")}\nwindow.A_SHARE_TRADING_CALENDAR = A_SHARE_TRADING_CALENDAR;`,
  dataContext,
  { filename: "assets/trading-calendar.js" },
);
vm.runInContext(await readProjectFile("pb_history.js"), dataContext, { filename: "pb_history.js" });
vm.runInContext(await readProjectFile("jsl_temperature.js"), dataContext, { filename: "jsl_temperature.js" });

const calendar = dataContext.window.A_SHARE_TRADING_CALENDAR;
if (!calendar || !calendar.closedDates || !calendar.closedDates.has("2026-05-01")) {
  fail("A_SHARE_TRADING_CALENDAR has unexpected structure");
}
pass(`A_SHARE_TRADING_CALENDAR structure (${calendar.closedDates.size} closed dates)`);

const pb = dataContext.window.PB_HISTORY;
if (!pb || !Array.isArray(pb.sorted10y) || !Array.isArray(pb.sortedAll) || !pb.meta) {
  fail("PB_HISTORY has unexpected structure");
}
if (pb.sorted10y.length === 0 || pb.sortedAll.length === 0) {
  fail("PB_HISTORY arrays are empty");
}
pass(`PB_HISTORY structure (${pb.sorted10y.length} recent points, ${pb.sortedAll.length} total points)`);

const jsl = dataContext.window.JSL_TEMPERATURE;
if (!jsl || typeof jsl.temperature !== "number") {
  fail("JSL_TEMPERATURE has unexpected structure");
}
pass(`JSL_TEMPERATURE structure (${jsl.temperature})`);

const bundledPython = join(
  homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);
const pythonCandidates = [
  { command: "py", argsPrefix: ["-m"] },
  { command: "python", argsPrefix: ["-m"] },
  { command: "python3", argsPrefix: ["-m"] },
  ...(existsSync(bundledPython) ? [{ command: bundledPython, argsPrefix: ["-m"] }] : []),
];

function compilePython(script) {
  const attempts = [];
  for (const candidate of pythonCandidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.argsPrefix, "py_compile", join(root, script)],
      { cwd: root, encoding: "utf8" },
    );
    attempts.push({ candidate, result });
    if (result.status === 0) return { candidate, result };
    if (result.error) continue;
    return { candidate, result };
  }
  return attempts[attempts.length - 1];
}

for (const script of ["gen_pb_history.py", "gen_jsl_temperature.py"]) {
  const { candidate, result } = compilePython(script);
  if (result.status !== 0) {
    const detail = result.error ? result.error.message : (result.stderr || result.stdout || "unknown error");
    fail(`${script} failed to compile with ${candidate.command}:\n${detail}`);
  }
}
pass("Python scripts compile");

const runLive = !!(globalThis.process && globalThis.process.argv && globalThis.process.argv.includes("--live"));

async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) fail(`HTTP ${response.status}: ${url}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonp(url, callbackParam = "cb") {
  const cbName = `validate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const sep = url.includes("?") ? "&" : "?";
  const text = (await fetchText(`${url}${sep}${callbackParam}=${cbName}`)).trim();
  const prefix = `${cbName}(`;
  if (!text.startsWith(prefix) || !text.endsWith(");")) {
    fail(`Unexpected JSONP wrapper for ${url}`);
  }
  return JSON.parse(text.slice(prefix.length, -2));
}

function requirePath(obj, path, label) {
  const value = path.split(".").reduce((acc, key) => acc == null ? undefined : acc[key], obj);
  if (value == null || value === "-") fail(`Live contract failed: ${label} missing ${path}`);
  return value;
}

async function runLiveInterfaceContracts() {
  const quote = await fetchJsonp(
    "https://push2.eastmoney.com/api/qt/stock/get?secid=1.000001&fields=f43,f48,f86&ut=fa5fd1943c7b386f172d6893dbfba10b",
  );
  requirePath(quote, "data.f43", "eastmoney quote");
  requirePath(quote, "data.f48", "eastmoney quote");
  requirePath(quote, "data.f86", "eastmoney quote");

  const clist = await fetchJsonp(
    "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=1&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%3A1%2Bt%3A2&fields=f3,f20,f23&ut=bd1d9ddb04089700cf9c27f6f7426281",
  );
  const first = clist && clist.data && clist.data.diff && clist.data.diff[0];
  if (!first || first.f3 == null || first.f20 == null || first.f23 == null) {
    fail("Live contract failed: eastmoney clist fields f3/f20/f23");
  }

  const kline = await fetchJsonp(
    "https://push2.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=0&end=20500000&lmt=1&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60&ut=fa5fd1943c7b386f172d6893dbfba10b",
  );
  const line = kline && kline.data && kline.data.klines && kline.data.klines[0];
  if (!line || line.split(",").length < 7 || !Number.isFinite(Number(line.split(",")[6]))) {
    fail("Live contract failed: eastmoney kline amount field");
  }

  const margin = await fetchJsonp(
    "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_MARGIN_DAILYTRADE&columns=STATISTICS_DATE,FIN_BALANCE,LOAN_BALANCE,FIN_BUY_AMT&pageNumber=1&pageSize=1&sortColumns=STATISTICS_DATE&sortTypes=-1",
    "callback",
  );
  const marginRow = margin && margin.result && margin.result.data && margin.result.data[0];
  if (!marginRow || marginRow.FIN_BALANCE == null || marginRow.LOAN_BALANCE == null) {
    fail("Live contract failed: margin fields");
  }

  pass("live interface contracts");
}

if (runLive) {
  await runLiveInterfaceContracts();
}

console.log(`\nValidation passed (${ok.length} checks).`);
