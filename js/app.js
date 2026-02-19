const $ = (id) => document.getElementById(id);

const els = {
  primaryMarketLabel: $("primaryMarketLabel"),
  version: $("version"),
  last: $("last"),
  buy: $("buy"),
  sell: $("sell"),
  updatedAt: $("updatedAt"),
  unit: $("unit"),
  primaryMarket: $("primaryMarket"),
  scheduleMode: $("scheduleMode"),
  intervalMinutes: $("intervalMinutes"),
  dailyTime: $("dailyTime"),
  badgeMode: $("badgeMode"),
  notifyOnAlarm: $("notifyOnAlarm"),
  newMarket: $("newMarket"),
  addMarket: $("addMarket"),
  markets: $("markets"),
  testSeconds: $("testSeconds"),
  testStart: $("testStart"),
  testStop: $("testStop"),
  testStatus: $("testStatus"),
  refresh: $("refresh"),
  save: $("save"),
  openTrade: $("openTrade"),
  status: $("status")
};

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(2);
}

function formatTime(atMs) {
  const ms = Number(atMs);
  if (!Number.isFinite(ms)) return "-";
  const d = new Date(ms);
  return d.toLocaleString("zh-TW", { hour12: false });
}

function setStatus(text) {
  els.status.textContent = text || "";
}

function inferUnitFromMarket(market) {
  if (typeof market !== "string") return "-";
  const m = market.toLowerCase();
  if (m.endsWith("twd")) return "單位 TWD";
  if (m.endsWith("usdt")) return "單位 USDT";
  return "-";
}

function renderPrimaryTicker(market, ticker) {
  els.primaryMarketLabel.textContent = market ? `${market.toUpperCase()} 最新` : "最新";
  if (!ticker) {
    els.last.textContent = "-";
    els.buy.textContent = "-";
    els.sell.textContent = "-";
    els.updatedAt.textContent = "-";
    els.unit.textContent = "-";
    return;
  }

  els.last.textContent = formatPrice(ticker.last);
  els.buy.textContent = formatPrice(ticker.buy);
  els.sell.textContent = formatPrice(ticker.sell);
  els.updatedAt.textContent = `更新 ${formatTime(ticker.atMs)}`;
  els.unit.textContent = inferUnitFromMarket(market);
}

async function sendMessage(message) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      lastError = err;
      const waitMs = 150 * (2 ** attempt);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError || new Error("send_message_failed");
}

let state = {
  settings: null,
  tickersByMarket: {}
};

let testTimerId = null;
let testInFlight = false;

function setTestStatus(text) {
  els.testStatus.textContent = text || "";
}

function updateScheduleUI() {
  const mode = els.scheduleMode.value;
  const intervalRow = els.intervalMinutes.closest(".form-row");
  const dailyRow = els.dailyTime.closest(".form-row");
  if (mode === "daily") {
    intervalRow.classList.add("hidden");
    dailyRow.classList.remove("hidden");
  } else {
    dailyRow.classList.add("hidden");
    intervalRow.classList.remove("hidden");
  }
}

function renderPrimaryMarketSelect(markets, primaryMarket) {
  els.primaryMarket.innerHTML = "";
  for (const m of Array.isArray(markets) ? markets : []) {
    const option = document.createElement("option");
    option.value = m;
    option.textContent = m.toUpperCase();
    els.primaryMarket.appendChild(option);
  }
  els.primaryMarket.value = primaryMarket;
  if (!els.primaryMarket.value && Array.isArray(markets) && markets.length > 0) {
    els.primaryMarket.value = markets[0];
  }
}

function marketRow({ market, ticker, removable }) {
  const row = document.createElement("div");
  row.className = "market-row";

  const c1 = document.createElement("div");
  c1.className = "market-cell";
  c1.textContent = market.toUpperCase();

  const c2 = document.createElement("div");
  c2.className = "market-cell";
  c2.textContent = ticker ? formatPrice(ticker.last) : "-";

  const c3 = document.createElement("div");
  c3.className = "market-cell";
  c3.textContent = ticker ? formatPrice(ticker.buy) : "-";

  const c4 = document.createElement("div");
  c4.className = "market-cell";
  c4.textContent = ticker ? formatPrice(ticker.sell) : "-";

  const c5 = document.createElement("button");
  c5.className = "market-remove";
  c5.type = "button";
  c5.textContent = "移除";
  c5.disabled = !removable;
  c5.addEventListener("click", async () => {
    setStatus("移除中");
    const res = await sendMessage({ type: "removeMarket", market });
    if (!res?.ok) {
      setStatus(res?.error || "移除失敗");
      return;
    }
    await load();
    setStatus("");
  });

  row.appendChild(c1);
  row.appendChild(c2);
  row.appendChild(c3);
  row.appendChild(c4);
  row.appendChild(c5);
  return row;
}

function renderMarkets(settings, tickersByMarket) {
  els.markets.innerHTML = "";

  const head = document.createElement("div");
  head.className = "market-row market-head";
  head.innerHTML = `
    <div class="market-cell">交易對</div>
    <div class="market-cell">最新</div>
    <div class="market-cell">買</div>
    <div class="market-cell">賣</div>
    <div class="market-cell"></div>
  `;
  els.markets.appendChild(head);

  const removable = settings.markets.length > 1;
  for (const market of settings.markets) {
    els.markets.appendChild(marketRow({ market, ticker: tickersByMarket[market] || null, removable }));
  }
}

function renderAll() {
  if (!state.settings) return;
  const s = state.settings;
  renderPrimaryMarketSelect(s.markets, s.primaryMarket);
  if (els.primaryMarket.value && s.primaryMarket !== els.primaryMarket.value) {
    s.primaryMarket = els.primaryMarket.value;
  }
  els.scheduleMode.value = s.scheduleMode;
  els.intervalMinutes.value = s.intervalMinutes;
  els.dailyTime.value = s.dailyTime;
  els.badgeMode.value = s.badgeMode;
  els.notifyOnAlarm.checked = s.notifyOnAlarm;

  const primaryTicker = state.tickersByMarket?.[s.primaryMarket] || null;
  renderPrimaryTicker(s.primaryMarket, primaryTicker);
  renderMarkets(s, state.tickersByMarket || {});
  updateScheduleUI();
}

async function load() {
  setStatus("讀取中");
  let res = null;
  try {
    res = await sendMessage({ type: "getStatus" });
  } catch (err) {
    setStatus("讀取失敗 可按保存或更新");
    return;
  }
  if (!res?.ok) {
    setStatus(res?.error || "讀取失敗");
    return;
  }

  state.settings = res.settings;
  state.tickersByMarket = res.tickersByMarket || {};
  renderAll();
  setStatus("");

  const markets = Array.isArray(state.settings?.markets) ? state.settings.markets : [];
  const tickers = state.tickersByMarket || {};
  const needsRefresh = markets.length > 0 && markets.some((m) => {
    const t = tickers[m];
    return !t || !Number.isFinite(Number(t.last));
  });
  if (needsRefresh) {
    refreshNow().catch(() => {});
  }
}

async function refreshNow() {
  setStatus("更新中");
  const res = await sendMessage({ type: "refreshNow" });
  if (!res?.ok) {
    setStatus(res?.error || "更新失敗");
    return;
  }
  state.tickersByMarket = res.tickersByMarket || {};
  renderAll();
  setStatus("");
}

async function saveSettings() {
  setStatus("保存中");
  const scheduleMode = els.scheduleMode.value;
  const intervalMinutes = Number(els.intervalMinutes.value);
  const dailyTime = els.dailyTime.value;
  const badgeMode = els.badgeMode.value;
  const notifyOnAlarm = Boolean(els.notifyOnAlarm.checked);
  const primaryMarket = els.primaryMarket.value;

  const res = await sendMessage({
    type: "setSettings",
    scheduleMode,
    intervalMinutes,
    dailyTime,
    markets: state.settings?.markets || [],
    primaryMarket,
    badgeMode,
    notifyOnAlarm
  });
  if (!res?.ok) {
    setStatus(res?.error || "保存失敗");
    return;
  }
  await load();
  setStatus("已保存");
  setTimeout(() => setStatus(""), 900);
}

function openTradePage() {
  const market = els.primaryMarket.value || "usdttwd";
  chrome.tabs.create({ url: `https://max.maicoin.com/trades/${market}` });
}

async function addMarket() {
  const value = String(els.newMarket.value || "").trim();
  if (!value) return;
  setStatus("加入中");
  const res = await sendMessage({ type: "addMarket", market: value });
  if (!res?.ok) {
    setStatus(res?.error || "加入失敗");
    return;
  }
  els.newMarket.value = "";
  await load();
  setStatus("");
}

async function testTickOnce() {
  if (testInFlight) return;
  testInFlight = true;
  try {
    await refreshNow();
  } finally {
    testInFlight = false;
  }
}

function stopTest() {
  if (testTimerId) {
    clearInterval(testTimerId);
    testTimerId = null;
  }
  setTestStatus("");
}

async function startTest() {
  stopTest();
  const seconds = Number(els.testSeconds.value);
  const period = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 5;
  setTestStatus(`測試中 每 ${period} 秒更新`);
  await testTickOnce();
  testTimerId = setInterval(() => {
    testTickOnce();
  }, period * 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  if (els.version) {
    const v = chrome.runtime.getManifest?.().version;
    els.version.textContent = v ? `v${v}` : "";
  }

  els.refresh.addEventListener("click", refreshNow);
  els.save.addEventListener("click", saveSettings);
  els.addMarket.addEventListener("click", addMarket);
  els.testStart.addEventListener("click", () => startTest().catch((err) => setTestStatus(err?.message || "測試失敗")));
  els.testStop.addEventListener("click", stopTest);
  els.newMarket.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addMarket();
  });
  els.primaryMarket.addEventListener("change", () => {
    if (!state.settings) return;
    state.settings.primaryMarket = els.primaryMarket.value;
    renderAll();
  });
  els.scheduleMode.addEventListener("change", () => {
    updateScheduleUI();
  });
  els.openTrade.addEventListener("click", (e) => {
    e.preventDefault();
    openTradePage();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes.tickersByMarket) return;
    state.tickersByMarket = changes.tickersByMarket.newValue || {};
    renderAll();
  });

  load().catch((err) => setStatus(err?.message || "讀取失敗"));
  setTimeout(() => {
    if (!state.settings) {
      load().catch(() => {});
    }
  }, 400);
});
