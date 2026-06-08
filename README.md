# GG Buddy 🎮💰

A Chrome and Firefox extension that automatically compares PC game prices across 17+ stores using [GG.deals](https://gg.deals). Never overpay for a game again.

![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/gg-buddy/)
![Version](https://img.shields.io/badge/version-2.8.1-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

🔍 **Auto-Detection** — Works on Steam, Epic, GOG, Humble, Fanatical, GMG, CDKeys, Kinguin, Eneba, G2A, AllKeyShop, Instant Gaming, IsThereAnyDeal, and more

🧩 **Steam App, Package & Bundle Support** — Steam `app/`, `sub/`, and `bundle/` URLs use the matching GG.deals API endpoints with package/bundle deal cards

💰 **Inline Price Overlay** — Floating bar on store pages shows the best price; with **Official Stores Only**, keyshops are hidden and only official retail is shown

🏆 **Deal Score & Historical Charts** — Smart rating based on discount depth and visual sparkline charts inside the dashboard

📊 **Smart Dashboard** — Shows price drops, micro-charts, and historical lows for your wishlisted games

💜 **Wishlist & Alerts** — Track games and get notified when prices drop below your target. Export your list to the clipboard

💾 **Cross-Browser Backup & Restore** — Export wishlist, alerts, preferences, API key, history, and custom images as JSON so you can move between Chrome and Firefox

📦 **Bundle Finder & Calculator** — Discover active bundles and instantly see your exact percentage savings vs buying individually

🧠 **Bundle Watchlist & Buy Recommendations** — Dashboard and wishlist cards now call out when a bundle is a better buy, when a game is near historical low, and when it is smarter to wait

🎛️ **Bundle Filters & Sorting** — Filter active bundles by store and sort by ending soon, price, or title

🧠 **Wishlist Bundle Callouts** — Wishlisted games now show whether an active bundle tier is worth considering vs standalone price

🖼️ **Custom Game Images** — Set or reset game artwork overrides from wishlist details, reused across views

🛡️ **Official Stores Only** — Filters keyshops from the popup (dashboard, search, wishlist, deal scores), the **inline overlay**, and **wishlist price alerts**; comparisons use official retailer pricing only

✅ **Buy Legit Nudges** — Encourages legit game purchases on piracy sites when prices hit historical lows

🎨 **Full Customization** — 4 themes (Light/Dark/OLED/System), 7 accent colors, compact mode

☁️ **Browser Sync** — Wishlist and settings sync across installs of the same browser profile when supported

🌐 **18 Languages** — Full UI localization (Czech, Danish, German, English, Spanish, Finnish, French, Italian, Japanese, Korean, Norwegian, Polish, Portuguese, Russian, Swedish, Ukrainian, Chinese Simplified)

## Installation

### 🏪 Official Stores
- **Chrome Web Store**: https://chromewebstore.google.com/detail/gg-buddy/fcilncfeaahfckkfeobdacblbijhegjc ![Status](https://img.shields.io/badge/Chrome-🔄%20Checking-yellow)
- **Firefox Add-ons**: https://addons.mozilla.org/en-US/firefox/addon/gg-buddy/ ![Status](https://img.shields.io/badge/Firefox-🔄%20Checking-yellow)

**📊 Store Status**: [View Release Status](RELEASE-STATUS.md) | [Track Issues](https://github.com/Sn3akySl0th/gg-buddy/issues?q=is%3Aissue+label%3Astore-status)

### 📥 Install from GitHub
For direct installation from GitHub (bypassing stores):

**Quick Download**:
- [Chrome Extension](../../releases/latest/download/ggbuddy-chrome.zip)
- [Firefox Extension](../../releases/latest/download/ggbuddy-firefox.zip)

**Detailed Instructions**: See [GitHub Installation Guide](GITHUB-INSTALL.md) for complete step-by-step instructions for both browsers.

### Manual Install (Developer Mode)
1. Download or clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the project folder
5. The extension icon appears in your toolbar

## Screenshots

*(Coming soon)*

## Tech Stack

- **Frontend:** HTML, CSS, Vanilla JavaScript
- **API:** [GG.deals Prices API](https://gg.deals/api/prices/)
- **Storage:** Chrome Storage API (local + sync)
- **Manifest:** V3

## Privacy

- No personal data collected
- All data stored locally in your browser
- No tracking or analytics
- [Privacy Policy](privacy-policy.html)

### How game-title matching works

GG Buddy looks up prices in real time, only for games you actively view or search — it never pre-scans your browsing. Here's the exact data flow:

1. **Pages with a Steam ID** (Steam store pages, known wishlist IDs) are looked up using the numeric ID directly — **no title text leaves your browser**.
2. **When only a title is known** (some non-Steam stores, proxy sites, or manual search), the **title text** is sent to Steam's public Store Search API (`store.steampowered.com/api/storesearch/`, fixed to `l=english&cc=us`) to resolve it into a numeric Steam App ID. The request contains only the title — nothing about you.
3. **Only the resulting numeric Steam IDs** — never the raw title — are sent to the **GG.deals Prices API**, along with a shared API key and your selected region code (e.g. `us`, `uk`).
4. **Results are cached locally** (prices ~30 min; title→ID lookups in memory) to cut down on repeat requests.

**Are users identified?** No. GG Buddy sends no account info, login, cookies, or per-user identifier. The GG.deals API key is **shared by all users**, so it identifies the extension rather than you. As with visiting any website, Steam and GG.deals receive standard request metadata (IP address, user-agent); GG Buddy adds nothing beyond that and runs no servers of its own. There is no telemetry, fingerprinting, or behavioral tracking.

See the full [Privacy Policy](privacy-policy.html) for details.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Credits

- Price data powered by [GG.deals](https://gg.deals)
- Icons and design inspired by GG.deals branding
