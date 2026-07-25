(function () {
  'use strict';

  
  const DOM_SELECTORS = {
    epicProduct: ['[data-testid="offer-title-info-title"]', 'h1[class*="NavigationVertical"]', 'div[class*="ProductName"]', 'span[data-component="Message"]'],
    epicWishlist: ['[data-testid="wishlist-item"] [data-testid="offer-title-info-title"]', '[data-testid="wishlist-item"] h6', '[data-testid="wishlist-item"] span[data-component="Message"]', '.wishlist-item .product-name', '[class*="WishlistItem"] [class*="Title"]', '[class*="WishlistItem"] h6', '[class*="wishlist"] [class*="GameTitle"]'],
    epicCard: ['a[href*="/p/"] span', 'a[href*="/p/"] h6', '[data-testid="offer-title-info-title"]'],
    gogProduct: ['.productcard-basics__title', '[class*="productTitle"]', 'h1.productcard-basics__title'],
    humbleBundleItem: ['.item-title', '.content-choice-title', '.entity-title', '.tier-item-view .item-title', 'td.game-name h4', '.dd-image-box-caption', '.human_name-view'],
    humbleHeader: ['.product-header-view .human_name-view', '.hero-content .heading-text h1', '.bundle-logo-text'],
    fanaticalBundle: ['.bundle-item-title', '.card-title', '.product-name', '.game-card-title', '.product-title', '.game-title', '.product-details-title', '[data-test-id="product-link"]', 'h3 a', 'h4 a', 'h3']
  };

  const STORE_DETECTORS = {
    // Official stores
    'store.steampowered.com': detectSteamGames,
    'gg.deals': detectGGDealsGames,
    'store.epicgames.com': detectEpicGames,
    'www.gog.com': detectGOGGames,
    'www.humblebundle.com': detectHumbleGames,
    'www.fanatical.com': detectFanaticalGames,
    'www.greenmangaming.com': detectGMGGames,
    // Keyshops
    'www.cdkeys.com': detectCDKeys,
    'www.kinguin.net': detectKinguin,
    'www.eneba.com': detectEneba,
    'www.g2a.com': detectG2A,
    'www.allkeyshop.com': detectAllKeyShop,
    'www.instant-gaming.com': detectInstantGaming,
    'isthereanydeal.com': detectIsThereAnyDeal,
    'www.gamersgate.com': detectGamersGate,
    'www.wingamestore.com': detectWinGameStore,
    'www.dlgamer.com': detectDLGamer,
    'digiphile.co': detectDigiphile,
    // Sites where we show legitimate deals to encourage buying (discourage piracy)
    'fitgirl-repacks.site': detectGamePageSteamThenTitle,
    'igg-games.com': detectGamePageSteamThenTitle,
    'gog-games': detectGamePageSteamThenTitle,
    'gog-games.to': detectGamePageSteamThenTitle,
  };

  // ── Steam ──────────────────────────────────────────────────────────────────

  // Cached wishlist IDs (persists for the lifetime of the content script)
  let cachedSteamWishlistIds = null;
  let wishlistFetchInProgress = false;

  function detectSteamGames() {
    const path = window.location.pathname;

    // Wishlist page: /wishlist/profiles/<id>/ or /wishlist/id/<name>/
    if (path.includes('/wishlist/')) {
      // Return cached results immediately if available
      if (cachedSteamWishlistIds && cachedSteamWishlistIds.length > 0) {
        return { type: 'steam_ids', ids: cachedSteamWishlistIds, store: 'steam', pageType: 'wishlist' };
      }

      // Start collecting from DOM while the full fetch runs in background
      const domIds = collectSteamWishlistIdsFromDOM();

      // Kick off the full API fetch (runs async, sends results via message)
      if (!wishlistFetchInProgress) {
        wishlistFetchInProgress = true;
        fetchAllSteamWishlistIds().then((allIds) => {
          wishlistFetchInProgress = false;
          if (allIds.length > 0) {
            cachedSteamWishlistIds = allIds;
            chrome.runtime.sendMessage({
              action: 'gamesDetected',
              data: { type: 'steam_ids', ids: allIds, store: 'steam', pageType: 'wishlist' },
            });
          }
        });
      }

      // Return whatever we have from the DOM right now (may be partial)
      if (domIds.length > 0) {
        return { type: 'steam_ids', ids: domIds, store: 'steam', pageType: 'wishlist' };
      }

      observeSteamWishlist();
      return null;
    }

    const singleMatch = path.match(/\/app\/(\d+)/);
    if (singleMatch) {
      return { type: 'steam_ids', ids: [singleMatch[1]], store: 'steam' };
    }

    const subMatch = path.match(/\/sub\/(\d+)/);
    if (subMatch) {
      return { type: 'steam_sub_ids', ids: [subMatch[1]], store: 'steam' };
    }

    const bundleMatch = path.match(/\/bundle\/(\d+)/);
    if (bundleMatch) {
      return { type: 'steam_bundle_ids', ids: [bundleMatch[1]], store: 'steam' };
    }

    const appIds = extractSteamAppIdsFromDOM();
    if (appIds.length > 0) {
      return { type: 'steam_ids', ids: appIds, store: 'steam' };
    }

    return null;
  }

  // Fetches ALL wishlist app IDs using multiple strategies, not just what's visible
  async function fetchAllSteamWishlistIds() {
    const ids = new Set();

    // Strategy 1 (PRIMARY): Steam's dynamic store userdata endpoint
    // Returns rgWishlist — an array of ALL wishlisted app IDs in one request
    try {
      const resp = await fetch('/dynamicstore/userdata/', {
        credentials: 'include',
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.rgWishlist && Array.isArray(data.rgWishlist)) {
          for (const appId of data.rgWishlist) {
            if (appId && /^\d+$/.test(String(appId))) ids.add(String(appId));
          }
        }
      }
    } catch { /* endpoint may not be available */ }

    if (ids.size > 0) return [...ids];

    // Strategy 2: Try embedded wishlist data in the page's script tags
    try {
      const scripts = document.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('g_rgWishlistData')) {
          const match = text.match(/g_rgWishlistData\s*=\s*(\[[\s\S]*?\]);/);
          if (match) {
            const data = JSON.parse(match[1]);
            for (const item of data) {
              const appId = String(item.appid || item.appId || item.id);
              if (/^\d+$/.test(appId)) ids.add(appId);
            }
          }
        }
        const jsonMatch = text.match(/g_Wishlist\s*=\s*new\s+CWishlist\s*\(\s*(\[[\s\S]*?\])/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          for (const appId of data) {
            if (/^\d+$/.test(String(appId))) ids.add(String(appId));
          }
        }
      }
    } catch { /* parse errors are expected */ }

    if (ids.size > 0) return [...ids];

    // Strategy 3: Legacy paginated wishlist API (deprecated but may still work)
    const path = window.location.pathname;
    const profileMatch = path.match(/\/wishlist\/profiles\/(\d+)/);
    const vanityMatch = path.match(/\/wishlist\/id\/([^/]+)/);

    if (profileMatch || vanityMatch) {
      const base = profileMatch
        ? `/wishlist/profiles/${profileMatch[1]}/wishlistdata/`
        : `/wishlist/id/${vanityMatch[1]}/wishlistdata/`;

      try {
        let page = 0;
        let consecutiveEmpty = 0;

        while (page < 30) {
          const resp = await fetch(`${base}?p=${page}`, {
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });

          if (!resp.ok) break;

          const text = await resp.text();
          if (!text || text.trim() === '[]' || text.trim() === '{}' || text.trim().length < 5) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 2) break;
            page++;
            continue;
          }

          const data = JSON.parse(text);
          const pageIds = Object.keys(data).filter((k) => /^\d+$/.test(k));
          if (pageIds.length === 0) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 2) break;
            page++;
            continue;
          }

          consecutiveEmpty = 0;
          for (const id of pageIds) ids.add(id);
          page++;
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch { /* API might be deprecated */ }
    }

    if (ids.size > 0) return [...ids];

    // Strategy 4: Fall back to DOM scraping (gets only visible items)
    return collectSteamWishlistIdsFromDOM();
  }

  // Collects Steam App IDs from currently visible DOM elements
  function collectSteamWishlistIdsFromDOM() {
    const ids = new Set();

    document.querySelectorAll('[data-app-id]').forEach((el) => {
      const id = el.getAttribute('data-app-id');
      if (id && /^\d+$/.test(id)) ids.add(id);
    });

    document.querySelectorAll('.wishlist_row').forEach((el) => {
      const id = el.dataset.appId || el.getAttribute('data-app-id');
      if (id && /^\d+$/.test(id)) ids.add(id);
    });

    if (ids.size === 0) {
      const container = document.querySelector('#wishlist_items, .wishlist_items_ctn, [class*="WishlistPage"]');
      if (container) {
        container.querySelectorAll('a[href*="/app/"]').forEach((a) => {
          const m = a.href.match(/\/app\/(\d+)/);
          if (m) ids.add(m[1]);
        });
      }
    }

    if (ids.size === 0) {
      extractSteamAppIdsFromLinks().forEach((id) => ids.add(id));
    }

    return [...ids];
  }

  // MutationObserver for Steam's lazy-loaded wishlist — updates detected games
  // as new items appear when the user scrolls down
  let steamWishlistObserver = null;
  let steamWishlistTimer = null;

  function observeSteamWishlist() {
    if (steamWishlistObserver) return;

    const target = document.querySelector('#wishlist_items, .wishlist_items_ctn, [class*="WishlistPage"]') || document.body;

    steamWishlistObserver = new MutationObserver(() => {
      if (steamWishlistTimer) clearTimeout(steamWishlistTimer);
      steamWishlistTimer = setTimeout(() => {
        const domIds = collectSteamWishlistIdsFromDOM();
        // Merge with any cached API results
        const merged = new Set(cachedSteamWishlistIds || []);
        for (const id of domIds) merged.add(id);
        const allIds = [...merged];
        if (allIds.length > 0) {
          cachedSteamWishlistIds = allIds;
          chrome.runtime.sendMessage({
            action: 'gamesDetected',
            data: { type: 'steam_ids', ids: allIds, store: 'steam', pageType: 'wishlist' },
          });
        }
      }, 800);
    });

    steamWishlistObserver.observe(target, { childList: true, subtree: true });
  }

  function extractSteamAppIdsFromDOM() {
    const ids = new Set();
    try {
      document.querySelectorAll('[data-ds-appid]').forEach((el) => {
        const val = el.getAttribute('data-ds-appid');
        if (val) val.split(',').forEach((id) => {
          const trimmed = id.trim();
          if (/^\d+$/.test(trimmed)) ids.add(trimmed);
        });
      });
    } catch { /* defensive */ }
    if (ids.size === 0) {
      extractSteamAppIdsFromLinks().forEach((id) => ids.add(id));
    }
    return [...ids].slice(0, 100);
  }

  function extractSteamAppIdsFromLinks() {
    const ids = new Set();
    try {
      document.querySelectorAll('a[href*="/app/"]').forEach((a) => {
        const m = a.href?.match(/\/app\/(\d+)/);
        if (m) ids.add(m[1]);
      });
    } catch { /* defensive */ }
    return [...ids];
  }

  // ── GG.deals ───────────────────────────────────────────────────────────────

  function detectGGDealsGames() {
    const path = window.location.pathname;

    if (path.match(/^\/game\/.+/)) {
      const steamLink = safeQuerySelector('a[href*="store.steampowered.com/app/"]');
      if (steamLink) {
        const m = steamLink.href?.match(/\/app\/(\d+)/);
        if (m) return { type: 'steam_ids', ids: [m[1]], store: 'gg.deals' };
      }
      const title = safeTextContent('h1');
      if (title) return { type: 'titles', titles: [title], store: 'gg.deals' };
    }

    const steamIds = new Set();
    try {
      document.querySelectorAll('a[href*="store.steampowered.com/app/"]').forEach((a) => {
        const m = a.href?.match(/\/app\/(\d+)/);
        if (m) steamIds.add(m[1]);
      });
    } catch { /* defensive */ }
    if (steamIds.size > 0) {
      return { type: 'steam_ids', ids: [...steamIds].slice(0, 100), store: 'gg.deals' };
    }

    const titles = safeCollectTitles('.game-info-title, [data-game-title]', 20);
    if (titles.length > 0) {
      return { type: 'titles', titles, store: 'gg.deals' };
    }

    return null;
  }

  // ── Epic Games Store ───────────────────────────────────────────────────────

  function detectEpicGames() {
    const path = window.location.pathname;

    // Wishlist page: /wishlist or /en-US/wishlist
    if (path.match(/\/wishlist\/?$/i)) {
      return detectEpicWishlist();
    }

    const titles = [];

    // Strategy 1: URL slug
    const productMatch = path.match(/\/p\/([^/?#]+)/);
    const bundleMatch = path.match(/\/bundles\/([^/?#]+)/);
    const slug = productMatch?.[1] || bundleMatch?.[1];

    if (slug) {
      const cleaned = slug.replace(/-[a-f0-9]{6,}$/i, '');
      const titleFromSlug = slugToTitle(cleaned);
      if (titleFromSlug) titles.push(titleFromSlug);
    }

    // Strategy 2: document.title
    const docTitle = document.title;
    if (docTitle) {
      let cleaned = docTitle
        .replace(/\s*[-|–—]\s*(Epic Games( Store)?|Download|Buy).*$/i, '')
        .trim();
      cleaned = cleaned
        .replace(/^(Pre-Purchase\s*[&+]?\s*Pre-Order|Pre-Purchase|Pre-Order|Buy|Get)\s+/i, '')
        .trim();
      if (cleaned.length > 1 && cleaned.length < 200 && !titles.includes(cleaned)) {
        titles.push(cleaned);
      }
    }

    // Strategy 3: Epic DOM selectors
    const epicSelectors = DOM_SELECTORS.epicProduct;
    for (const sel of epicSelectors) {
      const t = safeTextContent(sel);
      if (t && t.length > 1 && t.length < 200 && !titles.includes(t)) {
        titles.push(t);
        break;
      }
    }

    // Strategy 4: JSON-LD
    const jsonLd = extractJsonLdTitle();
    if (jsonLd && !titles.includes(jsonLd)) titles.push(jsonLd);

    // Strategy 5: URL path fallback
    if (titles.length === 0) {
      const segments = path.split('/').filter(Boolean);
      const lastSeg = segments.filter((s) => !s.match(/^[a-z]{2}(-[A-Z]{2})?$/))[segments.length > 1 ? segments.length - 2 : 0];
      if (lastSeg && lastSeg.length > 2) {
        const cleaned = lastSeg
          .replace(/^(pre-purchase|pre-order|buy|get)[-_&+\s]*/i, '')
          .replace(/[-_]+/g, ' ')
          .trim();
        const titleFromPath = cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
        if (titleFromPath.length > 1 && !titles.includes(titleFromPath)) {
          titles.push(titleFromPath);
        }
      }
    }

    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 5), store: 'store.epicgames.com' };
    }

    return detectGenericTitles('store.epicgames.com');
  }

  function detectEpicWishlist() {
    const titles = [];

    // Epic wishlist uses card-based layout — try multiple selectors
    const wishlistSelectors = DOM_SELECTORS.epicWishlist;

    for (const sel of wishlistSelectors) {
      const collected = safeCollectTitles(sel, 200);
      if (collected.length > 0) {
        titles.push(...collected);
        break;
      }
    }

    // Fallback: grab all game card titles on the page
    if (titles.length === 0) {
      const cardSelectors = DOM_SELECTORS.epicCard;
      for (const sel of cardSelectors) {
        const collected = safeCollectTitles(sel, 200);
        if (collected.length > 0) {
          titles.push(...collected);
          break;
        }
      }
    }

    // Also try document.title as a hint that we're on the wishlist
    if (titles.length === 0) {
      // On Epic wishlist, the page title is typically just "Wishlist"
      // so look at the rendered card content more aggressively
      document.querySelectorAll('a[href*="/p/"]').forEach((a) => {
        const slug = a.href.match(/\/p\/([^/?#]+)/)?.[1];
        if (slug) {
          const cleaned = slug.replace(/-[a-f0-9]{6,}$/i, '');
          const title = slugToTitle(cleaned);
          if (title && title.length > 1 && !titles.includes(title)) titles.push(title);
        }
      });
    }

    if (titles.length > 0) {
      // Start observing for lazy-loaded items
      observeEpicWishlist();
      return { type: 'titles', titles: titles.slice(0, 200), store: 'store.epicgames.com', pageType: 'wishlist' };
    }

    // May not have loaded yet — set up observer
    observeEpicWishlist();
    return null;
  }

  let epicWishlistObserver = null;
  let epicWishlistTimer = null;

  function observeEpicWishlist() {
    if (epicWishlistObserver) return;

    epicWishlistObserver = new MutationObserver(() => {
      if (epicWishlistTimer) clearTimeout(epicWishlistTimer);
      epicWishlistTimer = setTimeout(() => {
        const result = detectEpicWishlist();
        if (result && result.titles && result.titles.length > 0) {
          chrome.runtime.sendMessage({ action: 'gamesDetected', data: result });
        }
      }, 1000);
    });

    const target = document.querySelector('[class*="Wishlist"], [class*="wishlist"], main, #app') || document.body;
    epicWishlistObserver.observe(target, { childList: true, subtree: true });
  }

  // ── GOG ────────────────────────────────────────────────────────────────────

  function detectGOGGames() {
    const path = window.location.pathname;
    const titles = [];

    const gameMatch = path.match(/\/game\/([^/?#]+)/);
    if (gameMatch) {
      const titleFromSlug = slugToTitle(gameMatch[1].replace(/_/g, '-'));
      if (titleFromSlug) titles.push(titleFromSlug);
    }

    const gogSelectors = DOM_SELECTORS.gogProduct;
    for (const sel of gogSelectors) {
      const t = safeTextContent(sel);
      if (t && t.length > 1 && t.length < 200 && !titles.includes(t)) {
        titles.push(t);
        break;
      }
    }

    const docTitle = document.title?.split('|')[0]?.split(' - ')[0]?.split(' on GOG')[0]?.trim();
    if (docTitle && docTitle.length > 1 && !titles.includes(docTitle)) {
      titles.push(docTitle);
    }

    const jsonLd = extractJsonLdTitle();
    if (jsonLd && !titles.includes(jsonLd)) titles.push(jsonLd);

    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 5), store: 'www.gog.com' };
    }

    return detectGenericTitles('www.gog.com');
  }

  // ── Humble Bundle ──────────────────────────────────────────────────────────

  function detectHumbleGames() {
    const path = window.location.pathname;

    // Step 1: Steam App IDs
    const steamIds = new Set();
    try {
      document.querySelectorAll('a[href*="store.steampowered.com/app/"]').forEach((a) => {
        const m = a.href?.match(/\/app\/(\d+)/);
        if (m) steamIds.add(m[1]);
      });
      document.querySelectorAll('[data-steam-appid], [data-appid]').forEach((el) => {
        const id = el.getAttribute('data-steam-appid') || el.getAttribute('data-appid');
        if (id && /^\d+$/.test(id)) steamIds.add(id);
      });
    } catch { /* defensive */ }
    if (steamIds.size > 0) {
      return { type: 'steam_ids', ids: [...steamIds].slice(0, 100), store: 'www.humblebundle.com' };
    }

    // Step 2: Item titles
    const titles = [];
    const bundleItemSelectors = DOM_SELECTORS.humbleBundleItem;
    for (const sel of bundleItemSelectors) {
      const collected = safeCollectTitles(sel, 50);
      if (collected.length > 0) {
        titles.push(...collected);
        break;
      }
    }

    // Step 3: Main product title
    if (titles.length === 0) {
      const storeMatch = path.match(/\/store\/([^/?#]+)/);
      if (storeMatch) {
        const titleFromSlug = slugToTitle(storeMatch[1]);
        if (titleFromSlug) titles.push(titleFromSlug);
      }

      const headerSelectors = DOM_SELECTORS.humbleHeader;
      for (const sel of headerSelectors) {
        const t = safeTextContent(sel);
        if (t && t.length > 1 && t.length < 200 && !titles.includes(t)) {
          titles.push(t);
          break;
        }
      }
    }

    // Step 4: document.title
    if (titles.length === 0) {
      const docTitle = document.title;
      if (docTitle) {
        let cleaned = docTitle
          .replace(/\s*[-|–—]\s*(Humble Bundle|Humble).*$/i, '')
          .replace(/^(Best of|Pay What You Want for)\s+/i, '')
          .trim();
        if (cleaned.length > 1 && cleaned.length < 200) {
          titles.push(cleaned);
        }
      }
    }

    // Step 5: JSON-LD
    const jsonLd = extractJsonLdTitle();
    if (jsonLd && !titles.includes(jsonLd)) titles.push(jsonLd);

    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 50), store: 'www.humblebundle.com' };
    }
    return null;
  }

  // ── Fanatical ──────────────────────────────────────────────────────────────

  function detectFanaticalGames() {
    const path = window.location.pathname;

    // Steam links
    const steamIds = new Set();
    try {
      document.querySelectorAll('a[href*="store.steampowered.com/app/"]').forEach((a) => {
        const m = a.href?.match(/\/app\/(\d+)/);
        if (m) steamIds.add(m[1]);
      });
    } catch { /* defensive */ }
    if (steamIds.size > 0) {
      return { type: 'steam_ids', ids: [...steamIds].slice(0, 100), store: 'www.fanatical.com' };
    }

    const titles = [];
    const isBundle = path.includes('/bundle/');
    if (isBundle) {
      const bundleSelectors = DOM_SELECTORS.fanaticalBundle;
      for (const sel of bundleSelectors) {
        const collected = safeCollectTitles(sel, 50);
        if (collected.length > 0) {
          titles.push(...collected);
          break;
        }
      }
    }

    const gameMatch = path.match(/\/(game|bundle|dlc)\/([^/?#]+)/);
    if (titles.length === 0 && gameMatch) {
      const titleFromSlug = slugToTitle(gameMatch[2]);
      if (titleFromSlug) titles.push(titleFromSlug);
    }

    const docTitle = document.title?.split('|')[0]?.split(' - ')[0]?.split(' — ')[0]?.trim();
    if (docTitle && docTitle.length > 1 && !titles.includes(docTitle)) {
      titles.push(docTitle);
    }

    const jsonLd = extractJsonLdTitle();
    if (jsonLd && !titles.includes(jsonLd)) titles.push(jsonLd);

    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 50), store: 'www.fanatical.com' };
    }
    return detectGenericTitles('www.fanatical.com');
  }

  // ── Green Man Gaming ───────────────────────────────────────────────────────

  function detectGMGGames() {
    // Rely on Universal Detector for GMG since they use standard meta/h1 tags efficiently
    const result = detectUniversalGame();
    if (result) {
      result.store = 'www.greenmangaming.com';
      return result;
    }

    // Fallback if the universal missed the metadata but we have a url slug
    const path = window.location.pathname;
    const gameMatch = path.match(/\/games\/([^/?#]+)/);
    if (gameMatch) {
      const titleFromSlug = slugToTitle(gameMatch[1]);
      if (titleFromSlug) return { type: 'titles', titles: [titleFromSlug], store: 'www.greenmangaming.com' };
    }
    return null;
  }

  // ── CDKeys ──────────────────────────────────────────────────────────────────

  function detectCDKeys() {
    return detectBySlugAndTitle(/\/([^/?#]+)(?:\?|$)/, 'www.cdkeys.com', [
      'h1.product-name', '.product-title', 'h1',
    ]);
  }

  // ── Kinguin ────────────────────────────────────────────────────────────────

  function detectKinguin() {
    return detectBySlugAndTitle(/\/([^/?#]+)-\d+$/, 'www.kinguin.net', [
      'h1[data-test-id="product-name"]', '.product-title', 'h1',
    ]);
  }

  // ── Eneba ──────────────────────────────────────────────────────────────────

  function detectEneba() {
    return detectBySlugAndTitle(/\/([^/?#]+)-\w+$/, 'www.eneba.com', [
      'h1.fUmBBG', '.product-title', 'h1',
    ]);
  }

  // ── G2A ────────────────────────────────────────────────────────────────────

  function detectG2A() {
    return detectBySlugAndTitle(/\/([^/?#]+)-i-\d+/, 'www.g2a.com', [
      'h1.product-name', '.product__title', 'h1',
    ]);
  }

  // ── AllKeyShop ─────────────────────────────────────────────────────────────

  function detectAllKeyShop() {
    return detectBySlugAndTitle(/\/buy\/([^/?#]+)/, 'www.allkeyshop.com', [
      'h1.game-title', '.content-title h1', 'h1',
    ]);
  }

  // ── Instant Gaming ─────────────────────────────────────────────────────────

  function detectInstantGaming() {
    return detectBySlugAndTitle(/\/([^/?#]+)$/, 'www.instant-gaming.com', [
      '.title.game-title', '.product-title h1', 'h1',
    ]);
  }

  // ── IsThereAnyDeal ─────────────────────────────────────────────────────────

  function detectIsThereAnyDeal() {
    return detectBySlugAndTitle(/\/game\/([^/?#]+)/, 'isthereanydeal.com', [
      '.game-header-title', 'h1', '.game-info-title',
    ]);
  }

  // ── GamersGate ─────────────────────────────────────────────────────────────

  function detectGamersGate() {
    return detectBySlugAndTitle(/\/product\/([^/?#]+)/, 'www.gamersgate.com', [
      '.product-title', 'h1', '.game-title',
    ]);
  }

  // ── WinGameStore ───────────────────────────────────────────────────────────

  function detectWinGameStore() {
    return detectBySlugAndTitle(/\/product\/\d+\/([^/?#]+)/, 'www.wingamestore.com', [
      '.product-title', 'h1',
    ]);
  }

  // ── DLGamer ────────────────────────────────────────────────────────────────

  function detectDLGamer() {
    return detectBySlugAndTitle(/\/([^/?#]+)-p-\d+/, 'www.dlgamer.com', [
      '.product_title', 'h1',
    ]);
  }

  // ── Universal helper for keyshop-style sites ───────────────────────────────

  function detectBySlugAndTitle(slugPattern, store, selectors) {
    const titles = [];
    const path = window.location.pathname;

    // Strategy 1: JSON-LD (most reliable)
    const jsonLd = extractJsonLdTitle();
    if (jsonLd) titles.push(jsonLd);

    // Strategy 2: DOM selectors
    for (const sel of selectors) {
      const t = safeTextContent(sel);
      if (t && t.length > 1 && t.length < 200 && !titles.includes(t)) {
        // Clean common suffixes like "- Steam Key", "PC Download", etc.
        const cleaned = t
          .replace(/\s*[-–—|]\s*(Steam|PC|Xbox|PS[45]|Nintendo|Switch|Global|EU|Key|Code|Download|CD Key|Digital).*$/gi, '')
          .trim();
        if (cleaned.length > 1 && !titles.includes(cleaned)) titles.push(cleaned);
        if (!titles.includes(t)) titles.push(t); // keep original too for matching
        break;
      }
    }

    // Strategy 3: URL slug
    const slugMatch = path.match(slugPattern);
    if (slugMatch) {
      const titleFromSlug = slugToTitle(slugMatch[1]);
      if (titleFromSlug && !titles.includes(titleFromSlug)) titles.push(titleFromSlug);
    }

    // Strategy 4: document.title cleanup
    const docTitle = document.title
      ?.split(/[|–—]/)[0]
      ?.replace(/\s*[-]\s*(Buy|Get|Best Price|Compare|Steam|Key|Code|Download).*$/gi, '')
      ?.trim();
    if (docTitle && docTitle.length > 1 && docTitle.length < 200 && !titles.includes(docTitle)) {
      titles.push(docTitle);
    }

    // Strategy 5: Open Graph
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    if (ogTitle && ogTitle.length > 1 && ogTitle.length < 200) {
      const cleaned = ogTitle.replace(/\s*[-–—|]\s*.+$/, '').trim();
      if (cleaned.length > 1 && !titles.includes(cleaned)) titles.push(cleaned);
    }

    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 5), store };
    }
    return null;
  }

  // ── Digiphile ──────────────────────────────────────────────────────────────

  function detectDigiphile() {
    // Digiphile heavily relies on direct "View on Steam" links that contain the App ID
    const steamIds = extractSteamAppIdsFromLinks();
    if (steamIds.length > 0) {
      return { type: 'steam_ids', ids: steamIds.slice(0, 100), store: 'digiphile.co' };
    }

    // Fallback for game titles (covers bundles and individual pages)
    const titles = safeCollectTitles('.card-title, .game-title, .product-title, h2', 50);
    if (titles.length > 0) {
      return { type: 'titles', titles, store: 'digiphile.co' };
    }

    return detectUniversalGame();
  }

  // ── Game pages on repack/unofficial sites (show legitimate deal to discourage piracy) ──

  function cleanGameTitleFromUnofficialSite(title) {
    if (!title || typeof title !== 'string') return null;
    let t = title
      .replace(/\s*[-–—|]\s*(FitGirl|Fitgirl|Repack|Repacks).*$/gi, '')
      .replace(/\s*[-–—|]\s*(IGG|IGG-Games|IGG Games).*$/gi, '')
      .replace(/\s*[-–—|]\s*(GOG-Games|GOG Games).*$/gi, '')
      .replace(/\s*(Free\s+)?Download\s*(PC|Full)?.*$/gi, '')
      .replace(/\s*,?\s*V?\d+\.\d+.*$/i, '') // version numbers at end
      .replace(/\s*[-–—|]\s*Deluxe Edition.*$/gi, '')
      .replace(/\s*[-–—|]\s*\+?\s*\d+\s*DLCs?\/?.*$/gi, '')
      .replace(/\s*\[[^\]]*\]\s*$/g, '')
      .trim();
    if (t.length < 2 || t.length > 200) return null;
    return t;
  }

  function detectGamePageSteamThenTitle() {
    const host = window.location.hostname;
    const store = host;
    const path = window.location.pathname || '';

    // 1) URL slug first — no DOM dependency, so it can't fail on quirky pages (e.g. Greedfall)
    const skipSegments = /^(games?|repack|download|category|tag|page|index|search)$/i;
    const segments = path.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (!seg || skipSegments.test(seg) || seg.length < 3) continue;
      const slug = seg
        .replace(/-repack$/i, '')
        .replace(/-download$/i, '')
        .replace(/-\d{4,}$/, '');
      const fromSlug = slugToTitle(slug);
      if (fromSlug && fromSlug.length > 2) {
        // Return immediately with slug-based title so DOM quirks can't block detection
        return { type: 'titles', titles: [fromSlug], store };
      }
    }

    // 2) No usable slug — try DOM (site names must not be used as game title)
    const siteNameTitles = /^(FitGirl Repacks?|FitGirl|IGG[- ]?Games?|GOG[- ]?Games?)$/i;
    const titles = [];
    const addCleaned = (raw) => {
      const cleaned = cleanGameTitleFromUnofficialSite(raw);
      if (cleaned && !titles.includes(cleaned) && !siteNameTitles.test(cleaned.trim())) {
        titles.push(cleaned);
      }
    };

    try {
      const h1 = safeTextContent('h1');
      if (h1) addCleaned(h1);
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
      if (ogTitle) addCleaned(ogTitle);
      const docTitle = document.title?.split(/[|–—]/)[0]?.trim();
      if (docTitle) addCleaned(docTitle);
      const selectors = ['.entry-title', '.post-title', '.game-title', '.title', 'h2.post-title', 'h1.title'];
      for (const sel of selectors) {
        const t = safeTextContent(sel);
        if (t) addCleaned(t);
      }
    } catch (_) { /* DOM may throw on some pages */ }

    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 5), store };
    }

    const steamIds = extractSteamAppIdsFromLinks();
    if (steamIds.length > 0) {
      return { type: 'steam_ids', ids: steamIds.slice(0, 10), store };
    }
    return null;
  }

  // ── Universal Detector (any website) ───────────────────────────────────────

  function detectUniversalGame() {
    const host = window.location.hostname;
    const titles = [];

    // JSON-LD structured data
    const jsonLd = extractJsonLdTitle();
    if (jsonLd) titles.push(jsonLd);

    // Open Graph
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    if (ogTitle && ogTitle.length > 1 && ogTitle.length < 200) {
      const cleaned = ogTitle.replace(/\s*[-–—|]\s*.+$/, '').trim();
      if (cleaned.length > 1 && !titles.includes(cleaned)) titles.push(cleaned);
    }

    // h1 tag (common for product pages)
    const h1 = safeTextContent('h1');
    if (h1 && h1.length > 2 && h1.length < 150) {
      const cleaned = h1
        .replace(/\s*[-–—|]\s*(Steam|PC|Xbox|PS[45]|Key|Code|Download|Digital|CD Key).*$/gi, '')
        .trim();
      if (cleaned.length > 1 && !titles.includes(cleaned)) titles.push(cleaned);
    }

    // Only proceed if we found something that looks like a game
    if (titles.length > 0) {
      return { type: 'titles', titles: titles.slice(0, 3), store: host };
    }
    return null;
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  function slugToTitle(slug) {
    if (!slug) return null;
    return slug
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  /** Safe querySelector that won't throw */
  function safeQuerySelector(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  /** Safely get text content from first matching element */
  function safeTextContent(selector) {
    try {
      const el = document.querySelector(selector);
      return el?.textContent?.trim() || null;
    } catch {
      return null;
    }
  }

  /** Collect text values from all matching elements, deduplicated */
  function safeCollectTitles(selector, limit = 20) {
    const titles = [];
    try {
      document.querySelectorAll(selector).forEach((el) => {
        const t = el.textContent?.trim();
        if (t && t.length > 1 && t.length < 200 && !titles.includes(t)) {
          titles.push(t);
        }
      });
    } catch { /* defensive */ }
    return titles.slice(0, limit);
  }

  function extractJsonLdTitle() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const data = JSON.parse(script.textContent);
        const item = Array.isArray(data) ? data[0] : data;
        if (item?.name && (item['@type'] === 'Product' || item['@type'] === 'VideoGame' || item['@type'] === 'SoftwareApplication')) {
          return item.name.trim();
        }
      }
    } catch { /* ignore parse errors */ }
    return null;
  }

  function detectGenericTitles(store) {
    const selectors = [
      '.product-title', '.game-title', '[data-component="Title"]',
      '.product-name', '.game-name', 'h2 a', 'h3 a',
    ];
    for (const sel of selectors) {
      const titles = safeCollectTitles(sel, 20);
      if (titles.length > 0) {
        return { type: 'titles', titles, store };
      }
    }
    return null;
  }

  // ── Detection runner ───────────────────────────────────────────────────────

  function getDetector() {
    const host = window.location.hostname;
    for (const [pattern, fn] of Object.entries(STORE_DETECTORS)) {
      if (host.includes(pattern)) return fn;
    }
    // Universal fallback — try to detect games on any website
    return detectUniversalGame;
  }

  // ── Product-page gates (bar only on real product URLs) ─────────────────────

  const PRODUCT_PAGE_GATES = [
    { host: /steampowered\.com$/i, path: /\/(app|sub|bundle)\/\d+/i },
    { host: /epicgames\.com$/i, path: /\/(p|bundles)\/[^/?#]+/i },
    { host: /gog\.com$/i, path: /\/(?:[a-z]{2}\/)?(?:game|movie)\//i },
    { host: /humblebundle\.com$/i, path: /\/(store|games?|bundle|monthly)\//i },
    { host: /fanatical\.com$/i, path: /\/(?:[a-z]{2}\/)?(?:game|dlc|bundle|pick-and-mix)\//i },
    { host: /greenmangaming\.com$/i, path: /\/games?\//i },
    { host: /cdkeys\.com$/i, path: /\/[^/?#]+\/[^/?#]+/i, exclude: /^\/(?:search|cart|account|wishlist|categories?|pc-games|xbox|playstation)\/?$/i },
    { host: /kinguin\.net$/i, path: /\/[^/?#]+-\d+\/?$/i },
    { host: /eneba\.com$/i, path: /\/[^/?#]+-\w+\/?$/i },
    { host: /g2a\.com$/i, path: /\/[^/?#]+-i-\d+/i },
    { host: /allkeyshop\.com$/i, path: /\/buy\/[^/?#]+/i },
    { host: /instant-gaming\.com$/i, path: /\/(?:[a-z]{2}\/)?(?:product|pc-game|game)\/|\/[^/?#]+-\d+\/?$/i },
    { host: /isthereanydeal\.com$/i, path: /\/game\/[^/?#]+/i },
    { host: /gamersgate\.com$/i, path: /\/product\/[^/?#]+/i },
    { host: /wingamestore\.com$/i, path: /\/product\/\d+\//i },
    { host: /dlgamer\.com$/i, path: /\/[^/?#]+-p-\d+/i },
    { host: /digiphile\.co$/i, path: /\/(?:game|product|deals?)\//i },
    { host: /gg\.deals$/i, path: /\/(?:game|pack|bundle)\//i },
    { host: /fitgirl-repacks\.site$/i, path: /\/[^/?#]+\/?$/i, exclude: /^\/(?:category|tag|page|search|author)\//i },
    { host: /igg-games\.com$/i, path: /\/[^/?#]+\/?$/i, exclude: /^\/(?:category|tag|page|search)\//i },
    { host: /gog-games(?:\.to|\.com)?$/i, path: /\/(?:game\/)?[^/?#]+\/?$/i, exclude: /^\/(?:category|tag|page|search)\//i },
  ];

  function isProductPage(url = window.location.href) {
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname || '/';
    for (const gate of PRODUCT_PAGE_GATES) {
      if (!gate.host.test(host) && !gate.host.test(parsed.hostname)) continue;
      if (gate.exclude && gate.exclude.test(path)) return false;
      if (gate.path.test(path)) return true;
      return false;
    }
    // Unknown host (universal detector): require a game-like path segment
    return /\/(?:game|games|product|p|app|bundle|store)\/[^/?#]+/i.test(path);
  }

  function run() {
    try {
      // Always sync toolbar icon with per-site hide, even on non-product pages
      getMergedUserPrefs().then(({ prefs }) => {
        const excluded = prefs.overlay !== false && isHostExcluded(prefs);
        chrome.runtime.sendMessage({ action: 'overlaySiteStatus', excluded }).catch(() => {});
      }).catch(() => {});

      const detector = getDetector();
      if (!detector) return;

      const result = detector();
      if (result && ((result.ids && result.ids.length > 0) || (result.titles && result.titles.length > 0))) {
        chrome.runtime.sendMessage({ action: 'gamesDetected', data: result });

        // Price bar only on product pages (not browse/search/wishlist lists)
        if (!isProductPage()) return;

        const steamTypes = {
          steam_ids: 'app',
          steam_sub_ids: 'sub',
          steam_bundle_ids: 'bundle',
        };
        if (steamTypes[result.type] && result.ids.length === 1) {
          const type = steamTypes[result.type];
          const id = type === 'app' ? result.ids[0] : `${type}:${result.ids[0]}`;
          injectPriceOverlay({ id, store: result.store });
        } else if (result.type === 'titles' && result.titles.length >= 1) {
          const isRepackSite = result.store && (
            result.store.includes('fitgirl-repacks') ||
            result.store.includes('igg-games.com') ||
            result.store.includes('gog-games')
          );
          // Product gate already applied; allow first title (repacks or single/dual match)
          if (isRepackSite || result.titles.length <= 2) {
            injectPriceOverlay({ title: result.titles[0], store: result.store });
          }
        }
      }
    } catch (e) {
      console.warn('[GameDealFinder] Detection error:', e);
    }
  }

  // ── SPA navigation detection via MutationObserver ──────────────────────────

  let lastUrl = window.location.href;
  let debounceTimer = null;
  // Overlay state (declared early so navigation handlers can clear it)
  let overlayEl = null;
  let overlayDismissed = false;
  let overlayMinimized = false;
  let lastOverlayState = null;
  try {
    overlayMinimized = sessionStorage.getItem('ggbuddy-bar-minimized') === '1';
  } catch { /* ignore */ }

  function onUrlChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    removeOverlay(); // Clean up overlay on navigation
    lastOverlayState = null;
    overlayDismissed = false;
    debounceTimer = setTimeout(run, 1000);
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    if (window.location.href !== lastUrl) { lastUrl = window.location.href; onUrlChange(); }
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    if (window.location.href !== lastUrl) { lastUrl = window.location.href; onUrlChange(); }
  };

  window.addEventListener('popstate', () => {
    if (window.location.href !== lastUrl) { lastUrl = window.location.href; onUrlChange(); }
  });

  try {
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) { lastUrl = window.location.href; onUrlChange(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    setInterval(() => {
      if (window.location.href !== lastUrl) { lastUrl = window.location.href; onUrlChange(); }
    }, 2000);
  }

  // ── Initial run ────────────────────────────────────────────────────────────

  if (document.readyState === 'complete') {
    setTimeout(run, 800);
  } else {
    window.addEventListener('load', () => setTimeout(run, 800));
  }

  // Listen for re-scan requests from the popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scanPage') {
      const host = window.location.hostname;
      const isRepackSite = host.includes('fitgirl-repacks') || host.includes('igg-games.com') || host.includes('gog-games');

      function doScan() {
        const detector = getDetector();
        return detector ? detector() : null;
      }

      let result = doScan();
      if (result) {
        sendResponse(result);
        return false;
      }
      // On repack sites, retry once after a short delay (DOM/URL may not be ready yet)
      if (isRepackSite) {
        setTimeout(() => {
          result = doScan();
          sendResponse(result);
        }, 500);
        return true; // keep channel open for async sendResponse
      }
      sendResponse(null);
      return false;
    }
    if (message.action === 'getWishlistStatus') {
      // Let the popup know about an ongoing wishlist fetch
      const path = window.location.pathname;
      const isWishlist = path.includes('/wishlist/');
      sendResponse({
        isWishlist,
        fetchInProgress: wishlistFetchInProgress,
        cachedCount: cachedSteamWishlistIds ? cachedSteamWishlistIds.length : 0,
      });
      return false;
    }
    if (message.action === 'getPrimaryImage') {
      const selectors = [
        '.game-cover img',
        '.game-media img',
        '.game-info img',
        'img[src*="images/games"]',
        'meta[property="og:image"]',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const src = el.tagName === 'META' ? el.getAttribute('content') : (el.currentSrc || el.src);
        if (src && /^https?:\/\//i.test(src)) {
          sendResponse({ image: src });
          return false;
        }
      }

      sendResponse({ image: null });
      return false;
    }

    if (message.action === 'quotaReset') {
      if (lastOverlayState && !overlayDismissed && isProductPage()) {
        const id = lastOverlayState.appId;
        const title = lastOverlayState.game?.title || lastOverlayState.meta?.titleHint;
        injectPriceOverlay({
          id: id || undefined,
          title: id ? undefined : title,
          store: lastOverlayState.store,
          region: lastOverlayState.prefs?.region || 'us',
        });
      }
      sendResponse?.({ ok: true });
      return false;
    }

    if (message.action === 'scrapeGgDealsShare') {
      const path = window.location.pathname || '';
      if (!/\/wishlist\/share\/[A-Za-z0-9_-]+/i.test(path)) {
        sendResponse({ success: false, error: 'Not a GG.deals share page' });
        return false;
      }
      const owner = (document.title || '').replace(/\s*wishlist.*$/i, '').replace(/'s$/i, '').trim() || null;
      let maxPage = 1;
      const pageFromUrl = (window.location.search.match(/[?&]page=(\d+)/i) || [])[1];
      if (pageFromUrl) maxPage = Math.max(maxPage, parseInt(pageFromUrl, 10) || 1);
      document.querySelectorAll('a[href*="page="]').forEach((a) => {
        const href = a.getAttribute('href') || a.href || '';
        const m = href.match(/[?&]page=(\d+)/i);
        if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10) || 1);
      });
      const games = [];
      const seen = new Set();
      document.querySelectorAll('[data-container-game-id]').forEach((el) => {
        const ggId = el.getAttribute('data-container-game-id');
        if (!ggId || seen.has(ggId)) return;
        seen.add(ggId);
        const title = (el.getAttribute('data-game-title') || '').trim();
        const slug = (el.getAttribute('data-game-name') || '').trim();
        let infoUrl = (el.getAttribute('data-info-url') || '').trim();
        if (infoUrl.startsWith('/')) infoUrl = `https://gg.deals${infoUrl}`;
        if (!title && !slug) return;
        games.push({ ggId, title: title || slug, slug, infoUrl: infoUrl || null });
      });
      sendResponse({ success: games.length > 0, owner, games, maxPage });
      return false;
    }
  });

  // ── Inline Price Overlay ───────────────────────────────────────────────────

  function removeOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  function getBarRoot() {
    if (!overlayEl) return null;
    return overlayEl.shadowRoot?.querySelector('.ggbuddy-bar') || overlayEl;
  }

  function getAccentPalette(accent) {
    const map = {
      blue: { accent: '#007bff', soft: '#60a5fa', nudge: '#0b5ed7', ctaBg: '#ffe347', ctaFg: '#0a1628' },
      green: { accent: '#048044', soft: '#4ade80', nudge: '#048044', ctaBg: '#ffe347', ctaFg: '#064e3b' },
      purple: { accent: '#7c3aed', soft: '#c4b5fd', nudge: '#5b21b6', ctaBg: '#fde68a', ctaFg: '#3b0764' },
      red: { accent: '#dc3545', soft: '#f87171', nudge: '#b91c1c', ctaBg: '#fde68a', ctaFg: '#7f1d1d' },
      orange: { accent: '#e67e22', soft: '#fdba74', nudge: '#c2410c', ctaBg: '#fff7ed', ctaFg: '#7c2d12' },
      pink: { accent: '#ec4899', soft: '#f9a8d4', nudge: '#be185d', ctaBg: '#fce7f3', ctaFg: '#831843' },
      cyan: { accent: '#06b6d4', soft: '#67e8f9', nudge: '#0e7490', ctaBg: '#ecfeff', ctaFg: '#164e63' },
    };
    return map[accent] || map.blue;
  }

  function applyAccentToBar(bar, prefs) {
    if (!bar) return;
    const palette = getAccentPalette(prefs?.accent || 'blue');
    bar.style.setProperty('--ggb-accent', palette.accent);
    bar.style.setProperty('--ggb-accent-soft', palette.soft);
    bar.style.setProperty('--ggb-nudge-bg', palette.nudge);
    bar.style.setProperty('--ggb-cta-bg', palette.ctaBg);
    bar.style.setProperty('--ggb-cta-fg', palette.ctaFg);
  }

  function applyOverlayAppearance(prefs) {
    const bar = getBarRoot();
    if (!bar) return;
    const theme = resolveOverlayTheme(prefs);
    const layout = prefs.overlayLayout === 'edge' ? 'edge' : 'rounded';
    const isSupport = bar.classList.contains('support-nudge');
    bar.className = [
      'ggbuddy-bar',
      'ggbuddy-no-anim',
      `theme-${theme}`,
      `layout-${layout}`,
      isSupport ? 'support-nudge' : '',
      overlayMinimized ? 'is-minimized' : '',
    ].filter(Boolean).join(' ');
    applyAccentToBar(bar, prefs);
  }

  async function handleOverlayPrefsChanged(newPrefs, oldPrefs = {}) {
    const prefs = newPrefs || {};
    const wasExcluded = isHostExcluded(oldPrefs);
    const nowExcluded = isHostExcluded(prefs);

    // Global overlay off or this site newly hidden → remove bar + update icon
    if (prefs.overlay === false || nowExcluded) {
      removeOverlay();
      chrome.runtime.sendMessage({
        action: 'overlaySiteStatus',
        excluded: prefs.overlay !== false && nowExcluded,
      }).catch(() => {});
      return;
    }

    // Site restored from hide list while we still have game data → re-show
    if (wasExcluded && !nowExcluded && lastOverlayState && !overlayDismissed && isProductPage()) {
      chrome.runtime.sendMessage({ action: 'overlaySiteStatus', excluded: false }).catch(() => {});
      renderOverlay(
        lastOverlayState.appId,
        lastOverlayState.game,
        lastOverlayState.store,
        prefs.officialOnly === true,
        prefs,
        lastOverlayState.meta || {}
      );
      return;
    }

    if (!overlayEl) return;

    const officialChanged = (oldPrefs.officialOnly === true) !== (prefs.officialOnly === true);
    if (officialChanged && lastOverlayState) {
      renderOverlay(
        lastOverlayState.appId,
        lastOverlayState.game,
        lastOverlayState.store,
        prefs.officialOnly === true,
        prefs,
        lastOverlayState.meta || {}
      );
      return;
    }

    // Theme / layout / accent — live class + CSS variable swap
    applyOverlayAppearance(prefs);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' && area !== 'sync') return;
      if (!changes.userPrefs) return;
      const newPrefs = changes.userPrefs.newValue || {};
      const oldPrefs = changes.userPrefs.oldValue || {};
      // Prefer the freshest merge so sync/local races don't flicker wrong
      getMergedUserPrefs().then(({ prefs }) => {
        handleOverlayPrefsChanged({ ...prefs, ...newPrefs }, oldPrefs);
      }).catch(() => {
        handleOverlayPrefsChanged(newPrefs, oldPrefs);
      });
    });
  } catch { /* storage API unavailable */ }

  // Live-update when OS theme flips and bar uses system / follow→system
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!overlayEl) return;
      getMergedUserPrefs().then(({ prefs }) => {
        const mode = prefs.overlayTheme || 'follow';
        const effective = mode === 'follow' ? (prefs.theme || 'dark') : mode;
        if (effective === 'system') applyOverlayAppearance(prefs);
      }).catch(() => {});
    });
  } catch { /* older browsers */ }

  function normalizeHost(host) {
    return String(host || '').toLowerCase().replace(/^www\./, '');
  }

  function getExcludedHosts(prefs) {
    return Array.isArray(prefs?.excludedHosts)
      ? prefs.excludedHosts.map(normalizeHost).filter(Boolean)
      : [];
  }

  function isHostExcluded(prefs, host = window.location.hostname) {
    const needle = normalizeHost(host);
    return getExcludedHosts(prefs).some((h) => needle === h || needle.endsWith('.' + h));
  }

  /** Match popup: merge sync userPrefs over local. */
  async function getMergedUserPrefs() {
    const local = await new Promise((resolve) => chrome.storage.local.get(['userPrefs', 'lastRegion'], resolve));
    const prefs = { ...(local.userPrefs || {}) };
    try {
      const sync = await new Promise((resolve) => chrome.storage.sync.get(['userPrefs'], resolve));
      if (sync && sync.userPrefs && typeof sync.userPrefs === 'object') {
        Object.assign(prefs, sync.userPrefs);
      }
    } catch { /* ignore */ }
    return { prefs, lastRegion: local.lastRegion };
  }

  async function saveExcludedHosts(hosts) {
    const { prefs } = await getMergedUserPrefs();
    prefs.excludedHosts = hosts;
    await new Promise((resolve) => chrome.storage.local.set({ userPrefs: prefs }, resolve));
    try {
      if (prefs.syncEnabled !== false) {
        await chrome.storage.sync.set({ userPrefs: prefs });
      }
    } catch { /* ignore */ }
  }

  function resolveOverlayTheme(prefs) {
    let theme = prefs.overlayTheme || 'follow';
    if (theme === 'follow') theme = prefs.theme || 'dark';
    if (theme === 'light') return 'light';
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    // dark / oled → dark bar
    return 'dark';
  }

  function overlayMsg(key, fallback, ...subs) {
    return chrome.i18n.getMessage(key, subs) || fallback;
  }

  async function injectPriceOverlay(opts) {
    if (overlayDismissed) return;

    let officialOnly = false;
    let prefs = {};
    try {
      const merged = await getMergedUserPrefs();
      prefs = merged.prefs;
      officialOnly = prefs.officialOnly === true;
      if (prefs.overlay === false) {
        chrome.runtime.sendMessage({ action: 'overlaySiteStatus', excluded: false }).catch(() => {});
        return;
      }
      if (isHostExcluded(prefs)) {
        chrome.runtime.sendMessage({ action: 'overlaySiteStatus', excluded: true }).catch(() => {});
        return;
      }
      chrome.runtime.sendMessage({ action: 'overlaySiteStatus', excluded: false }).catch(() => {});
      if (!prefs.region && merged.lastRegion) prefs.region = merged.lastRegion;
      if (!prefs.region) prefs.region = 'us';
      opts.region = prefs.region;
    } catch { /* proceed */ }

    let appId = opts.id;

    if (!appId && opts.title) {
      try {
        const searchResp = await new Promise((resolve) =>
          chrome.runtime.sendMessage({ action: 'searchSteam', query: opts.title, region: opts.region || 'us' }, resolve)
        );
        if (searchResp && searchResp.success && searchResp.data) {
          const firstEntry = Object.entries(searchResp.data).find(([, v]) => v && v.prices);
          if (firstEntry) {
            appId = firstEntry[0];
            renderOverlay(firstEntry[0], firstEntry[1], opts.store, officialOnly, prefs, {
              degraded: !!searchResp.degraded,
              rateLimited: !!searchResp.rateLimited,
            });
            return;
          }
        }
        if (searchResp?.rateLimited || searchResp?.errorCode === 'RATE_LIMIT' || searchResp?.error === 'RATE_LIMIT') {
          renderOverlay(null, null, opts.store, officialOnly, prefs, {
            degraded: true,
            rateLimited: true,
            titleHint: opts.title,
          });
          return;
        }
      } catch { /* fallback below */ }
      return;
    }

    if (!appId) return;

    chrome.runtime.sendMessage({ action: 'lookupByIds', ids: [appId], region: opts.region || 'us' }, (resp) => {
      const game = resp?.data?.[appId];
      if (resp?.success && game?.prices) {
        renderOverlay(appId, game, opts.store, officialOnly, prefs, {
          degraded: !!resp.degraded || !!game._ggCache?.stale,
          rateLimited: !!resp.rateLimited,
        });
        return;
      }
      // Never fail silently on rate limit — show last-known or empty degraded bar
      if (resp?.rateLimited || resp?.errorCode === 'RATE_LIMIT' || resp?.error === 'RATE_LIMIT' || resp?.degraded) {
        renderOverlay(appId, game || null, opts.store, officialOnly, prefs, {
          degraded: true,
          rateLimited: true,
        });
      }
    });
  }

  function getOverlayStyles() {
    return `
:host, .ggbuddy-bar {
  all: initial;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif !important;
}
.ggbuddy-bar {
  position: fixed !important;
  bottom: 16px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 2147483647 !important;
  width: min(960px, calc(100vw - 24px)) !important;
  font-size: 13px !important;
  line-height: 1.35 !important;
  color: var(--ggb-fg) !important;
  animation: ggBuddySlideUp 0.28s ease-out;
  pointer-events: none !important;
  transition: bottom 0.2s ease, left 0.2s ease, right 0.2s ease, width 0.2s ease, transform 0.2s ease;
}
.ggbuddy-bar *, .ggbuddy-bar *::before, .ggbuddy-bar *::after {
  box-sizing: border-box !important;
  font-family: inherit !important;
}
.ggbuddy-bar-shell {
  pointer-events: auto !important;
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 0 !important;
  padding: 10px 14px !important;
  background: var(--ggb-bg) !important;
  color: var(--ggb-fg) !important;
  border: 1px solid var(--ggb-border) !important;
  box-shadow: 0 8px 28px rgba(0,0,0,0.28) !important;
  backdrop-filter: blur(14px);
}
.ggbuddy-bar:not(.support-nudge) .ggbuddy-cta {
  background: var(--ggb-accent, #007bff) !important;
  color: #fff !important;
}
.ggbuddy-bar:not(.support-nudge) .ggbuddy-badge-save {
  background: var(--ggb-accent, #007bff) !important;
  color: #fff !important;
}
.ggbuddy-bar:not(.support-nudge) .ggbuddy-divider {
  background: var(--ggb-border) !important;
}
.ggbuddy-bar.layout-rounded .ggbuddy-bar-shell { border-radius: 14px !important; }
.ggbuddy-bar.layout-edge {
  bottom: 0 !important; left: 0 !important; right: 0 !important;
  transform: none !important; width: 100% !important;
}
.ggbuddy-bar.layout-edge .ggbuddy-bar-shell {
  border-radius: 0 !important; border-left: none !important; border-right: none !important; border-bottom: none !important;
  max-width: none !important; padding: 10px 20px !important;
}
.ggbuddy-bar.theme-dark {
  --ggb-bg: rgba(15,14,17,0.96); --ggb-fg: #f4f4f5; --ggb-muted: rgba(255,255,255,0.55);
  --ggb-border: rgba(255,255,255,0.08);
  --ggb-best: var(--ggb-accent-soft, #4ade80);
  --ggb-link: var(--ggb-accent-soft, #60a5fa);
  --ggb-hl-bg: var(--ggb-accent, #048044); --ggb-menu-bg: #1c1b20; --ggb-hover: rgba(255,255,255,0.08);
}
.ggbuddy-bar.theme-light {
  --ggb-bg: rgba(239,239,241,0.97); --ggb-fg: #18181b; --ggb-muted: rgba(0,0,0,0.5);
  --ggb-border: rgba(0,0,0,0.1);
  --ggb-best: var(--ggb-accent, #047857);
  --ggb-link: var(--ggb-accent, #1d4ed8);
  --ggb-hl-bg: var(--ggb-accent, #048044); --ggb-menu-bg: #fff; --ggb-hover: rgba(0,0,0,0.06);
}
.ggbuddy-bar.support-nudge {
  --ggb-bg: var(--ggb-nudge-bg, #048044);
  --ggb-fg: #fff;
  --ggb-muted: rgba(255,255,255,0.9);
  --ggb-border: rgba(255,255,255,0.18);
  --ggb-best: var(--ggb-cta-bg, #ffe347);
  --ggb-link: #fff;
  --ggb-hl-bg: rgba(0,0,0,0.25);
  --ggb-menu-bg: rgba(0,0,0,0.35);
  --ggb-hover: rgba(255,255,255,0.12);
}
.ggbuddy-bar.support-nudge.layout-rounded {
  width: min(1100px, calc(100vw - 24px)) !important;
}
.ggbuddy-bar.support-nudge.layout-edge {
  bottom: 0 !important; left: 0 !important; right: 0 !important;
  transform: none !important; width: 100% !important;
}
.ggbuddy-bar.support-nudge .ggbuddy-bar-shell {
  flex-wrap: nowrap !important;
  justify-content: center !important;
  gap: 0 !important;
  padding: 10px 16px !important;
}
.ggbuddy-bar.support-nudge.layout-edge .ggbuddy-bar-shell {
  border-radius: 0 !important;
  width: 100% !important;
  max-width: none !important;
}
.ggbuddy-bar-cluster {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 14px !important;
  width: auto !important;
  max-width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  position: static !important;
}
.ggbuddy-bar.support-nudge .ggbuddy-bar-main {
  display: contents !important;
}
.ggbuddy-bar.support-nudge .ggbuddy-link {
  margin-left: 0 !important;
}
.ggbuddy-badge {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 3px 8px !important;
  border-radius: 999px !important;
  font-size: 11px !important;
  font-weight: 800 !important;
  white-space: nowrap !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
  position: static !important;
  float: none !important;
  line-height: 1.2 !important;
}
.ggbuddy-badge-warn {
  background: rgba(0,0,0,0.22) !important;
  color: #fff !important;
  border: 1px solid rgba(255,255,255,0.2) !important;
}
.ggbuddy-badge-save {
  background: var(--ggb-cta-bg, #ffe347) !important;
  color: var(--ggb-cta-fg, #064e3b) !important;
}
.ggbuddy-cta {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
  background: var(--ggb-cta-bg, #ffe347) !important;
  color: var(--ggb-cta-fg, #064e3b) !important;
  font-weight: 900 !important;
  font-size: 12px !important;
  text-decoration: none !important;
  white-space: nowrap !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
  border: none !important;
  position: static !important;
}
.ggbuddy-cta:hover { filter: brightness(1.05); text-decoration: none !important; }
.ggbuddy-divider {
  width: 1px !important;
  height: 28px !important;
  background: rgba(255,255,255,0.25) !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
}
.ggbuddy-bar:not(.support-nudge) .ggbuddy-bar-shell {
  justify-content: center !important;
}
.ggbuddy-bar:not(.support-nudge) .ggbuddy-bar-main {
  flex: 0 1 auto !important;
}
.ggbuddy-logo {
  display: inline-block !important;
  font-weight: 900 !important; font-size: 13px !important;
  color: var(--ggb-accent, #048044) !important;
  white-space: nowrap !important; flex-shrink: 0 !important; margin: 0 !important; padding: 0 !important;
  position: static !important; float: none !important;
}
.ggbuddy-bar.support-nudge .ggbuddy-logo { color: #fff !important; }
.ggbuddy-bar-main {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  gap: 12px !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  margin: 0 !important; padding: 0 !important;
  position: static !important; float: none !important;
}
.ggbuddy-title {
  display: inline-block !important;
  font-weight: 700 !important; max-width: 180px !important;
  overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;
  margin: 0 !important; padding: 0 !important; position: static !important; float: none !important;
  color: inherit !important;
}
.ggbuddy-bar.support-nudge .ggbuddy-title {
  max-width: 160px !important;
}
.ggbuddy-prices {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: stretch !important;
  gap: 12px !important;
  flex: 0 0 auto !important;
  margin: 0 !important; padding: 0 !important;
  position: static !important; float: none !important;
}
.ggbuddy-price-col {
  display: flex !important;
  flex-direction: column !important;
  flex-wrap: nowrap !important;
  justify-content: center !important;
  gap: 2px !important;
  flex: 0 0 auto !important;
  min-width: max-content !important;
  margin: 0 !important; padding: 0 !important;
  position: static !important; float: none !important;
}
.ggbuddy-price-label {
  display: block !important;
  font-size: 10px !important; text-transform: uppercase !important; letter-spacing: 0.04em !important;
  color: var(--ggb-muted) !important; font-weight: 600 !important; line-height: 1.2 !important;
  margin: 0 !important; padding: 0 !important; position: static !important; float: none !important;
  white-space: nowrap !important;
}
.ggbuddy-price-value {
  display: block !important;
  font-weight: 700 !important; white-space: nowrap !important; line-height: 1.2 !important;
  margin: 0 !important; padding: 0 !important; position: static !important; float: none !important;
  color: inherit !important; font-size: 13px !important;
}
.ggbuddy-price-col.best .ggbuddy-price-value {
  color: var(--ggb-best) !important; font-weight: 900 !important; font-size: 15px !important;
}
.ggbuddy-hl {
  display: inline-block !important;
  background: var(--ggb-hl-bg) !important; color: #fff !important; padding: 2px 7px !important;
  border-radius: 4px !important; font-size: 11px !important; font-weight: 700 !important;
  white-space: nowrap !important; flex-shrink: 0 !important;
  margin: 0 !important; position: static !important; float: none !important;
}
.ggbuddy-cache {
  display: inline-block !important;
  background: rgba(128,128,128,0.22) !important; color: var(--ggb-muted) !important;
  padding: 2px 7px !important; border-radius: 4px !important; font-size: 11px !important;
  font-weight: 700 !important; white-space: nowrap !important; flex-shrink: 0 !important;
  margin: 0 !important; position: static !important; float: none !important;
}
.ggbuddy-rate-strip {
  pointer-events: auto !important;
  display: flex !important; align-items: center !important; justify-content: center !important;
  flex-wrap: wrap !important; gap: 8px !important; margin-top: 6px !important;
  padding: 6px 12px !important; border-radius: 10px !important;
  background: rgba(220, 100, 20, 0.95) !important; color: #fff !important;
  font-size: 12px !important; font-weight: 600 !important;
  box-shadow: 0 4px 14px rgba(0,0,0,0.2) !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-rate-strip,
.ggbuddy-bar.is-minimized .ggbuddy-cache { display: none !important; }
.ggbuddy-key-cta {
  color: #fff !important; font-weight: 800 !important; text-decoration: underline !important;
  margin: 0 !important; padding: 0 !important; background: none !important; border: none !important;
}
.ggbuddy-link {
  display: inline-block !important;
  color: var(--ggb-link) !important; font-weight: 700 !important; font-size: 12px !important;
  text-decoration: none !important; white-space: nowrap !important; margin-left: 0 !important;
  flex-shrink: 0 !important; padding: 0 !important; position: static !important; float: none !important;
  background: none !important; border: none !important;
}
.ggbuddy-link:hover { text-decoration: underline !important; }
.ggbuddy-support {
  display: inline-block !important;
  font-size: 11px !important; color: var(--ggb-muted) !important; max-width: 260px !important;
  line-height: 1.3 !important; margin: 0 !important; padding: 0 !important;
  position: static !important; float: none !important; white-space: normal !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-bar-cluster > :not(.ggbuddy-logo):not(.ggbuddy-mini-price):not(.ggbuddy-mini-hint) {
  display: none !important;
}
.ggbuddy-actions {
  display: flex !important; align-items: center !important; gap: 2px !important;
  flex-shrink: 0 !important; position: relative !important; margin: 0 !important; padding: 0 !important;
  float: none !important;
}
.ggbuddy-icon-btn {
  background: transparent !important; border: none !important; color: var(--ggb-muted) !important;
  cursor: pointer !important; width: 28px !important; height: 28px !important; border-radius: 6px !important;
  display: inline-flex !important; align-items: center !important; justify-content: center !important;
  padding: 0 !important; margin: 0 !important; position: static !important; float: none !important;
  font-size: 16px !important; line-height: 1 !important;
}
.ggbuddy-icon-btn:hover { background: var(--ggb-hover) !important; color: var(--ggb-fg) !important; }
.ggbuddy-menu {
  position: absolute !important; right: 0 !important; bottom: calc(100% + 6px) !important;
  min-width: 200px !important; background: var(--ggb-menu-bg) !important;
  border: 1px solid var(--ggb-border) !important; border-radius: 10px !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25) !important; padding: 4px !important;
  display: none !important; z-index: 2 !important; margin: 0 !important;
}
.ggbuddy-menu.open { display: block !important; }
.ggbuddy-menu button {
  display: flex !important; align-items: center !important; gap: 8px !important; width: 100% !important;
  background: transparent !important; border: none !important; color: var(--ggb-fg) !important;
  cursor: pointer !important; padding: 8px 10px !important; border-radius: 7px !important;
  font-size: 12px !important; text-align: left !important; margin: 0 !important;
  position: static !important; float: none !important;
}
.ggbuddy-menu button:hover { background: var(--ggb-hover) !important; }
.ggbuddy-bar.is-minimized {
  bottom: 16px !important; left: auto !important; right: 12px !important;
  transform: none !important; width: auto !important; max-width: none !important;
}
.ggbuddy-bar.is-minimized.layout-edge {
  bottom: 16px !important; left: auto !important; right: 12px !important;
  width: auto !important; transform: none !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-bar-shell {
  padding: 8px 12px !important; border-radius: 999px !important; cursor: pointer !important;
  gap: 8px !important; flex-wrap: nowrap !important; width: auto !important;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35) !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-bar-main,
.ggbuddy-bar.is-minimized .ggbuddy-actions,
.ggbuddy-bar.is-minimized .ggbuddy-support {
  display: none !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-logo {
  display: inline-block !important;
}
.ggbuddy-mini-price {
  display: none !important;
}
.ggbuddy-mini-hint {
  display: none !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-mini-price {
  display: inline-block !important;
  font-weight: 900 !important;
  font-size: 13px !important;
  color: var(--ggb-best) !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
  position: static !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-mini-hint {
  display: inline-block !important;
  font-size: 11px !important;
  color: var(--ggb-muted) !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
  position: static !important;
}
.ggbuddy-bar.ggbuddy-no-anim { animation: none !important; }
@keyframes ggBuddySlideUp {
  from { transform: translateX(-50%) translateY(16px); opacity: 0; }
  to { transform: translateX(-50%) translateY(0); opacity: 1; }
}
.ggbuddy-bar.layout-edge { animation-name: ggBuddySlideUpEdge; }
@keyframes ggBuddySlideUpEdge {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.ggbuddy-bar.is-minimized .ggbuddy-bar-cluster > :not(.ggbuddy-logo):not(.ggbuddy-mini-price):not(.ggbuddy-mini-hint) {
  display: none !important;
}
.ggbuddy-bar.is-minimized .ggbuddy-bar-shell {
  justify-content: center !important;
}
@media (max-width: 900px) {
  .ggbuddy-badge-warn { display: none !important; }
  .ggbuddy-divider { display: none !important; }
  .ggbuddy-price-col:not(.best) { display: none !important; }
}
@media (max-width: 720px) {
  .ggbuddy-title { max-width: 110px !important; }
  .ggbuddy-link { display: none !important; }
  .ggbuddy-badge-save { display: none !important; }
  .ggbuddy-hl { display: none !important; }
}
`;
  }

  function formatOverlayCacheAge(cacheMeta) {
    if (!cacheMeta?.stale) return '';
    const ageMs = cacheMeta.ageMs != null
      ? cacheMeta.ageMs
      : (cacheMeta.cachedAt ? Math.max(0, Date.now() - cacheMeta.cachedAt) : null);
    if (ageMs == null) return overlayMsg('cachedLabel', 'Cached');
    const mins = Math.max(1, Math.round(ageMs / 60000));
    if (mins < 60) return overlayMsg('cachedMinsAgo', `Cached · ${mins}m ago`, String(mins));
    const hours = Math.round(mins / 60);
    if (hours < 48) return overlayMsg('cachedHoursAgo', `Cached · ${hours}h ago`, String(hours));
    const days = Math.round(hours / 24);
    return overlayMsg('cachedDaysAgo', `Cached · ${days}d ago`, String(days));
  }

  function renderOverlay(appId, game, detectedStore, officialOnly = false, prefs = {}, meta = {}) {
    const p = game?.prices || null;
    const retail = p?.currentRetail ? parseFloat(p.currentRetail) : null;
    let keyshop = p?.currentKeyshops ? parseFloat(p.currentKeyshops) : null;
    if (officialOnly) keyshop = null;
    const currency = p?.currency || 'USD';
    const best = (retail !== null && keyshop !== null) ? Math.min(retail, keyshop) : (retail ?? keyshop);
    const degraded = !!(meta.degraded || meta.rateLimited || game?._ggCache?.stale);
    const rateLimited = !!meta.rateLimited;

    // Allow empty/degraded bar when rate-limited with no prices; otherwise require a best price
    if (best === null && !rateLimited && !degraded) return;

    const histRetail = p?.historicalRetail ? parseFloat(p.historicalRetail) : Infinity;
    const histKey = officialOnly ? Infinity : (p?.historicalKeyshops ? parseFloat(p.historicalKeyshops) : Infinity);
    const histLow = Math.min(histRetail, histKey);
    const isHistLow = best !== null && histLow !== Infinity && best <= histLow * 1.05;

    const isUnofficialPage = detectedStore && (
      detectedStore.includes('fitgirl-repacks') ||
      detectedStore.includes('igg-games.com') ||
      detectedStore.includes('gog-games')
    );

    const theme = resolveOverlayTheme(prefs);
    const layout = prefs.overlayLayout === 'edge' ? 'edge' : 'rounded';
    const retailStr = retail !== null ? `${retail} ${currency}` : '—';
    const keyStr = keyshop !== null ? `${keyshop} ${currency}` : '—';
    const bestStr = best !== null ? `${best} ${currency}` : '—';
    const titleText = game?.title || meta.titleHint || '';

    removeOverlay();
    lastOverlayState = { appId, game, store: detectedStore, prefs, officialOnly, meta };
    overlayEl = document.createElement('div');
    overlayEl.id = 'gg-deals-overlay';
    overlayEl.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'width: 0',
      'height: 0',
      'overflow: visible',
      'z-index: 2147483647',
      'pointer-events: none',
    ].join(';');

    const shadow = overlayEl.attachShadow({ mode: 'open' });
    const officialLabel = overlayMsg('overlayOfficial', 'Official');
    const keyshopLabel = overlayMsg('overlayKeyshop', 'Keyshop');
    const bestLabel = overlayMsg('overlayBestLabel', 'Best');
    const histLabel = overlayMsg('overlayHistoricalLow', 'Historical Low');
    const viewLabel = overlayMsg('overlayViewOnGgDeals', 'View on GG.deals →');
    const hideLabel = overlayMsg('overlayHideOnSite', 'Always hide on this site');
    const appearanceLabel = overlayMsg('overlayChangeAppearance', 'Change appearance');
    const minimizeLabel = overlayMsg('overlayMinimize', 'Minimize');
    const riskShort = overlayMsg('overlayBuyLegitShort', 'Buy legit — skip the malware risk');
    const saveLabel = overlayMsg('overlayYouSave', 'You save');
    const buyForLabel = overlayMsg('overlayBuyFor', 'Buy for');
    const cacheLabel = formatOverlayCacheAge(game?._ggCache) || (degraded ? overlayMsg('cachedLabel', 'Cached') : '');
    const rateLimitMsg = overlayMsg(
      'overlayRateLimited',
      'Rate limited — add free API key'
    );
    const getFreeKeyLabel = overlayMsg('getFreeKey', 'Get free key');

    let saveBadge = '';
    if (retail !== null && best !== null && retail > best) {
      const saved = Math.round((retail - best) * 100) / 100;
      const pct = Math.round(((retail - best) / retail) * 100);
      saveBadge = `<span class="ggbuddy-badge ggbuddy-badge-save">${escapeOverlay(saveLabel)} ${saved} ${escapeOverlay(currency)} (−${pct}%)</span>`;
    }

    const keyshopCol = officialOnly ? '' : `
      <div class="ggbuddy-price-col">
        <span class="ggbuddy-price-label">${escapeOverlay(keyshopLabel)}</span>
        <span class="ggbuddy-price-value">${escapeOverlay(keyStr)}</span>
      </div>`;

    const histBadge = isHistLow
      ? `<span class="ggbuddy-hl">★ ${escapeOverlay(histLabel)}</span>`
      : '';

    const cacheBadge = cacheLabel
      ? `<span class="ggbuddy-cache">${escapeOverlay(cacheLabel)}</span>`
      : '';

    const rateLimitStrip = rateLimited || (degraded && best === null)
      ? `<div class="ggbuddy-rate-strip">
          <span>${escapeOverlay(rateLimitMsg)}</span>
          <a class="ggbuddy-key-cta" href="https://gg.deals/settings/" target="_blank" rel="noopener">${escapeOverlay(getFreeKeyLabel)}</a>
        </div>`
      : '';

    const barClass = [
      'ggbuddy-bar',
      `theme-${theme}`,
      `layout-${layout}`,
      isUnofficialPage ? 'support-nudge' : '',
      overlayMinimized ? 'is-minimized' : '',
      degraded ? 'is-degraded' : '',
    ].filter(Boolean).join(' ');

    const warnBlock = isUnofficialPage
      ? `<span class="ggbuddy-badge ggbuddy-badge-warn">⚠ ${escapeOverlay(riskShort)}</span><span class="ggbuddy-divider" aria-hidden="true"></span>`
      : '';

    const ctaBlock = game?.url && best !== null
      ? `<a class="ggbuddy-cta" href="${escapeOverlay(game.url)}" target="_blank" rel="noopener">${escapeOverlay(buyForLabel)} ${escapeOverlay(bestStr)} →</a>`
      : '';

    setOverlayHtml(shadow, `
      <style>${getOverlayStyles()}</style>
      <div class="${barClass}" role="region" aria-label="GG Buddy price bar">
        <div class="ggbuddy-bar-shell" title="${overlayMinimized ? 'Click to expand' : ''}">
          <div class="ggbuddy-bar-cluster">
            <span class="ggbuddy-logo" title="GG Buddy">GG Buddy</span>
            <span class="ggbuddy-mini-price">${escapeOverlay(bestStr)}</span>
            <span class="ggbuddy-mini-hint">tap to expand</span>
            ${warnBlock}
            <span class="ggbuddy-title" title="${escapeOverlay(titleText)}">${escapeOverlay(titleText)}</span>
            <div class="ggbuddy-prices">
              <div class="ggbuddy-price-col">
                <span class="ggbuddy-price-label">${escapeOverlay(officialLabel)}</span>
                <span class="ggbuddy-price-value">${escapeOverlay(retailStr)}</span>
              </div>
              ${keyshopCol}
              <div class="ggbuddy-price-col best">
                <span class="ggbuddy-price-label">${escapeOverlay(bestLabel)}</span>
                <span class="ggbuddy-price-value">${escapeOverlay(bestStr)}</span>
              </div>
            </div>
            ${saveBadge}
            ${histBadge}
            ${cacheBadge}
            ${ctaBlock}
            <div class="ggbuddy-actions">
              <div class="ggbuddy-menu" id="ggbuddy-bar-menu" role="menu">
                <button type="button" data-action="hide-site" role="menuitem">${escapeOverlay(hideLabel)}</button>
                <button type="button" data-action="appearance" role="menuitem">${escapeOverlay(appearanceLabel)}</button>
                <button type="button" data-action="minimize" role="menuitem">${escapeOverlay(minimizeLabel)}</button>
              </div>
              <button type="button" class="ggbuddy-icon-btn" id="ggbuddy-bar-menu-btn" aria-label="Bar options" title="Options">⋮</button>
              <button type="button" class="ggbuddy-icon-btn" id="ggbuddy-bar-minimize" aria-label="${escapeOverlay(minimizeLabel)}" title="${escapeOverlay(minimizeLabel)}">›</button>
            </div>
          </div>
        </div>
        ${rateLimitStrip}
      </div>
    `);

    document.documentElement.appendChild(overlayEl);

    const bar = shadow.querySelector('.ggbuddy-bar');
    applyAccentToBar(bar, prefs);
    const menu = shadow.querySelector('#ggbuddy-bar-menu');
    const menuBtn = shadow.querySelector('#ggbuddy-bar-menu-btn');
    const minimizeBtn = shadow.querySelector('#ggbuddy-bar-minimize');
    const shell = shadow.querySelector('.ggbuddy-bar-shell');

    function setMinimized(on) {
      overlayMinimized = on;
      bar?.classList.toggle('is-minimized', on);
      if (shell) shell.title = on ? 'Click to expand' : '';
      try { sessionStorage.setItem('ggbuddy-bar-minimized', on ? '1' : '0'); } catch { /* ignore */ }
      if (menu) menu.classList.remove('open');
    }

    menuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      menu?.classList.toggle('open');
    });

    minimizeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      setMinimized(true);
    });

    shell?.addEventListener('click', (e) => {
      if (overlayMinimized) {
        e.stopPropagation();
        setMinimized(false);
      }
    });

    menu?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'minimize') {
        setMinimized(true);
        return;
      }
      if (action === 'appearance') {
        menu.classList.remove('open');
        chrome.runtime.sendMessage({ action: 'openOverlaySettings' }).catch(() => {});
        return;
      }
      if (action === 'hide-site') {
        const host = normalizeHost(window.location.hostname);
        const hosts = Array.from(new Set([...getExcludedHosts(prefs), host]));
        await saveExcludedHosts(hosts);
        chrome.runtime.sendMessage({ action: 'overlaySiteStatus', excluded: true }).catch(() => {});
        overlayDismissed = true;
        removeOverlay();
      }
    });
  }

  // Close bar menu when clicking outside (registered once)
  document.addEventListener('click', (e) => {
    if (!overlayEl?.shadowRoot) return;
    const menu = overlayEl.shadowRoot.querySelector('#ggbuddy-bar-menu');
    if (!menu || !menu.classList.contains('open')) return;
    if (e.composedPath && e.composedPath().includes(overlayEl)) return;
    menu.classList.remove('open');
  }, true);

  function escapeOverlay(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setOverlayHtml(root, html) {
    if (!root) return;
    const doc = new DOMParser().parseFromString('<div id="ggb-root">' + String(html) + '</div>', 'text/html');
    const wrap = doc.getElementById('ggb-root');
    if (!wrap) {
      root.replaceChildren();
      return;
    }
    root.replaceChildren(...Array.from(wrap.childNodes));
  }
})();
