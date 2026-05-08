# GitHub Installation Guide

This guide explains how to install GG Buddy directly from GitHub for both Chrome and Firefox browsers.

## 📥 Quick Installation Options

### Option 1: Direct Download (Easiest)
- [Download Chrome Extension](../../releases/latest/download/ggbuddy-chrome.zip)
- [Download Firefox Extension](../../releases/latest/download/ggbuddy-firefox.zip)

### Option 2: Build from Source
Clone the repository and build the extension yourself.

## 🌐 Chrome Installation

### Method 1: Direct Download
1. Download the latest Chrome release from the [Releases page](../../releases/latest)
2. Extract `ggbuddy-chrome.zip` to a folder
3. Follow the [Manual Install](#manual-install-chrome) steps below

### Method 2: Build from Source
1. Clone this repository:
   ```bash
   git clone https://github.com/Sn3akySl0th/gg-buddy.git
   cd gg-buddy
   ```

2. The Chrome extension is ready to use from the main folder

### Manual Install (Chrome)
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `gg-buddy` folder (or the folder where you extracted the zip)
5. The GG Buddy icon will appear in your toolbar

### Verify Installation
- Visit any game store (Steam, Epic Games, etc.)
- Look for the GG Buddy price overlay
- Click the extension icon to open the dashboard

## 🦊 Firefox Installation

### Method 1: Direct Download
1. Download the latest Firefox release from the [Releases page](../../releases/latest)
2. Extract `ggbuddy-firefox.zip` to a folder
3. Follow the [Manual Install](#manual-install-firefox) steps below

### Method 2: Build from Source
1. Clone this repository:
   ```bash
   git clone https://github.com/Sn3akySl0th/gg-buddy.git
   cd gg-buddy
   ```

2. Build the Firefox version:
   ```bash
   node build-firefox.js
   ```
   This creates a `dist-firefox/` folder with the Firefox-ready extension

### Manual Install (Firefox)
1. Open Firefox and navigate to `about:debugging`
2. Click **"This Firefox"**
3. Click **"Load Temporary Add-on..."**
4. Navigate to and select the `manifest.json` file:
   - For direct download: select `manifest.json` in the extracted folder
   - For build from source: select `dist-firefox/manifest.json`

### Verify Installation
- Visit any game store (Steam, Epic Games, etc.)
- Look for the GG Buddy price overlay
- Click the extension icon in the toolbar to open the dashboard

## 🔄 Updates

### Chrome Updates
1. Download the latest version from [Releases](../../releases/latest)
2. Extract to a new folder
3. In `chrome://extensions/`, remove the old version
4. Click **Load unpacked** and select the new folder

### Firefox Updates
1. Download the latest version from [Releases](../../releases/latest)
2. Extract to a new folder
3. In `about:debugging`, remove the old temporary add-on
4. Click **"Load Temporary Add-on..."** and select the new `manifest.json`

## 🛠️ Development Mode

For developers who want to contribute or test the latest features:

### Chrome Development
```bash
git clone https://github.com/Sn3akySl0th/gg-buddy.git
cd gg-buddy
# Load the folder in Chrome developer mode
```

### Firefox Development
```bash
git clone https://github.com/Sn3akySl0th/gg-buddy.git
cd gg-buddy
node build-firefox.js
# Load dist-firefox/ in Firefox about:debugging
```

## 📋 System Requirements

- **Chrome**: Version 88+ (Manifest V3 support)
- **Firefox**: Version 78+ (Manifest V2 support)
- **Node.js**: 14+ (for building Firefox version only)

## 🐛 Troubleshooting

### Chrome Issues
- **"Invalid manifest"**: Ensure you're loading the root folder containing `manifest.json`
- **"Permissions blocked"**: Check that you haven't denied any required permissions
- **Extension not working**: Open Chrome DevTools and check the console for errors

### Firefox Issues
- **"Reading manifest error"**: Make sure you're selecting the correct `manifest.json` file
- **"Add-on could not be installed"**: Try extracting to a different folder location
- **Extension not working**: Open Firefox Console (F12) and check for errors

### Common Solutions
1. **Restart browser** after installation
2. **Clear browser cache** if UI elements are missing
3. **Check console errors** by opening developer tools (F12)
4. **Verify permissions** in extension settings

## 📚 Additional Resources

- [Main README](README.md)
- [Firefox Specific Guide](FIREFOX-README.md)
- [Report Issues](../../issues)
- [Feature Requests](../../issues/new?template=feature_request.md)

## 🔒 Security Note

Installing extensions from GitHub means they bypass store review. Only install from trusted sources and verify the code matches the official repository.
