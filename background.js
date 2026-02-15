const API_BASE = "https://max-api.maicoin.com/api/v2/tickers";

const DEFAULT_SETTINGS = {
  scheduleMode: "interval",
  intervalMinutes: 5,
  dailyTime: "09:00",
  markets: ["usdttwd", "btcusdt"],
  primaryMarket: "usdttwd",
  badgeMode: "last",
  notifyOnAlarm: true
};

const ALARM_NAME = "max-ticker-fetch";

function clampIntervalMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.intervalMinutes;
  if (parsed < 1) return 1;
  if (parsed > 1440) return 1440;
  return Math.floor(parsed);
}

function normalizeMarketInput(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replaceAll(" ", "").replaceAll("/", "").replaceAll("_", "").replaceAll("-", "");
  if (!/^[a-z0-9]{3,20}$/.test(normalized)) return null;
  return normalized;
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
  for (const v of Array.isArray(values) ? values : []) {
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
    notifyOnAlarm
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

  await chrome.notifications.create({
    type: "basic",
    iconUrl: "https://max.maicoin.com/favicon.ico",
    title: "MAX 報價更新",
    message
  });
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

  if (reason === "alarm") {
    await notifyUpdate(tickersByMarket);
  }

  return tickersByMarket;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) {
      toSet[key] = value;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }
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
      sendResponse({ ok: true, settings, tickersByMarket: stored.tickersByMarket || {} });
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

    if (message.type === "addMarket") {
      const settings = await getSettings();
      const m = normalizeMarketInput(message.market);
      if (!m) {
        sendResponse({ ok: false, error: "market_invalid" });
        return;
      }
      const markets = uniqueMarkets([...settings.markets, m]);
      await chrome.storage.sync.set({ markets });
      sendResponse({ ok: true, markets });
      return;
    }

    if (message.type === "removeMarket") {
      const settings = await getSettings();
      const m = normalizeMarketInput(message.market);
      const markets = uniqueMarkets(settings.markets.filter((x) => x !== m));
      const primaryMarket = markets.includes(settings.primaryMarket) ? settings.primaryMarket : markets[0];
      await chrome.storage.sync.set({ markets, primaryMarket });
      sendResponse({ ok: true, markets, primaryMarket });
      return;
    }

    if (message.type === "refreshNow") {
      const tickersByMarket = await pollOnce({ reason: "manual" });
      sendResponse({ ok: true, tickersByMarket });
      return;
    }

    sendResponse({ ok: false, error: "unknown_message_type" });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || "unknown_error" });
  });

  return true;
});
