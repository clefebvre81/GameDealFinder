# Submit GG Buddy 2.8.2 to Chrome & Firefox

Packages are built and on GitHub: https://github.com/Sn3akySl0th/gg-buddy/releases/tag/v2.8.2

Local copies (same files): `dist-release/ggbuddy-chrome-2.8.2.zip` and `dist-release/ggbuddy-firefox-2.8.2.zip`

## What’s new (paste into both stores)

Copy from [`store-whats-new-2.8.2.txt`](store-whats-new-2.8.2.txt):

```
Polished price bar on product pages: Official / Keyshop / Best, historical-low badge, minimize, per-site hide, themes & layouts.
Import public GG.deals wishlist share links (all pages). Runs in the background — safe to close the popup. Review unresolved titles afterward.
Product-page gates so the bar only shows on real product URLs (including Steam packages/bundles).
```

## Chrome Web Store

1. Open [Chrome Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard)
2. Open **GG Buddy** → **Package** → Upload `ggbuddy-chrome-2.8.2.zip`
3. Paste What’s new (above)
4. Optionally refresh the long description from [`chrome-store-description.txt`](chrome-store-description.txt)
5. Submit for review

Extension ID: `fcilncfeaahfckkfeobdacblbijhegjc`

## Firefox Add-ons

1. Open [Firefox Developer Hub](https://addons.mozilla.org/developers/)
2. Open **GG Buddy** → Upload new version → `ggbuddy-firefox-2.8.2.zip`
3. Paste release notes (What’s new above)
4. Submit for review

## After approval

Update [`RELEASE-STATUS.md`](RELEASE-STATUS.md) to mark each store live.
