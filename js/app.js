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
  status: $("status"),
  refreshBottom: $("refreshBottom"),
  lastFetchTime: $("lastFetchTime")
};

let manifestVersion = "";

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
  if (/^\d/.test(m)) return "單位 TWD";
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
  tickersByMarket: {},
  buildId: ""
};

let testTimerId = null;
let testInFlight = false;

function setTestStatus(text) {
  els.testStatus.textContent = text || "";
}

async function removeMarket(market) {
  setStatus("移除中");
  const res = await sendMessage({ type: "removeMarket", market });
  if (!res?.ok) {
    setStatus(res?.error || "移除失敗");
    return;
  }
  await load();
  setStatus("已移除");
  setTimeout(() => setStatus(""), 900);
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

function marketRow({ market, ticker, removable, alertInfo }) {
  const row = document.createElement("div");
  row.className = "market-row";

  const c1 = document.createElement("a");
  c1.className = "market-cell market-name";
  const dict = { "0050": "元大台灣50", "0056": "元大高股息", "2330": "台積電", "usdttwd": "USDT/TWD", "btcusdt": "BTC/USDT" };
  const name = dict[String(market).toLowerCase()];
  c1.textContent = name ? `${market.toUpperCase()} ${name}` : market.toUpperCase();

  c1.href = /^\d{4,6}$/.test(String(market).toLowerCase())
    ? `https://tw.stock.yahoo.com/quote/${market}.TW`
    : `https://max.maicoin.com/trades/${market.toLowerCase()}`;
  c1.target = "_blank";
  c1.style.textDecoration = "none";
  c1.style.color = "var(--primary)";

  const c2 = document.createElement("div");
  c2.className = "market-cell";
  c2.textContent = ticker ? formatPrice(ticker.last) : "-";

  const c3 = document.createElement("div");
  c3.className = "market-cell";
  c3.textContent = ticker ? formatPrice(ticker.buy) : "-";

  const c4 = document.createElement("div");
  c4.className = "market-cell";
  c4.textContent = ticker ? formatPrice(ticker.sell) : "-";

  const aHigh = alertInfo?.high || "";
  const aLow = alertInfo?.low || "";
  const aActive = !!alertInfo?.active;

  const cHigh = document.createElement("div");
  cHigh.className = "market-cell";
  const inpHigh = document.createElement("input");
  inpHigh.type = "number";
  inpHigh.className = "alert-input";
  inpHigh.placeholder = "上限";
  inpHigh.value = aHigh;
  cHigh.appendChild(inpHigh);

  const cLow = document.createElement("div");
  cLow.className = "market-cell";
  const inpLow = document.createElement("input");
  inpLow.type = "number";
  inpLow.className = "alert-input";
  inpLow.placeholder = "下限";
  inpLow.value = aLow;
  cLow.appendChild(inpLow);

  const cActive = document.createElement("div");
  cActive.className = "market-cell";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "market-checkbox";
  cb.checked = aActive;
  cActive.appendChild(cb);

  const saveAlert = async () => {
    const hVal = inpHigh.value ? Number(inpHigh.value) : null;
    const lVal = inpLow.value ? Number(inpLow.value) : null;
    const isAct = cb.checked;

    if (!state.settings) return;
    if (!state.settings.alerts) state.settings.alerts = {};
    state.settings.alerts[market] = { active: isAct, high: hVal, low: lVal };

    await sendMessage({
      type: "setAlertItem",
      market,
      active: isAct,
      high: hVal,
      low: lVal
    });
  };
  inpHigh.addEventListener("change", saveAlert);
  inpLow.addEventListener("change", saveAlert);
  cb.addEventListener("change", saveAlert);

  const c5 = document.createElement("div");
  c5.className = "market-cell market-actions";
  const removeButton = document.createElement("button");
  removeButton.className = "btn btn-sm btn-danger";
  removeButton.type = "button";
  removeButton.textContent = "移除";
  removeButton.disabled = !removable;
  removeButton.addEventListener("click", async () => {
    setStatus("移除中");
    const res = await sendMessage({ type: "removeMarket", market });
    if (!res?.ok) {
      setStatus(res?.error || "移除失敗");
      return;
    }
    await load();
    setStatus("");
  });
  c5.appendChild(removeButton);

  row.appendChild(c1);
  row.appendChild(c2);
  row.appendChild(c3);
  row.appendChild(c4);
  row.appendChild(cHigh);
  row.appendChild(cLow);
  row.appendChild(cActive);
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
    <div class="market-cell">上限</div>
    <div class="market-cell">下限</div>
    <div class="market-cell" style="text-align: center;">啟用</div>
    <div class="market-cell">操作</div>
  `;
  els.markets.appendChild(head);

  const removable = settings.markets.length > 1;
  const alerts = settings.alerts || {};
  for (const market of settings.markets) {
    els.markets.appendChild(marketRow({
      market,
      ticker: tickersByMarket[market] || null,
      removable,
      alertInfo: alerts[market]
    }));
  }
}

function renderAll() {
  if (!state.settings) return;
  const s = state.settings;
  renderPrimaryMarketSelect(s.markets, s.primaryMarket);
  els.scheduleMode.value = s.scheduleMode;
  els.intervalMinutes.value = s.intervalMinutes;
  els.dailyTime.value = s.dailyTime;
  els.badgeMode.value = s.badgeMode;
  els.notifyOnAlarm.checked = s.notifyOnAlarm;

  const primaryTicker = state.tickersByMarket?.[s.primaryMarket] || null;
  renderPrimaryTicker(s.primaryMarket, primaryTicker);
  renderMarkets(s, state.tickersByMarket || {});
  updateScheduleUI();

  let maxTimeMs = 0;
  for (const market of s.markets) {
    if (state.tickersByMarket[market] && state.tickersByMarket[market].atMs) {
      if (state.tickersByMarket[market].atMs > maxTimeMs) {
        maxTimeMs = state.tickersByMarket[market].atMs;
      }
    }
  }
  if (els.lastFetchTime) {
    els.lastFetchTime.textContent = maxTimeMs > 0 ? `最後抓取時間: ${formatTime(maxTimeMs)}` : `最後抓取時間: -`;
  }

  if (els.version && manifestVersion) {
    const suffix = state.buildId ? `-${state.buildId}` : "";
    els.version.textContent = `${manifestVersion}${suffix}`;
  }
}

async function load() {
  setStatus("讀取中");
  let res = null;
  try {
    res = await sendMessage({ type: "getStatus" });
  } catch (err) {
    setStatus("讀取失敗");
    return;
  }
  if (!res?.ok) {
    setStatus(res?.error || "讀取失敗");
    return;
  }

  state.settings = res.settings;
  state.tickersByMarket = res.tickersByMarket || {};
  state.buildId = res.buildId || "";
  renderAll();
  setStatus("");
}

async function refreshNow() {
  setStatus("更新中");
  const res = await sendMessage({ type: "refreshNow" });
  if (!res?.ok) {
    setStatus(res?.error || "更新失敗");
    return;
  }
  await load();
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
  const markets = state.settings.markets;

  const res = await sendMessage({
    type: "setSettings",
    scheduleMode,
    intervalMinutes,
    dailyTime,
    markets,
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

document.addEventListener("DOMContentLoaded", () => {
  if (els.version) {
    const v = chrome.runtime.getManifest?.().version;
    manifestVersion = v ? `v${v}` : "";
    els.version.textContent = manifestVersion;
  }

  els.refresh.addEventListener("click", refreshNow);
  if (els.refreshBottom) els.refreshBottom.addEventListener("click", refreshNow);
  els.save.addEventListener("click", saveSettings);
  els.primaryMarket.addEventListener("change", () => {
    if (!state.settings) return;
    state.settings.primaryMarket = els.primaryMarket.value;
    renderAll();
  });
  els.scheduleMode.addEventListener("change", updateScheduleUI);

  els.addMarket.addEventListener("click", async () => {
    if (!state.settings) return;
    const newMarketValue = String(els.newMarket.value || "").trim();
    if (!newMarketValue) return;

    setStatus("新增中");
    const res = await sendMessage({ type: "addMarket", market: newMarketValue });
    if (!res?.ok) {
      setStatus(res?.error || "新增失敗");
      return;
    }
    els.newMarket.value = "";
    await load();
    setStatus("已新增");
    setTimeout(() => setStatus(""), 900);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "alertsUpdated") {
      load().catch(() => { });
    }
  });

  load().catch(() => { });
});

