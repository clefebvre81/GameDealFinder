# GGBuddy for Firefox

This is the Firefox-compatible version of GGBuddy.

## Quick Start

### Build the Extension

```bash
node build-firefox.js
```

This creates a `dist-firefox/` folder with the Firefox-ready extension.

### Load in Firefox (Development)

1. Open Firefox
2. Type `about:debugging` in the address bar
3. Click **"This Firefox"**
4. Click **"Load Temporary Add-on..."**
5. Navigate to `dist-firefox/` and select `manifest.json`

### Package for Distribution

```bash
npx web-ext build --source-dir dist-firefox --artifacts-dir . --filename ggbuddy-firefox.zip --overwrite-dest
```

Upload `ggbuddy-firefox.zip` to [Firefox Add-ons](https://addons.mozilla.org/).

## Key Differences from Chrome Version

| Chrome | Firefox |
|--------|---------|
| `background.service_worker` | `background.scripts` |
| No extension ID required | `browser_specific_settings.gecko.id` required |

The extension code is identical - Firefox supports the `chrome.*` API namespace for compatibility.

## Troubleshooting

- **"Reading manifest" error**: Make sure you're using the `dist-firefox/` folder
- **API issues**: Check Firefox Console (F12 → Console) for errors
- **Content script not loading**: Verify host permissions match the websites you're visiting

## Testing Checklist

- [ ] Extension loads without errors
- [ ] Popup opens and shows UI
- [ ] Game detection works on Steam store pages
- [ ] Price lookup from context menu works
- [ ] Notifications appear (if enabled)
- [ ] Storage persists across sessions
