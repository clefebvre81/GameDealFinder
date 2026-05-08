#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Make the script async
(async function() {

// Configuration
const version = require('./package.json')?.version || '2.8.0';
const distDir = path.join(__dirname, 'dist-release');
const chromeZip = path.join(distDir, `ggbuddy-chrome-${version}.zip`);
const firefoxZip = path.join(distDir, `ggbuddy-firefox-${version}.zip`);

console.log(`🏗️  Building GG Buddy v${version} for release...`);

// Clean and create dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Files to include in Chrome build
const chromeFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.css',
  'popup.js',
  '_locales/**/*',
  'images/**/*',
  'privacy-policy.html',
  'changelog.html',
  'changelog.js',
  'LICENSE'
];

// Files to include in Firefox build
const firefoxFiles = [
  'manifest-firefox.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.css',
  'popup.js',
  '_locales/**/*',
  'images/**/*',
  'privacy-policy.html',
  'changelog.html',
  'changelog.js',
  'LICENSE'
];

// Helper function to copy files
function copyFiles(files, destDir) {
  console.log(`📁 Copying files to ${destDir}...`);
  
  files.forEach(pattern => {
    if (pattern.includes('**')) {
      // Handle glob patterns
      const basePattern = pattern.replace('**/*', '');
      const baseDir = path.join(__dirname, basePattern);
      
      if (fs.existsSync(baseDir)) {
        const destBaseDir = path.join(destDir, basePattern);
        fs.mkdirSync(destBaseDir, { recursive: true });
        
        fs.readdirSync(baseDir, { withFileTypes: true }).forEach(entry => {
          if (entry.isDirectory()) {
            const srcDir = path.join(baseDir, entry.name);
            const destSubDir = path.join(destBaseDir, entry.name);
            
            fs.mkdirSync(destSubDir, { recursive: true });
            fs.readdirSync(srcDir).forEach(file => {
              const srcFile = path.join(srcDir, file);
              const destFile = path.join(destSubDir, file);
              fs.copyFileSync(srcFile, destFile);
            });
          } else {
            const srcFile = path.join(baseDir, entry.name);
            const destFile = path.join(destBaseDir, entry.name);
            fs.copyFileSync(srcFile, destFile);
          }
        });
      }
    } else {
      // Handle individual files
      const srcFile = path.join(__dirname, pattern);
      if (fs.existsSync(srcFile)) {
        const destFile = path.join(destDir, pattern);
        
        // Create directory if needed
        const destDirPath = path.dirname(destFile);
        if (!fs.existsSync(destDirPath)) {
          fs.mkdirSync(destDirPath, { recursive: true });
        }
        
        fs.copyFileSync(srcFile, destFile);
      }
    }
  });
}

// Build Chrome extension
console.log('\n🌐 Building Chrome extension...');
const chromeDir = path.join(distDir, 'chrome');
fs.mkdirSync(chromeDir, { recursive: true });
copyFiles(chromeFiles, chromeDir);

// Build Firefox extension
console.log('\n🦊 Building Firefox extension...');
const firefoxDir = path.join(distDir, 'firefox');
fs.mkdirSync(firefoxDir, { recursive: true });

// Copy Firefox files
copyFiles(firefoxFiles, firefoxDir);

// Rename manifest-firefox.json to manifest.json for Firefox
const firefoxManifest = path.join(firefoxDir, 'manifest-firefox.json');
const firefoxManifestDest = path.join(firefoxDir, 'manifest.json');
if (fs.existsSync(firefoxManifest)) {
  fs.copyFileSync(firefoxManifest, firefoxManifestDest);
  fs.unlinkSync(firefoxManifest);
}

// Create ZIP files using Node.js
console.log('\n📦 Creating ZIP files...');

try {
  const archiver = require('archiver');
  const fs = require('fs');
  
  // Chrome ZIP
  const chromeOutput = fs.createWriteStream(chromeZip);
  const chromeArchive = archiver('zip', { zlib: { level: 9 } });
  
  chromeArchive.pipe(chromeOutput);
  chromeArchive.directory(chromeDir, false);
  
  chromeArchive.finalize();
  
  await new Promise((resolve, reject) => {
    chromeOutput.on('close', resolve);
    chromeArchive.on('error', reject);
  });
  
  console.log(`✅ Chrome ZIP created: ${path.basename(chromeZip)}`);
  
  // Firefox ZIP
  const firefoxOutput = fs.createWriteStream(firefoxZip);
  const firefoxArchive = archiver('zip', { zlib: { level: 9 } });
  
  firefoxArchive.pipe(firefoxOutput);
  firefoxArchive.directory(firefoxDir, false);
  
  firefoxArchive.finalize();
  
  await new Promise((resolve, reject) => {
    firefoxOutput.on('close', resolve);
    firefoxArchive.on('error', reject);
  });
  
  console.log(`✅ Firefox ZIP created: ${path.basename(firefoxZip)}`);
  
} catch (error) {
  console.error('❌ Error creating ZIP files:', error.message);
  console.log('💡 Make sure archiver is installed: npm install archiver --save-dev');
  process.exit(1);
}

// Create latest symlinks for GitHub releases
try {
  const latestChrome = path.join(distDir, 'ggbuddy-chrome.zip');
  const latestFirefox = path.join(distDir, 'ggbuddy-firefox.zip');
  
  if (fs.existsSync(chromeZip)) {
    fs.copyFileSync(chromeZip, latestChrome);
    console.log(`🔗 Created latest Chrome symlink`);
  }
  
  if (fs.existsSync(firefoxZip)) {
    fs.copyFileSync(firefoxZip, latestFirefox);
    console.log(`🔗 Created latest Firefox symlink`);
  }
} catch (error) {
  console.log('⚠️  Could not create latest symlinks');
}

// Clean up build directories
fs.rmSync(chromeDir, { recursive: true, force: true });
fs.rmSync(firefoxDir, { recursive: true, force: true });

console.log('\n🎉 Build complete!');
console.log(`📁 Release files in: ${distDir}`);
console.log(`📄 Chrome: ggbuddy-chrome-${version}.zip`);
console.log(`📄 Firefox: ggbuddy-firefox-${version}.zip`);
console.log('\n💡 Upload these files to GitHub Releases for distribution.');

})(); // Close async function
