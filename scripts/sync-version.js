#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔄 Syncing version between package.json and manifest.json...');

try {
  // Read package.json version
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageContent = fs.readFileSync(packagePath, 'utf8');
  const packageJson = JSON.parse(packageContent);
  const newVersion = packageJson.version;
  
  // Read manifest.json
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  const oldVersion = manifest.version;
  
  if (oldVersion === newVersion) {
    console.log(`✅ Version already synced: ${newVersion}`);
    process.exit(0);
  }
  
  // Update manifest version
  manifest.version = newVersion;
  
  // Write updated manifest
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  
  console.log(`✅ Updated manifest.json version: ${oldVersion} → ${newVersion}`);
  
} catch (error) {
  console.error('❌ Error syncing version:', error.message);
  process.exit(1);
}