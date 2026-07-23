const DEFAULT_API_KEY = 'sqz5OjdsyxNW2e0i3aF5BA0p5rpd0fHU';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PRICES_ENDPOINTS = {
  app: 'https://api.gg.deals/v1/prices/by-steam-app-id/',
  sub: 'https://api.gg.deals/v1/prices/by-steam-sub-id/',
  bundle: 'https://api.gg.deals/v1/prices/by-steam-bundle-id/',
};
const BUNDLES_ENDPOINTS = {
  app: 'https://api.gg.deals/v1/bundles/by-steam-app-id/',
  sub: 'https://api.gg.deals/v1/bundles/by-steam-sub-id/',
  bundle: 'https://api.gg.deals/v1/bundles/by-steam-bundle-id/',
};
const ACTIVE_BUNDLES_ENDPOINT = 'https://api.gg.deals/v1/bundles/active/';
const STEAM_SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const FX_API_BASE = 'https://api.frankfurter.app';

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 15000;
const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// In-memory caches
let priceCache = {};
let detectedGamesPerTab = {};
let activeBundlesCache = { data: null, timestamp: 0 };
let fxRateCache = {};
const extensionAction = chrome.action || chrome.browserAction;

function parseBundleDate(value) {
  if (!value || typeof value !== 'string') return null;
  // Validate date format (YYYY-MM-DD or similar) to prevent injection
  if (!/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
  const timestamp = new Date(value.trim() + ' UTC').getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isBundleActive(bundle, now = Date.now()) {
  const startsAt = parseBundleDate(bundle?.dateFrom);
  const endsAt = parseBundleDate(bundle?.dateTo);
  if (startsAt !== null && startsAt > now) return false;
  // Bundle is considered inactive when end time is reached (<=) to exclude bundles ending exactly now
  if (endsAt !== null && endsAt <= now) return false;
  return true;
}

function encodeSteamProductId(type, id) {
  const cleanType = ['app', 'sub', 'bundle'].includes(type) ? type : 'app';
  const cleanId = String(id || '').trim();
  if (!/^\d+$/.test(cleanId)) return null;
  return cleanType === 'app' ? cleanId : `${cleanType}:${cleanId}`;
}

function parseSteamProductId(value, fallbackType = 'app') {
  if (value && typeof value === 'object') {
    const type = value.type || value.idType || fallbackType;
    return parseSteamProductId(`${type}:${value.id}`, fallbackType);
  }
  const raw = String(value || '').trim();
  const typed = raw.match(/^(app|sub|bundle):(\d+)$/i);
  if (typed) {
    const type = typed[1].toLowerCase();
    const id = typed[2];
    return { type, id, key: encodeSteamProductId(type, id) };
  }
  if (/^\d+$/.test(raw)) {
    const type = ['app', 'sub', 'bundle'].includes(fallbackType) ? fallbackType : 'app';
    return { type, id: raw, key: encodeSteamProductId(type, raw) };
  }
  return null;
}

function normalizeSteamProductIds(ids, fallbackType = 'app') {
  const seen = new Set();
  const out = [];
  for (const value of ids || []) {
    const parsed = parseSteamProductId(value, fallbackType);
    if (!parsed || seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    out.push(parsed);
  }
  return out;
}

// ── Startup ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'searchPrice',
    title: chrome.i18n.getMessage('contextMenuLookup') || 'Look up game price on GG.deals',
    contexts: ['selection'],
  });
});

chrome.storage.local.get(['priceCache'], (result) => {
  if (result.priceCache) {
    const now = Date.now();
    for (const [key, entry] of Object.entries(result.priceCache)) {
      if (now - entry.timestamp < CACHE_TTL_MS) {
        priceCache[key] = entry;
      }
    }
  }
});

// ── Fetch with timeout + retry + rate limit tracking ─────────────────────────

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      // Track rate limit headers
      trackRateLimit(resp);

      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('Retry-After') || '5', 10);
        const waitMs = Math.min(retryAfter * 1000, 30000);
        await delay(waitMs);
        continue;
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(chrome.i18n.getMessage('errorAuth', [String(resp.status)]) || `API authentication error (${resp.status}). Check your API key.`);
      }
      if (resp.status === 404) {
        throw new Error(chrome.i18n.getMessage('errorNotFoundCode') || 'Resource not found (404).');
      }
      if (resp.status >= 500) {
        lastError = new Error(chrome.i18n.getMessage('errorServer', [String(resp.status)]) || `Server error (${resp.status})`);
        await delay(getBackoffMs(attempt));
        continue;
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const json = await resp.json();
      return json;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        lastError = new Error(chrome.i18n.getMessage('errorRequestTimedOut') || 'Request timed out');
      } else if (e.message.includes('authentication') || e.message.includes('not found')) {
        throw e;
      } else {
        lastError = e;
      }
      if (attempt < retries - 1) {
        await delay(getBackoffMs(attempt));
      }
    }
  }

  throw lastError || new Error(chrome.i18n.getMessage('errorRequestFailed') || 'Request failed after retries');
}

function trackRateLimit(resp) {
  try {
    const remaining = resp.headers.get('x-ratelimit-remaining');
    const reset = resp.headers.get('x-ratelimit-reset');
    if (remaining !== null) {
      const info = {
        remaining: parseInt(remaining, 10),
        reset: reset ? parseInt(reset, 10) : null,
        timestamp: Date.now(),
      };
      chrome.storage.local.set({ rateLimitInfo: info });
    }
  } catch { /* ignore */ }
}

function getRateLimitInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['rateLimitInfo'], (result) => {
      resolve(result.rateLimitInfo || null);
    });
  });
}

function getBackoffMs(attempt) {
  return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function getFxRate(fromCurrency, toCurrency) {
  const from = String(fromCurrency || '').toUpperCase();
  const to = String(toCurrency || '').toUpperCase();
  if (!from || !to) throw new Error('Missing currency');
  if (from === to) return 1;

  const key = `${from}->${to}`;
  const cached = fxRateCache[key];
  if (cached && (Date.now() - cached.timestamp) < FX_CACHE_TTL_MS) return cached.rate;

  const url = `${FX_API_BASE}/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FX API ${resp.status}`);
  const json = await resp.json();
  const rate = json?.rates?.[to];
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) throw new Error('Invalid FX rate');

  fxRateCache[key] = { rate, timestamp: Date.now() };
  return rate;
}

async function convertCurrencyAmount(amount, fromCurrency, toCurrency) {
  const numeric = Number(amount);
  if (!isFinite(numeric)) throw new Error('Invalid amount');
  const rate = await getFxRate(fromCurrency, toCurrency);
  return roundMoney(numeric * rate);
}

// ── Response validation ──────────────────────────────────────────────────────

function validatePriceResponse(json) {
  if (!json || typeof json !== 'object') return false;
  if (!json.hasOwnProperty('success')) return false;
  if (json.success && !json.data) return false;
  return true;
}

// ── Message handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'gamesDetected') {
    if (message.fromPopup) {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        try {
          const tabId = tabs?.[0]?.id;
          if (tabId) await handleDetectedGames(message.data, tabId);
        } catch (e) {
          console.warn('gamesDetected(fromPopup) failed:', e);
        } finally {
          sendResponse({ ok: true });
        }
      });
      return true;
    }
    handleDetectedGames(message.data, sender.tab?.id);
  }

  if (message.action === 'getDetectedGames') {
    handleGetDetected(message.tabId, sendResponse);
    return true;
  }

  if (message.action === 'lookupByIds') {
    handleLookupByIds(message.ids, message.region, sendResponse);
    return true;
  }

  if (message.action === 'lookupByTitles') {
    handleLookupByTitles(message.titles, message.region, sendResponse);
    return true;
  }

  if (message.action === 'getBundles') {
    handleGetBundles(message.ids, message.region, sendResponse);
    return true;
  }

  if (message.action === 'getActiveBundles') {
    handleGetActiveBundles(message.region, sendResponse);
    return true;
  }

  if (message.action === 'searchSteam') {
    handleSearchSteam(message.query, message.region, sendResponse);
    return true;
  }

  if (message.action === 'overlaySiteStatus') {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      setOverlayExcludedIcon(tabId, message.excluded === true).catch(() => {});
    }
    return false;
  }

  if (message.action === 'openOverlaySettings') {
    openOverlaySettings().catch(() => {});
    return false;
  }

  if (message.action === 'importGgDealsWishlist') {
    startGgDealsImportJob(message.url).then(sendResponse).catch((e) => {
      sendResponse({ success: false, error: e.message || 'Import failed' });
    });
    return true;
  }

  if (message.action === 'getGgDealsImportJob') {
    chrome.storage.local.get(['ggDealsImportJob'], (result) => {
      sendResponse({ success: true, job: result.ggDealsImportJob || null });
    });
    return true;
  }

  if (message.action === 'clearGgDealsImportJob') {
    chrome.storage.local.remove(['ggDealsImportJob'], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// ── Overlay site badge / gray icon ───────────────────────────────────────────

const DEFAULT_ICONS = {
  16: 'images/icon-16.png',
  48: 'images/icon-48.png',
  128: 'images/icon-128.png',
};
const grayIconCache = {};
const excludedTabs = new Set();

async function getGrayIconImageData(size) {
  if (grayIconCache[size]) return grayIconCache[size];
  try {
    const url = chrome.runtime.getURL(DEFAULT_ICONS[size] || DEFAULT_ICONS[48]);
    const resp = await fetch(url);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
      data[i + 3] = Math.round(data[i + 3] * 0.75);
    }
    grayIconCache[size] = imageData;
    return imageData;
  } catch {
    return null;
  }
}

async function setOverlayExcludedIcon(tabId, excluded) {
  if (excluded) excludedTabs.add(tabId);
  else excludedTabs.delete(tabId);

  try {
    if (excluded) {
      const icons = {};
      for (const size of [16, 48]) {
        const imageData = await getGrayIconImageData(size);
        if (imageData) icons[size] = imageData;
      }
      if (Object.keys(icons).length > 0) {
        await extensionAction?.setIcon({ tabId, imageData: icons });
      } else {
        await extensionAction?.setBadgeText({ tabId, text: '✕' });
        await extensionAction?.setBadgeBackgroundColor({ tabId, color: '#6b7280' });
      }
      await extensionAction?.setTitle({
        tabId,
        title: 'GG Buddy — price bar hidden on this site',
      });
    } else {
      await extensionAction?.setIcon({ tabId, path: DEFAULT_ICONS });
      await extensionAction?.setTitle({ tabId, title: 'GG Buddy' });
      // Keep numeric game-count badge if present; clear hide marker only
      const badge = await extensionAction?.getBadgeText?.({ tabId });
      if (badge === '✕') {
        await extensionAction?.setBadgeText({ tabId, text: '' });
      }
    }
  } catch {
    // Tab may be closed or API unavailable (Firefox quirks)
  }
}

async function openOverlaySettings() {
  try {
    await chrome.storage.local.set({ popupFocusSection: 'overlayBar' });
  } catch { /* ignore */ }

  try {
    if (extensionAction?.openPopup) {
      await extensionAction.openPopup();
      return;
    }
  } catch { /* fall through */ }

  const url = chrome.runtime.getURL('popup.html#settings');
  chrome.tabs.create({ url });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  excludedTabs.delete(tabId);
  delete detectedGamesPerTab[tabId];
});

// ── Context menu ─────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'searchPrice') {
    const text = (info.selectionText || '').trim();
    if (!text) return;

    // Open a new tab querying GG.deals search directly with the highlighted text
    const searchUrl = `https://gg.deals/games/?title=${encodeURIComponent(text)}`;
    chrome.tabs.create({ url: searchUrl });
  }
});

// ── Detected games per tab ───────────────────────────────────────────────────

async function handleDetectedGames(data, tabId) {
  if (!tabId || !data) return;

  let productIds = [];
  if (data.type === 'steam_ids' && Array.isArray(data.ids)) {
    productIds = normalizeSteamProductIds(data.ids, 'app').map((item) => item.key);
  } else if (data.type === 'steam_sub_ids' && Array.isArray(data.ids)) {
    productIds = normalizeSteamProductIds(data.ids, 'sub').map((item) => item.key);
  } else if (data.type === 'steam_bundle_ids' && Array.isArray(data.ids)) {
    productIds = normalizeSteamProductIds(data.ids, 'bundle').map((item) => item.key);
  } else if (data.type === 'titles' && Array.isArray(data.titles)) {
    try {
      const mapping = await resolveTitlesToSteamIds(data.titles);
      productIds = normalizeSteamProductIds(Object.values(mapping).filter(Boolean), 'app').map((item) => item.key);
    } catch (e) {
      console.warn('Title resolution failed:', e);
      return;
    }
  }

  if (productIds.length === 0) return;

  detectedGamesPerTab[tabId] = {
    appIds: productIds,
    store: data.store || 'unknown',
    pageType: data.pageType || null,
    timestamp: Date.now(),
  };

  const count = productIds.length;
  extensionAction?.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
  extensionAction?.setBadgeBackgroundColor({ color: '#048044', tabId });
}

function handleGetDetected(tabId, sendResponse) {
  const entry = detectedGamesPerTab[tabId];
  if (entry && Date.now() - entry.timestamp < 10 * 60 * 1000) {
    sendResponse({ appIds: entry.appIds, store: entry.store, pageType: entry.pageType || null });
  } else {
    sendResponse({ appIds: [], store: null, pageType: null });
  }
}

// ── Price lookups ────────────────────────────────────────────────────────────

async function handleLookupByIds(ids, region, sendResponse) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      sendResponse({ success: false, error: 'No IDs provided' });
      return;
    }
    const productIds = normalizeSteamProductIds(ids, 'app');
    if (productIds.length === 0) {
      sendResponse({ success: false, error: 'No valid IDs provided' });
      return;
    }
    const results = await fetchPricesBatch(productIds, region);
    const rateLimit = await getRateLimitInfo();
    sendResponse({ success: true, data: results, rateLimit });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleLookupByTitles(titles, region, sendResponse) {
  try {
    if (!Array.isArray(titles) || titles.length === 0) {
      sendResponse({ success: false, error: 'No titles provided' });
      return;
    }
    const cleanTitles = titles.map((t) => String(t).trim()).filter((t) => t.length > 0 && t.length < 300);
    if (cleanTitles.length === 0) {
      sendResponse({ success: false, error: 'No valid titles provided' });
      return;
    }
    const mapping = await resolveTitlesToSteamIds(cleanTitles);
    const resolvedIds = Object.values(mapping).filter(Boolean);
    if (resolvedIds.length === 0) {
      sendResponse({ success: true, data: {}, mapping });
      return;
    }
    const results = await fetchPricesBatch(resolvedIds, region);
    const rateLimit = await getRateLimitInfo();
    sendResponse({ success: true, data: results, mapping, rateLimit });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// Multi-result Steam search: returns ALL matching games with prices
async function handleSearchSteam(query, region, sendResponse) {
  try {
    if (!query || query.trim().length === 0) {
      sendResponse({ success: false, error: 'No query provided' });
      return;
    }
    const term = query.trim();
    const url = `${STEAM_SEARCH_URL}?term=${encodeURIComponent(term)}&l=english&cc=us`;
    const json = await fetchWithRetry(url, 2);

    if (!json.items || json.items.length === 0) {
      sendResponse({ success: true, data: {} });
      return;
    }

    // Get all result IDs (up to 10)
    const ids = json.items.map((item) => String(item.id));
    const results = await fetchPricesBatch(ids, region || 'us');
    const rateLimit = await getRateLimitInfo();
    sendResponse({ success: true, data: results, rateLimit });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleGetBundles(ids, region, sendResponse) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      sendResponse({ success: false, error: 'No IDs provided' });
      return;
    }
    const apiKey = await getApiKey();
    const productIds = normalizeSteamProductIds(ids, 'app');
    if (productIds.length === 0) {
      sendResponse({ success: false, error: 'No valid IDs provided' });
      return;
    }
    const data = {};
    for (const type of ['app', 'sub', 'bundle']) {
      const group = productIds.filter((item) => item.type === type);
      if (group.length === 0) continue;
      const endpoint = BUNDLES_ENDPOINTS[type];
      const url = `${endpoint}?ids=${group.map((item) => item.id).join(',')}&key=${apiKey}&region=${region || 'us'}`;
      const json = await fetchWithRetry(url);
      if (json.success && json.data) {
        for (const item of group) {
          if (json.data[item.id]) data[item.key] = json.data[item.id];
        }
      }
    }
    const rateLimit = await getRateLimitInfo();
    sendResponse({ success: true, data, rateLimit });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ── Active Bundles ───────────────────────────────────────────────────────────

async function handleGetActiveBundles(region, sendResponse) {
  try {
    // Cache active bundles for 15 minutes
    if (activeBundlesCache.data && Date.now() - activeBundlesCache.timestamp < 15 * 60 * 1000) {
      const rateLimit = await getRateLimitInfo();
      sendResponse({ success: true, data: activeBundlesCache.data, rateLimit });
      return;
    }

    const apiKey = await getApiKey();
    const url = `${ACTIVE_BUNDLES_ENDPOINT}?key=${apiKey}&region=${region || 'us'}`;
    const json = await fetchWithRetry(url);
    const rateLimit = await getRateLimitInfo();

    if (json.success && json.data) {
      // API returns { data: { totalCount, bundles: [...] } }
      const bundles = (json.data.bundles || []).filter((bundle) => isBundleActive(bundle));
      activeBundlesCache = { data: bundles, timestamp: Date.now() };
      sendResponse({ success: true, data: bundles, rateLimit });
    } else {
      sendResponse({ success: false, error: json.error || 'Unknown error', rateLimit });
    }
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ── Price batch fetching ─────────────────────────────────────────────────────

async function fetchPricesBatch(ids, region) {
  const apiKey = await getApiKey();
  region = region || 'us';
  const cacheKeyPrefix = `${region}:`;
  const results = {};
  const uncachedIds = [];
  const productIds = normalizeSteamProductIds(ids, 'app');

  for (const item of productIds) {
    const cached = priceCache[cacheKeyPrefix + item.key];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      results[item.key] = cached.data;
    } else {
      uncachedIds.push(item);
    }
  }

  if (uncachedIds.length > 0) {
    for (const type of ['app', 'sub', 'bundle']) {
      const idsForType = uncachedIds.filter((item) => item.type === type);
      const endpoint = PRICES_ENDPOINTS[type];
      for (let i = 0; i < idsForType.length; i += 100) {
        const batch = idsForType.slice(i, i + 100);
        const url = `${endpoint}?ids=${batch.map((item) => item.id).join(',')}&key=${apiKey}&region=${region}`;

        const json = await fetchWithRetry(url);

        if (!validatePriceResponse(json)) {
          console.warn('Invalid price response shape:', json);
          continue;
        }

        if (json.success && json.data) {
          for (const item of batch) {
            const gameData = json.data[item.id];
            if (!gameData) continue;
            results[item.key] = gameData;
            priceCache[cacheKeyPrefix + item.key] = { data: gameData, timestamp: Date.now() };
          }
        }
      }
    }

    persistCache();
  }

  return results;
}

function persistCache() {
  const entries = Object.entries(priceCache)
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
    .slice(0, 500);
  chrome.storage.local.set({ priceCache: Object.fromEntries(entries) });
}

// ── Title → Steam App ID resolution ─────────────────────────────────────────

let titleCache = {};

async function resolveTitlesToSteamIds(titles) {
  const mapping = {};
  const uncached = [];

  for (const title of titles) {
    const key = title.toLowerCase();
    if (titleCache[key] !== undefined) {
      mapping[title] = titleCache[key];
    } else {
      uncached.push(title);
    }
  }

  if (uncached.length === 0) return mapping;

  const BATCH_SIZE = 5;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (title) => {
        try {
          const url = `${STEAM_SEARCH_URL}?term=${encodeURIComponent(title)}&l=english&cc=us`;
          const json = await fetchWithRetry(url, 2);
          if (json.total > 0 && json.items && json.items.length > 0) {
            return { title, id: String(json.items[0].id) };
          }
          return { title, id: null };
        } catch {
          return { title, id: null };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { title, id } = result.value;
        mapping[title] = id;
        titleCache[title.toLowerCase()] = id;
      }
    }
  }

  return mapping;
}

// ── GG.deals shared wishlist import ──────────────────────────────────────────

function parseGgDealsShareUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://gg.deals${raw.startsWith('/') ? '' : '/'}${raw}`);
    if (!/(^|\.)gg\.deals$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/\/wishlist\/share\/([A-Za-z0-9_-]+)\/?/i);
    if (!match) return null;
    return {
      hash: match[1],
      pageUrl: `https://gg.deals/wishlist/share/${match[1]}/`,
    };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseSharedWishlistGames(html, hash) {
  const games = [];
  const seen = new Set();
  const region =
    (String(html || '').match(/data-info-url="\/([a-z]{2})\/wishlist\/gameInfoShared\//i) || [])[1] ||
    (String(html || '').match(/href="\/([a-z]{2})\/(?:deals|games|wishlist)/i) || [])[1] ||
    'us';
  const chunks = String(html || '').split(/data-container-game-id="/i).slice(1);
  for (const chunk of chunks) {
    const id = (chunk.match(/^(\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Only read attrs from this element's opening tag (info-url often appears before game-id)
    const tagEnd = chunk.indexOf('>');
    const openTag = chunk.slice(0, tagEnd > 0 ? tagEnd : 800);
    const title = decodeHtmlEntities((openTag.match(/data-game-title="([^"]*)"/i) || [])[1] || '').trim();
    const slug = decodeHtmlEntities((openTag.match(/data-game-name="([^"]*)"/i) || [])[1] || '').trim();
    const infoUrl = hash
      ? `https://gg.deals/${region}/wishlist/gameInfoShared/${id}/?hash=${encodeURIComponent(hash)}&showKeyshops=1`
      : null;
    if (!title && !slug) continue;
    games.push({ ggId: id, title: title || slug, slug, infoUrl });
  }
  return games;
}

function parseShareMaxPage(html) {
  let max = 1;
  const re = /[?&]page=(\d+)/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function parseShareOwner(html) {
  const ownerMatch = String(html || '').match(/<title>([^<]*?)(?:'s)?\s*wishlist/i);
  return ownerMatch ? decodeHtmlEntities(ownerMatch[1]).trim() : null;
}

function isCloudflareChallengeHtml(html) {
  const text = String(html || '');
  if (text.length < 12000) return true;
  return /<title>\s*Just a moment/i.test(text) || /cf-browser-verification|challenge-platform/i.test(text);
}

function sharePageUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  if (page <= 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(page));
  return url.toString();
}

function mergeSharedGames(target, incoming, seen) {
  let added = 0;
  for (const game of incoming || []) {
    const id = String(game.ggId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    target.push(game);
    added++;
  }
  return added;
}

function normalizeScrapedShareGames(games, hash) {
  return (games || []).map((g) => ({
    ggId: String(g.ggId || ''),
    title: g.title,
    slug: g.slug || '',
    infoUrl: g.infoUrl || (hash && g.ggId
      ? `https://gg.deals/us/wishlist/gameInfoShared/${g.ggId}/?hash=${encodeURIComponent(hash)}&showKeyshops=1`
      : null),
  }));
}

async function setGgDealsImportProgress(partial) {
  try {
    const stored = await chrome.storage.local.get(['ggDealsImportJob']);
    const prev = stored.ggDealsImportJob && typeof stored.ggDealsImportJob === 'object'
      ? stored.ggDealsImportJob
      : {};
    const job = {
      ...prev,
      ...partial,
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ ggDealsImportJob: job });
  } catch {
    // ignore
  }
}

function startImportKeepAlive() {
  stopImportKeepAlive();
  try {
    chrome.alarms.create('ggDealsImportKeepAlive', { periodInMinutes: 1 });
  } catch {
    // alarms may be unavailable
  }
  importKeepAliveTimer = setInterval(() => {
    try { chrome.runtime.getPlatformInfo(() => {}); } catch { /* ignore */ }
  }, 20000);
}

function stopImportKeepAlive() {
  if (importKeepAliveTimer) {
    clearInterval(importKeepAliveTimer);
    importKeepAliveTimer = null;
  }
  try { chrome.alarms.clear('ggDealsImportKeepAlive'); } catch { /* ignore */ }
}

let importJobRunning = false;
let importKeepAliveTimer = null;

async function applyImportedGamesToWishlist(games) {
  const stored = await chrome.storage.local.get(['wishlist', 'userPrefs']);
  const wishlist = Array.isArray(stored.wishlist) ? [...stored.wishlist] : [];
  const ids = new Set(wishlist.map((w) => String(w.id)));
  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const game of games || []) {
    if (!game?.id || !game?.title) continue;
    const id = String(game.id);
    if (ids.has(id)) {
      skipped++;
      continue;
    }
    ids.add(id);
    wishlist.push({
      id,
      title: String(game.title),
      addedPrice: null,
      addedDate: now,
      alertEnabled: false,
      alertThreshold: 0,
      alertThresholdCustom: false,
      source: 'ggdeals-share',
      ggId: game.ggId || null,
    });
    added++;
  }

  await chrome.storage.local.set({ wishlist });
  try {
    const prefs = stored.userPrefs || {};
    if (prefs.syncEnabled) {
      const wlStr = JSON.stringify(wishlist);
      if (wlStr.length < 7000) {
        await chrome.storage.sync.set({ wishlist });
      }
    }
  } catch {
    // sync quota / unavailable
  }

  return { added, skipped, wishlist };
}

function notifyGgDealsImportDone(job) {
  try {
    const added = job.added || 0;
    const missed = Array.isArray(job.unresolved) ? job.unresolved.length : 0;
    chrome.notifications.create(`ggdeals-import-${job.id || Date.now()}`, {
      type: 'basic',
      iconUrl: 'images/icon-128.png',
      title: 'GG Buddy',
      message: missed > 0
        ? `Imported ${added} games (${missed} unresolved). Reopen the popup to review them.`
        : `Imported ${added} games from GG.deals wishlist.`,
    });
  } catch {
    // notifications may be blocked
  }
}

async function startGgDealsImportJob(url) {
  const parsed = parseGgDealsShareUrl(url);
  if (!parsed) {
    return {
      success: false,
      error: 'Invalid GG.deals wishlist share link. Expected https://gg.deals/wishlist/share/<hash>/',
    };
  }

  if (importJobRunning) {
    return { success: false, error: 'An import is already running in the background.' };
  }

  const existing = (await chrome.storage.local.get(['ggDealsImportJob'])).ggDealsImportJob;
  // Stale "running" jobs (popup closed / worker restarted) are overwriteable
  if (existing?.status === 'running' && (Date.now() - (existing.updatedAt || 0)) < 15000) {
    return { success: false, error: 'An import is already running in the background.', job: existing };
  }

  const job = {
    id: `imp-${Date.now()}`,
    status: 'running',
    url: parsed.pageUrl,
    shareUrl: parsed.pageUrl,
    hash: parsed.hash,
    owner: null,
    phase: 'start',
    message: 'Fetching shared wishlist…',
    page: 0,
    maxPage: 0,
    listed: 0,
    added: 0,
    skipped: 0,
    unresolved: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    error: null,
  };

  await chrome.storage.local.set({ ggDealsImportJob: job });
  importJobRunning = true;
  startImportKeepAlive();

  // Detached: do not await — popup can close safely
  runGgDealsImportJob(job).catch(async (e) => {
    await setGgDealsImportProgress({
      status: 'error',
      phase: 'error',
      message: e.message || 'Import failed',
      error: e.message || 'Import failed',
      finishedAt: Date.now(),
    });
  }).finally(() => {
    importJobRunning = false;
    stopImportKeepAlive();
  });

  return { success: true, started: true, job };
}

async function runGgDealsImportJob(job) {
  const parsed = { pageUrl: job.shareUrl || job.url, hash: job.hash };

  let owner = null;
  let listed = [];
  let maxPage = 1;

  try {
    const fetched = await fetchAllSharedWishlistGames(parsed.pageUrl, parsed.hash);
    owner = fetched.owner;
    listed = fetched.games;
    maxPage = fetched.maxPage || 1;
  } catch {
    listed = [];
  }

  if (listed.length === 0) {
    const scraped = await scrapeAllSharePagesViaTab(parsed.pageUrl, parsed.hash);
    if (scraped?.games?.length) {
      listed = scraped.games;
      owner = scraped.owner || owner;
      maxPage = scraped.maxPage || maxPage;
    }
  }

  if (listed.length === 0) {
    await setGgDealsImportProgress({
      status: 'error',
      phase: 'error',
      owner,
      message: 'No games found on that shared wishlist. Make sure the link is public and still valid.',
      error: 'No games found on that shared wishlist. Make sure the link is public and still valid.',
      finishedAt: Date.now(),
    });
    return;
  }

  await setGgDealsImportProgress({
    owner,
    listed: listed.length,
    maxPage,
    phase: 'resolve',
    message: `Found ${listed.length} games — resolving Steam IDs…`,
  });

  const resolved = await resolveSharedWishlistToSteam(listed, parsed.pageUrl);
  const games = [];
  const unresolved = [];
  const seenSteam = new Set();

  for (const item of resolved) {
    if (!item.steamKey) {
      unresolved.push({
        title: item.title,
        ggId: item.ggId || null,
        slug: item.slug || null,
      });
      continue;
    }
    if (seenSteam.has(item.steamKey)) continue;
    seenSteam.add(item.steamKey);
    games.push({
      id: item.steamKey,
      title: item.title,
      ggId: item.ggId,
      slug: item.slug || null,
      resolvedVia: item.resolvedVia,
    });
  }

  await setGgDealsImportProgress({
    phase: 'saving',
    message: `Saving ${games.length} games to your wishlist…`,
    listed: listed.length,
    unresolved,
  });

  const { added, skipped } = await applyImportedGamesToWishlist(games);

  const doneJob = {
    status: 'done',
    phase: 'done',
    owner,
    listed: listed.length,
    pages: maxPage,
    added,
    skipped,
    unresolved,
    message: `Imported ${added} from ${owner || 'GG.deals'} (${skipped} duplicates, ${unresolved.length} unresolved)`,
    finishedAt: Date.now(),
    error: null,
  };
  await setGgDealsImportProgress(doneJob);
  notifyGgDealsImportDone({ ...job, ...doneJob });
}

// Mark interrupted jobs after service worker restart (only if stale)
chrome.storage.local.get(['ggDealsImportJob'], (result) => {
  const job = result.ggDealsImportJob;
  const age = Date.now() - (job?.updatedAt || job?.startedAt || 0);
  if (job?.status === 'running' && !importJobRunning && age > 90000) {
    chrome.storage.local.set({
      ggDealsImportJob: {
        ...job,
        status: 'error',
        phase: 'error',
        message: 'Import was interrupted. Open the Wishlist tab and click Import to try again.',
        error: 'Import was interrupted. Click Import to try again.',
        finishedAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  }
});

function extractSteamProductFromHtml(html) {
  const match = String(html || '').match(/store\.steampowered\.com\/(app|sub|bundle)\/(\d+)/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const id = match[2];
  return {
    type,
    id,
    key: type === 'app' ? id : `${type}:${id}`,
  };
}

async function fetchText(url, options = {}) {
  const resp = await fetch(url, {
    credentials: 'omit',
    ...options,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run());
  await Promise.all(runners);
  return results;
}

async function resolveSharedGameViaInfo(game, referer) {
  const candidates = [];
  if (game.infoUrl) candidates.push(game.infoUrl);
  if (game.slug) candidates.push(`https://gg.deals/game/${encodeURIComponent(game.slug)}/`);

  for (const candidate of candidates) {
    try {
      const html = await fetchText(candidate, {
        headers: {
          Referer: referer || 'https://gg.deals/',
          ...(candidate.includes('gameInfoShared') ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
        },
      });
      if (isCloudflareChallengeHtml(html)) continue;
      const product = extractSteamProductFromHtml(html);
      if (product) {
        return {
          ...game,
          steamKey: product.key,
          steamType: product.type,
          resolvedVia: candidate.includes('gameInfoShared') ? 'info' : 'page',
        };
      }
    } catch {
      // try next
    }
  }

  return { ...game, steamKey: null, steamType: null, resolvedVia: null };
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') finish(true);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(false);
        return;
      }
      if (tab?.status === 'complete') finish(true);
    });
  });
}

function scrapeShareTabOnce(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'scrapeGgDealsShare' }, (resp) => {
      if (chrome.runtime.lastError || !resp?.success) {
        resolve(null);
        return;
      }
      resolve(resp);
    });
  });
}

async function scrapeShareTabWithRetry(tabId, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 900 : 700));
    const resp = await scrapeShareTabOnce(tabId);
    if (resp?.games?.length) return resp;
  }
  return null;
}

async function scrapeAllSharePagesViaTab(pageUrl, hash, pagesToScrape = null) {
  return new Promise((resolve) => {
    const initialPage = Array.isArray(pagesToScrape) && pagesToScrape.length
      ? Math.min(...pagesToScrape)
      : 1;
    chrome.tabs.create({ url: sharePageUrl(pageUrl, initialPage), active: false }, async (tab) => {
      if (!tab?.id) {
        resolve(null);
        return;
      }
      const tabId = tab.id;
      const listed = [];
      const seen = new Set();
      let owner = null;
      let maxPage = 1;

      try {
        await waitForTabComplete(tabId);
        const first = await scrapeShareTabWithRetry(tabId);
        if (!first?.games?.length && !pagesToScrape) {
          resolve(null);
          return;
        }
        owner = first?.owner || null;
        maxPage = Math.max(1, parseInt(first?.maxPage, 10) || 1);
        if (first?.games?.length) {
          mergeSharedGames(listed, normalizeScrapedShareGames(first.games, hash), seen);
        }

        let pages;
        if (Array.isArray(pagesToScrape) && pagesToScrape.length) {
          pages = [...new Set(pagesToScrape.map((p) => parseInt(p, 10)).filter((p) => p >= 1))]
            .filter((p) => p !== initialPage)
            .sort((a, b) => a - b);
        } else {
          pages = [];
          for (let page = 2; page <= maxPage; page++) pages.push(page);
        }

        for (const page of pages) {
          await setGgDealsImportProgress({
            phase: 'pages',
            message: `Loading wishlist page ${page}${maxPage > 1 ? ` of ${maxPage}` : ''}…`,
            page,
            maxPage,
            listed: listed.length,
          });
          await new Promise((r) => {
            chrome.tabs.update(tabId, { url: sharePageUrl(pageUrl, page) }, () => r());
          });
          await waitForTabComplete(tabId);
          const scraped = await scrapeShareTabWithRetry(tabId);
          if (scraped?.games?.length) {
            mergeSharedGames(listed, normalizeScrapedShareGames(scraped.games, hash), seen);
            maxPage = Math.max(maxPage, parseInt(scraped.maxPage, 10) || 1);
          }
        }

        resolve(listed.length ? { owner, games: listed, maxPage } : null);
      } catch {
        resolve(listed.length ? { owner, games: listed, maxPage } : null);
      } finally {
        try { chrome.tabs.remove(tabId); } catch { /* ignore */ }
      }
    });
  });
}

async function fetchAllSharedWishlistGames(pageUrl, hash) {
  const listed = [];
  const seen = new Set();
  let owner = null;
  let maxPage = 1;
  let usedTabFallback = false;

  const firstHtml = await fetchText(pageUrl, { headers: { Referer: pageUrl } });
  if (isCloudflareChallengeHtml(firstHtml) || parseSharedWishlistGames(firstHtml, hash).length === 0) {
    const scraped = await scrapeAllSharePagesViaTab(pageUrl, hash);
    if (!scraped?.games?.length) {
      return { owner: null, games: [], maxPage: 1, usedTabFallback: true };
    }
    return {
      owner: scraped.owner,
      games: scraped.games,
      maxPage: scraped.maxPage || 1,
      usedTabFallback: true,
    };
  }

  owner = parseShareOwner(firstHtml);
  maxPage = parseShareMaxPage(firstHtml);
  mergeSharedGames(listed, parseSharedWishlistGames(firstHtml, hash), seen);

  await setGgDealsImportProgress({
    phase: 'pages',
    message: maxPage > 1
      ? `Loading wishlist page 1 of ${maxPage}…`
      : `Found ${listed.length} games…`,
    page: 1,
    maxPage,
    listed: listed.length,
  });

  if (maxPage > 1) {
    const pageNums = [];
    for (let p = 2; p <= maxPage; p++) pageNums.push(p);
    const failedPages = [];

    await mapPool(pageNums, 3, async (page) => {
      try {
        const html = await fetchText(sharePageUrl(pageUrl, page), {
          headers: { Referer: pageUrl },
        });
        if (isCloudflareChallengeHtml(html)) {
          failedPages.push(page);
          return;
        }
        const games = parseSharedWishlistGames(html, hash);
        if (!games.length) {
          failedPages.push(page);
          return;
        }
        mergeSharedGames(listed, games, seen);
        await setGgDealsImportProgress({
          phase: 'pages',
          message: `Loading wishlist pages… ${listed.length} games so far`,
          page,
          maxPage,
          listed: listed.length,
        });
      } catch {
        failedPages.push(page);
      }
    });

    // If Cloudflare blocked later pages, finish those via a real tab
    if (failedPages.length > 0) {
      usedTabFallback = true;
      const scraped = await scrapeAllSharePagesViaTab(pageUrl, hash, failedPages);
      if (scraped?.games?.length) {
        owner = owner || scraped.owner;
        mergeSharedGames(listed, scraped.games, seen);
        maxPage = Math.max(maxPage, scraped.maxPage || 1);
      }
    }
  }

  return { owner, games: listed, maxPage, usedTabFallback };
}

async function resolveSharedWishlistToSteam(listed, referer) {
  await setGgDealsImportProgress({
    phase: 'resolve',
    message: `Found ${listed.length} games — resolving Steam IDs…`,
    listed: listed.length,
  });

  const titles = listed.map((g) => g.title);
  const mapping = await resolveTitlesToSteamIds(titles);

  const resolved = listed.map((game) => {
    const steamId = mapping[game.title];
    if (steamId) {
      return {
        ...game,
        steamKey: String(steamId),
        steamType: 'app',
        resolvedVia: 'steam-search',
      };
    }
    return { ...game, steamKey: null, steamType: null, resolvedVia: null };
  });

  const unresolved = resolved.filter((g) => !g.steamKey);
  if (unresolved.length === 0) return resolved;

  await setGgDealsImportProgress({
    phase: 'resolve',
    message: `Resolving ${unresolved.length} remaining games via GG.deals…`,
    listed: listed.length,
    unresolved: unresolved.length,
  });

  const viaInfo = await mapPool(unresolved, 4, (game) => resolveSharedGameViaInfo(game, referer));
  const byGgId = new Map(viaInfo.map((g) => [g.ggId, g]));
  return resolved.map((g) => (g.steamKey ? g : (byGgId.get(g.ggId) || g)));
}

// ── API key helper ───────────────────────────────────────────────────────────

function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey'], (result) => {
      resolve(result.apiKey || DEFAULT_API_KEY);
    });
  });
}

// ── Wishlist background price checking ───────────────────────────────────────

chrome.alarms.create('checkWishlistPrices', { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkWishlistPrices') {
    checkWishlistPrices();
  }
  // Keepalive tick for long GG.deals imports (no-op body; alarm wakes the worker)
  if (alarm.name === 'ggDealsImportKeepAlive' && importJobRunning) {
    try { chrome.runtime.getPlatformInfo(() => {}); } catch { /* ignore */ }
  }
});

async function checkWishlistPrices() {
  try {
    const result = await chrome.storage.local.get(['wishlist', 'notificationSettings', 'lastRegion', 'userPrefs']);
    let userPrefs = { ...(result.userPrefs || {}) };
    try {
      const sync = await chrome.storage.sync.get(['userPrefs']);
      if (sync.userPrefs && typeof sync.userPrefs === 'object') {
        userPrefs = { ...userPrefs, ...sync.userPrefs };
      }
    } catch { /* ignore */ }
    const officialOnly = userPrefs.officialOnly === true;

    const wishlist = result.wishlist || [];
    const settings = result.notificationSettings || { enabled: false };
    const region = result.lastRegion || 'us';

    if (!settings.enabled) return;

    const alertItems = wishlist.filter((w) => w.alertEnabled);
    if (alertItems.length === 0) return;

    const ids = alertItems.map((w) => w.id);
    const prices = await fetchPricesBatch(ids, region);
    let wishlistChanged = false;

    for (const item of alertItems) {
      const game = prices[item.id];
      if (!game || !game.prices) continue;

      const retail = game.prices.currentRetail ? parseFloat(game.prices.currentRetail) : null;
      const keyshop = officialOnly
        ? null
        : (game.prices.currentKeyshops ? parseFloat(game.prices.currentKeyshops) : null);
      // Best (lowest) current price respecting Official Stores Only.
      let price = null;
      if (retail !== null && keyshop !== null) price = Math.min(retail, keyshop);
      else if (retail !== null) price = retail;
      else if (keyshop !== null) price = keyshop;

      let threshold = Number(item.alertThreshold);
      const currentCurrency = String(game.prices.currency || '').toUpperCase();
      const thresholdCurrency = String(item.alertThresholdCurrency || item.lastCurrency || currentCurrency).toUpperCase();
      if (
        isFinite(threshold) &&
        thresholdCurrency &&
        currentCurrency &&
        thresholdCurrency !== currentCurrency
      ) {
        try {
          threshold = await convertCurrencyAmount(threshold, thresholdCurrency, currentCurrency);
          item.alertThreshold = threshold;
          item.alertThresholdCurrency = currentCurrency;
          wishlistChanged = true;
        } catch {
          // Keep original threshold if conversion service fails.
        }
      }

      // Trigger when the best price is at or below the threshold (historical low).
      if (price !== null && !isNaN(price) && isFinite(threshold) && price <= threshold) {
        chrome.notifications.create(`price-drop-${item.id}-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'images/icon-128.png',
          title: chrome.i18n.getMessage('notifPriceDrop', [game.title]) || `Price Drop: ${game.title}`,
          message: chrome.i18n.getMessage('notifPriceDropBody', [String(price), game.prices.currency, String(threshold)]) || `Now ${price} ${game.prices.currency} (Alert: ${threshold})`,
        });
      }
    }
    if (wishlistChanged) {
      await chrome.storage.local.set({ wishlist });
      try {
        const syncResult = await chrome.storage.sync.get(['userPrefs']);
        if (syncResult?.userPrefs?.syncEnabled !== false) {
          await chrome.storage.sync.set({ wishlist });
        }
      } catch { /* ignore sync errors */ }
    }
  } catch (e) {
    console.error('Wishlist price check failed:', e);
  }
}

// Clean up tab data when tabs are closed (also handled above with excludedTabs)
