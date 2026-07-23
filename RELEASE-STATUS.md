# 📊 Release Status Tracking

This document tracks the release status of GG Buddy across different platforms.

## 🏪 Store Status

### 🌐 Chrome Web Store
- **Current Version (live)**: check store listing
- **Submitting**: **2.8.2**
- **Status**: 📦 Ready to upload
- **Extension ID**: `fcilncfeaahfckkfeobdacblbijhegjc`
- **Store URL**: https://chromewebstore.google.com/detail/gg-buddy/fcilncfeaahfckkfeobdacblbijhegjc
- **Package**: `dist-release/ggbuddy-chrome-2.8.2.zip`
- **What’s new text**: `store-whats-new-2.8.2.txt`
- **Full description**: `chrome-store-description.txt`
- **Last Updated**: 2026-07-23
- **Review Status**: Ready for submission

### 🦊 Firefox Add-ons
- **Current Version (live)**: check store listing
- **Submitting**: **2.8.2**
- **Status**: 📦 Ready to upload
- **Extension ID**: `ggbuddy@example.com`
- **Store URL**: https://addons.mozilla.org/firefox/addon/gg-buddy/
- **Package**: `dist-release/ggbuddy-firefox-2.8.2.zip`
- **What’s new text**: `store-whats-new-2.8.2.txt`
- **Last Updated**: 2026-07-23
- **Review Status**: Ready for submission

## 📦 GitHub Releases
- **Latest Release**: v2.8.2
- **Release Date**: 2026-07-23
- **Download Assets**:
  - ✅ `ggbuddy-chrome-2.8.2.zip` — Chrome Web Store upload
  - ✅ `ggbuddy-firefox-2.8.2.zip` — Firefox Add-ons upload
  - ✅ `ggbuddy-chrome.zip` — latest Chrome alias (if published on release)
  - ✅ `ggbuddy-firefox.zip` — latest Firefox alias (if published on release)

## 📋 Store submission checklist (2.8.2)

1. [ ] Reload / smoke-test unpacked build locally (Chrome + Firefox)
2. [ ] Run `npm run build-release` (zips in `dist-release/`)
3. [ ] Push git tag `v2.8.2` / GitHub release with zips
4. [ ] **Chrome**: Developer Dashboard → upload `ggbuddy-chrome-2.8.2.zip` → paste What’s new from `store-whats-new-2.8.2.txt` → refresh description from `chrome-store-description.txt` if needed → Submit for review
5. [ ] **Firefox**: Developer Hub → upload `ggbuddy-firefox-2.8.2.zip` → paste release notes → Submit for review
6. [ ] Update this file when each store goes live

## 🔗 Quick Links

- [Chrome Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard)
- [Firefox Developer Hub](https://addons.mozilla.org/developers/)
- [GitHub Releases](https://github.com/Sn3akySl0th/gg-buddy/releases)
- [GitHub Actions](https://github.com/Sn3akySl0th/gg-buddy/actions)

---

**Last Updated**: 2026-07-23
