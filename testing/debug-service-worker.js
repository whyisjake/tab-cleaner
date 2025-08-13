// Debug script to test service worker persistence
// Run this in the Chrome extension's console to verify functionality

(async function debugServiceWorker() {
  console.log('=== Service Worker Debug Test ===');
  
  // Test 1: Check if background script is responsive with simpler message first
  console.log('1. Testing background script responsiveness...');
  
  try {
    // Try a simple message first
    const simpleResponse = await chrome.runtime.sendMessage({ action: 'updateBadge' });
    console.log('✓ Background script is responsive (simple test)');
    
    // Now try the complex message
    const response = await chrome.runtime.sendMessage({ action: 'getTabsData' });
    console.log('✓ Background script is responsive (complex test)');
    console.log(`✓ Tracking ${response.tabsData.length} tabs`);
  } catch (error) {
    console.log('✗ Background script not responsive:', error);
    console.log('Trying to wake up service worker...');
    
    // Try to wake up the service worker
    try {
      await chrome.runtime.sendMessage({ action: 'ping' });
      console.log('Ping sent, retrying...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const retryResponse = await chrome.runtime.sendMessage({ action: 'getTabsData' });
      console.log('✓ Service worker woke up successfully');
      console.log(`✓ Tracking ${retryResponse.tabsData.length} tabs`);
    } catch (retryError) {
      console.log('✗ Still not responsive after retry:', retryError);
      return;
    }
  }
  
  // Test 2: Check storage data
  console.log('\n2. Checking storage data...');
  
  const storageData = await chrome.storage.local.get([
    'backgroundTabActivity',
    'backgroundActivityTimestamp',
    'backgroundKeepaliveTimestamp'
  ]);
  
  if (storageData.backgroundTabActivity) {
    console.log(`✓ Activity data for ${Object.keys(storageData.backgroundTabActivity).length} tabs`);
    
    const dataAge = Date.now() - storageData.backgroundActivityTimestamp;
    console.log(`✓ Data age: ${Math.floor(dataAge / 1000)}s`);
    
    if (storageData.backgroundKeepaliveTimestamp) {
      const keepaliveAge = Date.now() - storageData.backgroundKeepaliveTimestamp;
      console.log(`✓ Last keepalive: ${Math.floor(keepaliveAge / 1000)}s ago`);
    }
  } else {
    console.log('✗ No activity data found in storage');
  }
  
  // Test 3: Check alarms
  console.log('\n3. Checking alarms...');
  
  const alarms = await chrome.alarms.getAll();
  console.log(`✓ Active alarms: ${alarms.length}`);
  alarms.forEach(alarm => {
    console.log(`  - ${alarm.name}: next in ${Math.floor(alarm.scheduledTime - Date.now())/1000}s`);
  });
  
  // Test 4: Activity tracking test
  console.log('\n4. Testing activity tracking...');
  
  const tabs = await chrome.tabs.query({});
  const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
  
  console.log(`✓ Total tabs: ${tabs.length}`);
  console.log(`✓ Active tab ID: ${activeTab[0]?.id}`);
  
  // Test ping functionality
  console.log('\n5. Testing service worker keepalive...');
  
  const port = chrome.runtime.connect({ name: 'debug-test' });
  port.postMessage({ action: 'ping' });
  
  port.onMessage.addListener((response) => {
    if (response.action === 'pong') {
      console.log('✓ Service worker keepalive working');
      console.log(`✓ Response time: ${Date.now() - response.timestamp}ms`);
    }
  });
  
  console.log('\n=== Debug Test Complete ===');
  console.log('If you see any ✗ marks above, the service worker may have issues.');
  console.log('Reload the extension and run this test again to verify fixes.');
})();