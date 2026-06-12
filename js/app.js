const $ = (id) => document.getElementById(id);

const els = {
  version: $("version"),
  scheduleMode: $("scheduleMode"),
  intervalMinutes: $("intervalMinutes"),
  dailyTime: $("dailyTime"),
  badgeMode: $("badgeMode"),
  notifyOnAlarm: $("notifyOnAlarm"),
  newMarket: $("newMarket"),
  addMarket: $("addMarket"),
  markets: $("markets"),
  refresh: $("refresh"),
  save: $("save"),
  status: $("status"),
  lastFetchTime: $("lastFetchTime"),
  toggleConfig: $("toggleConfig"),
  configCard: $("configCard")
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

function marketRow({ market, ticker, removable, alertInfo }) {
  const isPrimary = state.settings && state.settings.primaryMarket === market;

  const card = document.createElement("div");
  card.className = "market-card" + (isPrimary ? " selected-badge" : "");

  // Header
  const header = document.createElement("div");
  header.className = "card-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "card-title-group";

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "primary-badge";
  radio.className = "badge-radio";
  radio.value = market;
  radio.checked = isPrimary;
  radio.title = "設為 Badge 顯示價格";
  radio.addEventListener("change", async () => {
    if (radio.checked) {
      state.settings.primaryMarket = market;
      await saveSettings();
    }
  });

  const badgeSpan = document.createElement("span");
  badgeSpan.className = "market-badge";
  badgeSpan.textContent = market.toUpperCase();

  const nameSpan = document.createElement("span");
  nameSpan.className = "market-name";
  const dict = { "0050": "元大台灣50", "0056": "元大高股息", "2330": "台積電", "usdttwd": "USDT/TWD", "btcusdt": "BTC/USDT" };
  const name = dict[market.toLowerCase()] || "";
  nameSpan.textContent = name;

  titleGroup.appendChild(radio);
  titleGroup.appendChild(badgeSpan);
  if (name) titleGroup.appendChild(nameSpan);

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove-card";
  removeBtn.type = "button";
  removeBtn.innerHTML = "&times;";
  removeBtn.title = "移除此項目";
  removeBtn.disabled = !removable;
  removeBtn.addEventListener("click", () => removeMarket(market));

  header.appendChild(titleGroup);
  header.appendChild(removeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "card-body";

  // Price Info (Left)
  const priceInfo = document.createElement("div");
  priceInfo.className = "price-info";

  const mainPrice = document.createElement("div");
  mainPrice.className = "price-item main-price";
  mainPrice.innerHTML = `<span class="price-label">最新</span><span class="price-val val-last">${ticker ? formatPrice(ticker.last) : "-"}</span>`;

  const buyPrice = document.createElement("div");
  buyPrice.className = "price-item";
  buyPrice.innerHTML = `<span class="price-label">買入</span><span class="price-val val-buy">${ticker ? formatPrice(ticker.buy) : "-"}</span>`;

  const sellPrice = document.createElement("div");
  sellPrice.className = "price-item";
  sellPrice.innerHTML = `<span class="price-label">賣出</span><span class="price-val val-sell">${ticker ? formatPrice(ticker.sell) : "-"}</span>`;

  priceInfo.appendChild(mainPrice);
  priceInfo.appendChild(buyPrice);
  priceInfo.appendChild(sellPrice);

  // Alert Info (Right)
  const alertInfoDiv = document.createElement("div");
  alertInfoDiv.className = "alert-info";

  const alertInputs = document.createElement("div");
  alertInputs.className = "alert-inputs";

  const highWrapper = document.createElement("div");
  highWrapper.className = "alert-input-wrapper";
  highWrapper.innerHTML = `<span class="alert-input-label">高標</span>`;
  const inpHigh = document.createElement("input");
  inpHigh.type = "number";
  inpHigh.className = "card-alert-input";
  inpHigh.placeholder = "上限";
  inpHigh.value = alertInfo?.high || "";
  highWrapper.appendChild(inpHigh);

  const lowWrapper = document.createElement("div");
  lowWrapper.className = "alert-input-wrapper";
  lowWrapper.innerHTML = `<span class="alert-input-label">低標</span>`;
  const inpLow = document.createElement("input");
  inpLow.type = "number";
  inpLow.className = "card-alert-input";
  inpLow.placeholder = "下限";
  inpLow.value = alertInfo?.low || "";
  lowWrapper.appendChild(inpLow);

  alertInputs.appendChild(highWrapper);
  alertInputs.appendChild(lowWrapper);

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "alert-toggle-label";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!alertInfo?.active;
  const cbText = document.createElement("span");
  cbText.textContent = "啟用示警";
  toggleLabel.appendChild(cb);
  toggleLabel.appendChild(cbText);

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

  alertInfoDiv.appendChild(alertInputs);
  alertInfoDiv.appendChild(toggleLabel);

  body.appendChild(priceInfo);
  body.appendChild(alertInfoDiv);

  card.appendChild(header);
  card.appendChild(body);

  return card;
}

function renderMarkets(settings, tickersByMarket) {
  els.markets.innerHTML = "";

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
  els.scheduleMode.value = s.scheduleMode;
  els.intervalMinutes.value = s.intervalMinutes;
  els.dailyTime.value = s.dailyTime;
  els.badgeMode.value = s.badgeMode;
  els.notifyOnAlarm.checked = s.notifyOnAlarm;

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
  
  // 透過 Radio Button 取得當前設定的主顯示商品
  const badgeRadio = document.querySelector('input[name="primary-badge"]:checked');
  const primaryMarket = badgeRadio ? badgeRadio.value : state.settings.primaryMarket;
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
  els.save.addEventListener("click", saveSettings);
  els.scheduleMode.addEventListener("change", updateScheduleUI);

  // 齒輪折疊設定區塊
  if (els.toggleConfig && els.configCard) {
    els.toggleConfig.addEventListener("click", () => {
      els.configCard.classList.toggle("hidden");
    });
  }

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
      if (message.alertText) {
        alert("⚠️ 價格觸發示警\n\n" + message.alertText);
      }
      load().catch(() => { });
    }
  });

  load().catch(() => { });
});
