#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating manifest.json...');

try {
  // Read and parse manifest
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  
  // Validation checks
  const checks = [
    {
      name: 'Manifest version',
      test: () => manifest.manifest_version === 3,
      message: 'Should use Manifest V3'
    },
    {
      name: 'Extension name',
      test: () => manifest.name && manifest.name.length > 0,
      message: 'Name is required'
    },
    {
      name: 'Version format',
      test: () => /^\d+\.\d+\.\d+$/.test(manifest.version),
      message: 'Version should follow semantic versioning (x.y.z)'
    },
    {
      name: 'Description length',
      test: () => manifest.description && manifest.description.length <= 132,
      message: 'Description should be 132 characters or less for Chrome Web Store'
    },
    {
      name: 'Required icons',
      test: () => manifest.icons && manifest.icons['16'] && manifest.icons['128'],
      message: 'Should have at least 16x16 and 128x128 icons'
    },
    {
      name: 'Service worker',
      test: () => manifest.background && manifest.background.service_worker,
      message: 'Manifest V3 requires service_worker in background'
    },
    {
      name: 'Permissions array',
      test: () => Array.isArray(manifest.permissions),
      message: 'Permissions should be an array'
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  checks.forEach(check => {
    if (check.test()) {
      console.log(`✅ ${check.name}`);
      passed++;
    } else {
      console.log(`❌ ${check.name}: ${check.message}`);
      failed++;
    }
  });
  
  // Check if all required files exist
  const requiredFiles = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...(manifest.icons ? Object.values(manifest.icons) : [])
  ].filter(Boolean);
  
  console.log('\n🔍 Checking required files...');
  let missingFiles = 0;
  
  requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ Missing file: ${file}`);
      missingFiles++;
      failed++;
    }
  });
  
  // Summary
  console.log(`\n📊 Validation Summary:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed + missingFiles}`);
  
  if (failed + missingFiles === 0) {
    console.log('\n🎉 Manifest validation passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Manifest validation failed!');
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ Error validating manifest:', error.message);
  process.exit(1);
}