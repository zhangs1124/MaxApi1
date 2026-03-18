const API_BASE = "https://max-api.maicoin.com/api/v2/tickers";
const BUILD_ID = Date.now().toString(36);

const DEFAULT_SETTINGS = {
  scheduleMode: "interval",
  intervalMinutes: 5,
  dailyTime: "09:00",
  markets: ["usdttwd", "btcusdt", "2330", "0050", "0056"],
  primaryMarket: "usdttwd",
  badgeMode: "last",
  notifyOnAlarm: true,
  alerts: {}
};

const ALARM_NAME = "max-ticker-fetch";
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const STOCK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function clampIntervalMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.intervalMinutes;
  if (parsed < 1) return 1;
  if (parsed > 1440) return 1440;
  return Math.floor(parsed);
}

function normalizeMarketInput(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const stockMatch = trimmed.match(/^(\d{4,6})(?:\.tw)?$/);
  if (stockMatch) return stockMatch[1];
  const normalized = trimmed.replace(/[^a-z0-9]/g, "");
  if (!/^[a-z0-9]{3,20}$/.test(normalized)) return null;
  return normalized;
}

function parseMarketsInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

function normalizeTime(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.dailyTime;
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return DEFAULT_SETTINGS.dailyTime;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return DEFAULT_SETTINGS.dailyTime;
  if (hh < 0 || hh > 23) return DEFAULT_SETTINGS.dailyTime;
  if (mm < 0 || mm > 59) return DEFAULT_SETTINGS.dailyTime;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function uniqueMarkets(values) {
  const out = [];
  const seen = new Set();
  for (const v of parseMarketsInput(values)) {
    const m = normalizeMarketInput(v);
    if (!m) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out.length > 0 ? out : [...DEFAULT_SETTINGS.markets];
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  const scheduleMode = stored.scheduleMode === "daily" ? "daily" : "interval";
  const markets = uniqueMarkets(stored.markets);
  const primaryMarket = normalizeMarketInput(stored.primaryMarket) || markets[0];
  const badgeMode = stored.badgeMode === "buy" || stored.badgeMode === "sell" || stored.badgeMode === "last" ? stored.badgeMode : DEFAULT_SETTINGS.badgeMode;
  const notifyOnAlarm = stored.notifyOnAlarm === false ? false : true;

  return {
    scheduleMode,
    intervalMinutes: clampIntervalMinutes(stored.intervalMinutes),
    dailyTime: normalizeTime(stored.dailyTime),
    markets,
    primaryMarket: markets.includes(primaryMarket) ? primaryMarket : markets[0],
    badgeMode,
    notifyOnAlarm,
    alerts: stored.alerts || {}
  };
}

function nextDailyWhenMs(dailyTime) {
  const [hh, mm] = dailyTime.split(":").map((v) => Number(v));
  const now = new Date();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() <= now.getTime() + 1000) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

async function ensureAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);

  if (settings.scheduleMode === "daily") {
    const when = nextDailyWhenMs(settings.dailyTime);
    chrome.alarms.create(ALARM_NAME, { when });
    return;
  }

  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.intervalMinutes });
}

async function fetchTicker(market) {
  if (/^\d{4,6}$/.test(market)) {
    return await fetchStockTicker(market);
  }

  const response = await fetch(`${API_BASE}/${market}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const at = typeof data.at === "number" ? data.at : null;
  const buy = typeof data.buy === "string" || typeof data.buy === "number" ? Number(data.buy) : null;
  const sell = typeof data.sell === "string" || typeof data.sell === "number" ? Number(data.sell) : null;
  const last = typeof data.last === "string" || typeof data.last === "number" ? Number(data.last) : null;

  if (!Number.isFinite(last)) {
    throw new Error("Invalid ticker payload");
  }

  return {
    market,
    atMs: typeof at === "number" ? at * 1000 : Date.now(),
    buy: Number.isFinite(buy) ? buy : null,
    sell: Number.isFinite(sell) ? sell : null,
    last
  };
}

async function fetchStockTicker(symbol) {
  const url = `${YAHOO_BASE}/${symbol}.TW?interval=1m&range=1d`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": STOCK_UA },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Stock HTTP ${response.status}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error("Missing stock data");
  }

  const meta = result.meta;
  const last = meta.regularMarketPrice;
  const buy = (result.indicators.quote[0].close || []).slice(-1)[0] || last; // Fallback to last
  const sell = last;

  if (!Number.isFinite(last)) {
    throw new Error("Invalid stock price");
  }

  return {
    market: symbol,
    atMs: Date.now(),
    buy: last, // Simplified for stocks as bid/ask is N/A in basic chart API
    sell: last,
    last
  };
}

function formatBadgePrice(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

async function updateBadge(tickersByMarket) {
  const settings = await getSettings();
  const ticker = tickersByMarket?.[settings.primaryMarket] || null;
  const price =
    settings.badgeMode === "buy" ? ticker?.buy :
      settings.badgeMode === "sell" ? ticker?.sell :
        ticker?.last;

  const text = formatBadgePrice(price);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}

async function saveTickers(tickersByMarket) {
  await chrome.storage.local.set({ tickersByMarket });
}

async function notifyUpdate(tickersByMarket) {
  const settings = await getSettings();
  if (!settings.notifyOnAlarm) return;

  const parts = [];
  for (const market of settings.markets) {
    const t = tickersByMarket?.[market];
    if (!t) continue;
    parts.push(`${market.toUpperCase()} ${Number(t.last).toFixed(2)}`);
  }
  const message = parts.length > 0 ? parts.join("\n") : "更新完成";

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: "報價更新",
      message
    });
  } catch {
  }
}

async function pollOnce({ reason }) {
  const settings = await getSettings();
  const markets = settings.markets;

  const results = await Promise.allSettled(markets.map((m) => fetchTicker(m)));
  const tickersByMarket = {};

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    tickersByMarket[r.value.market] = r.value;
  }

  await saveTickers(tickersByMarket);
  await updateBadge(tickersByMarket);

  let hasAlertTriggered = false;
  const currentAlerts = settings.alerts || {};
  let alertMessages = [];

  for (const market of Object.keys(tickersByMarket)) {
    const t = tickersByMarket[market];
    const item = currentAlerts[market];
    if (item && item.active && t.last !== null) {
      if (item.high !== null && t.last >= item.high) {
        alertMessages.push(`${market.toUpperCase()} 大於或等於高標 (${t.last} >= ${item.high})`);
        item.active = false;
        hasAlertTriggered = true;
      } else if (item.low !== null && t.last <= item.low) {
        alertMessages.push(`${market.toUpperCase()} 小於或等於低標 (${t.last} <= ${item.low})`);
        item.active = false;
        hasAlertTriggered = true;
      }
    }
  }

  if (hasAlertTriggered) {
    await chrome.storage.sync.set({ alerts: currentAlerts });
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icon128.png",
        title: "⚠️ 價格觸發示警",
        message: alertMessages.join("\n"),
        priority: 2
      });
    } catch { }
    chrome.runtime.sendMessage({ type: "alertsUpdated" }).catch(() => { });
  }

  if (reason === "alarm" && !hasAlertTriggered) {
    await notifyUpdate(tickersByMarket);
  }

  return tickersByMarket;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  const toSet = {};

  // Force migration for markets to include new defaults
  const currentMarkets = existing.markets ? (Array.isArray(existing.markets) ? existing.markets : [existing.markets]) : [];
  const mergedMarkets = [...new Set([...currentMarkets, ...DEFAULT_SETTINGS.markets])];
  toSet.markets = mergedMarkets;

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined && key !== 'markets') {
      toSet[key] = value;
    }
  }

  await chrome.storage.sync.set(toSet);
  await ensureAlarm();
  await pollOnce({ reason: "install" });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await pollOnce({ reason: "startup" });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await pollOnce({ reason: "alarm" });

  const settings = await getSettings();
  if (settings.scheduleMode === "daily") {
    await ensureAlarm();
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync") return;
  const keys = ["scheduleMode", "intervalMinutes", "dailyTime", "markets", "primaryMarket", "badgeMode", "notifyOnAlarm"];
  const changed = keys.some((k) => Boolean(changes[k]));
  if (!changed) return;

  await ensureAlarm();
  const stored = await chrome.storage.local.get(["tickersByMarket"]);
  if (stored.tickersByMarket) {
    await updateBadge(stored.tickersByMarket);
  } else {
    await pollOnce({ reason: "settings" });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return;

    if (message.type === "getStatus") {
      const settings = await getSettings();
      const stored = await chrome.storage.local.get(["tickersByMarket"]);
      sendResponse({ ok: true, settings, tickersByMarket: stored.tickersByMarket || {}, buildId: BUILD_ID });
      return;
    }

    if (message.type === "setSettings") {
      const nextScheduleMode = message.scheduleMode === "daily" ? "daily" : "interval";
      const nextIntervalMinutes = clampIntervalMinutes(message.intervalMinutes);
      const nextDailyTime = normalizeTime(message.dailyTime);
      const nextMarkets = uniqueMarkets(message.markets);
      const nextPrimaryMarket = normalizeMarketInput(message.primaryMarket) || nextMarkets[0];
      const nextBadgeMode = message.badgeMode === "buy" || message.badgeMode === "sell" || message.badgeMode === "last" ? message.badgeMode : DEFAULT_SETTINGS.badgeMode;
      const nextNotifyOnAlarm = message.notifyOnAlarm === false ? false : true;

      await chrome.storage.sync.set({
        scheduleMode: nextScheduleMode,
        intervalMinutes: nextIntervalMinutes,
        dailyTime: nextDailyTime,
        markets: nextMarkets,
        primaryMarket: nextMarkets.includes(nextPrimaryMarket) ? nextPrimaryMarket : nextMarkets[0],
        badgeMode: nextBadgeMode,
        notifyOnAlarm: nextNotifyOnAlarm
      });

      sendResponse({ ok: true });
      return;
    }

    if (message.type === "setAlertItem") {
      const settings = await getSettings();
      const currentAlerts = settings.alerts || {};
      currentAlerts[message.market] = {
        active: message.active,
        high: message.high,
        low: message.low
      };
      await chrome.storage.sync.set({ alerts: currentAlerts });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "refreshNow") {
      const tickersByMarket = await pollOnce({ reason: "manual" });
      sendResponse({ ok: true, tickersByMarket });
      return;
    }

    if (message.type === "addMarket") {
      const settings = await getSettings();
      const newMarket = normalizeMarketInput(message.market);
      if (!newMarket) {
        sendResponse({ ok: false, error: "invalid_market_format" });
        return;
      }
      const updatedMarkets = uniqueMarkets([...settings.markets, newMarket]);
      await chrome.storage.sync.set({ markets: updatedMarkets });
      await pollOnce({ reason: "manual" });
      sendResponse({ ok: true, markets: updatedMarkets });
      return;
    }

    if (message.type === "removeMarket") {
      const settings = await getSettings();
      const targetMarket = normalizeMarketInput(message.market);
      if (!targetMarket) {
        sendResponse({ ok: false, error: "invalid_market_format" });
        return;
      }
      if (!settings.markets.includes(targetMarket)) {
        sendResponse({ ok: true, markets: settings.markets, primaryMarket: settings.primaryMarket });
        return;
      }
      if (settings.markets.length <= 1) {
        sendResponse({ ok: false, error: "cannot_remove_last_market" });
        return;
      }
      const updatedMarkets = settings.markets.filter((m) => m !== targetMarket);
      const updatedPrimary = updatedMarkets.includes(settings.primaryMarket) ? settings.primaryMarket : updatedMarkets[0];
      await chrome.storage.sync.set({ markets: updatedMarkets, primaryMarket: updatedPrimary });
      sendResponse({ ok: true, markets: updatedMarkets, primaryMarket: updatedPrimary });
      return;
    }

    sendResponse({ ok: false, error: "unknown_message_type" });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || "unknown_error" });
  });

  return true;
});

