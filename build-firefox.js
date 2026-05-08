/**
 * Build script for Firefox version of GGBuddy
 * Run: node build-firefox.js
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = '.';
const BUILD_DIR = './dist-firefox';

// Only ship runtime files. AMO validates every .js/.json file in the archive,
// including unused helper scripts and local test fixtures.
const FILES_TO_COPY = [
  '_locales',
  'images',
  'background.js',
  'CHANGELOG.md',
  'changelog.html',
  'changelog.js',
  'content.js',
  'popup.css',
  'popup.html',
  'popup.js',
  'privacy-policy.html',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFileOrDir(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyFileOrDir(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  console.log('Building Firefox version of GGBuddy...');

  // Clean and create build directory
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true });
  }
  ensureDir(BUILD_DIR);

  // Copy files
  for (const file of FILES_TO_COPY) {
    const srcPath = path.join(SRC_DIR, file);
    const destPath = path.join(BUILD_DIR, file);
    if (fs.existsSync(srcPath)) {
      copyFileOrDir(srcPath, destPath);
      console.log(`Copied: ${file}`);
    } else {
      console.warn(`Warning: ${file} not found`);
    }
  }

  // Copy Firefox manifest
  const firefoxManifest = fs.readFileSync(path.join(SRC_DIR, 'manifest-firefox.json'), 'utf8');
  fs.writeFileSync(path.join(BUILD_DIR, 'manifest.json'), firefoxManifest);
  console.log('Copied: manifest-firefox.json as manifest.json');

  console.log(`\n✅ Firefox build complete: ${BUILD_DIR}/`);
  console.log('\nTo load in Firefox:');
  console.log('1. Open Firefox');
  console.log('2. Go to about:debugging');
  console.log('3. Click "This Firefox"');
  console.log('4. Click "Load Temporary Add-on"');
  console.log(`5. Select ${BUILD_DIR}/manifest.json`);
  console.log('\nTo package for distribution:');
  console.log(`npx web-ext build --source-dir ${BUILD_DIR} --artifacts-dir . --filename ggbuddy-firefox.zip --overwrite-dest`);
}

main();
