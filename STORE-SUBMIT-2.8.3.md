# Firefox submission — GG Buddy 2.8.3

## Release notes (paste into AMO)

```
Cleared Firefox validation warnings by removing unsafe innerHTML assignments in the popup and price bar (DOM is built safely with escaped text).

Also in recent 2.8.x: polished price bar (Official / Keyshop / Best, historical-low badge, minimize, per-site hide); import public GG.deals wishlist share links in the background with an unresolved list; product-page-only bar gates including Steam packages/bundles.
```

Shorter option (2.8.3-only):

```
Security/quality: replaced innerHTML usage with safer DOM construction to resolve AMO linter warnings. No feature regressions intended.
```

## Package

- Build: `npm run build-release`
- Upload: `dist-release/ggbuddy-firefox-2.8.3.zip`
