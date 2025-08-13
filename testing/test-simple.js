// Simple test - run this in the Chrome extension console

(async function testBasicConnection() {
  console.log('Testing basic service worker connection...');
  
  try {
    console.log('Sending ping...');
    const response = await chrome.runtime.sendMessage({ action: 'ping' });
    console.log('✓ Ping successful:', response);
    
    // Test the updated debug script
    const debugResponse = await chrome.runtime.sendMessage({ action: 'updateBadge' });
    console.log('✓ Badge update successful:', debugResponse);
    
  } catch (error) {
    console.log('✗ Connection failed:', error);
    console.log('Check the service worker console for errors');
  }
})();