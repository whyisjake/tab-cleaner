// Simplified background script for testing
console.log('Simple service worker starting...');

// Simple message handler to test basic functionality
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Simple handler received message:', message);
  
  if (message.action === 'ping') {
    console.log('Ping received in simple handler');
    sendResponse({ pong: true, timestamp: Date.now() });
    return;
  }
  
  if (message.action === 'test') {
    console.log('Test message received');
    sendResponse({ success: true, message: 'Simple handler working' });
    return;
  }
  
  console.log('Unknown action in simple handler:', message.action);
  sendResponse({ error: 'Unknown action' });
});

console.log('Simple service worker message handler registered');