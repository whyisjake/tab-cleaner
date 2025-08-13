// Minimal test to isolate message handling issues
// Run this in Chrome extension console

(async function testMinimal() {
  console.log('=== Minimal Service Worker Test ===');
  
  // First, let's see if we can reach the service worker at all
  console.log('Testing basic runtime connectivity...');
  
  // Check if runtime exists
  if (!chrome.runtime) {
    console.log('✗ chrome.runtime not available');
    return;
  }
  
  console.log('✓ chrome.runtime available');
  
  // Try to get the service worker registration
  if (chrome.runtime.getServiceWorker) {
    try {
      const sw = await chrome.runtime.getServiceWorker();
      console.log('✓ Service worker registration:', sw ? 'found' : 'not found');
    } catch (error) {
      console.log('Service worker check error:', error);
    }
  }
  
  // Try the simplest possible message
  console.log('Attempting simple message...');
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('✓ Simple message successful:', response);
  } catch (error) {
    console.log('✗ Simple message failed:', error);
  }
  
  console.log('=== Test Complete ===');
})();