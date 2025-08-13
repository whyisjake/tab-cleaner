// Diagnostic service worker
console.log('DIAG: Service worker starting at', new Date().toISOString());

// Check the runtime context
console.log('DIAG: Runtime context check:');
console.log('DIAG: chrome exists:', typeof chrome !== 'undefined');
console.log('DIAG: chrome.runtime exists:', typeof chrome?.runtime !== 'undefined');
console.log('DIAG: chrome.runtime.onMessage exists:', typeof chrome?.runtime?.onMessage !== 'undefined');

// Set up message handler with multiple patterns
console.log('DIAG: Setting up message handler...');

try {
  const messageHandler = (message, sender, sendResponse) => {
    console.log('DIAG: *** MESSAGE RECEIVED ***');
    console.log('DIAG: Message:', JSON.stringify(message));
    console.log('DIAG: Sender:', JSON.stringify(sender));
    console.log('DIAG: SendResponse type:', typeof sendResponse);
    
    try {
      const response = { 
        success: true, 
        received: message,
        timestamp: Date.now(),
        serviceWorkerAlive: true
      };
      
      console.log('DIAG: Sending response:', JSON.stringify(response));
      sendResponse(response);
      console.log('DIAG: Response sent successfully');
      
    } catch (error) {
      console.error('DIAG: Error sending response:', error);
    }
    
    return false; // Synchronous response
  };
  
  chrome.runtime.onMessage.addListener(messageHandler);
  console.log('DIAG: Message handler registered successfully');
  
} catch (error) {
  console.error('DIAG: Error setting up message handler:', error);
}

// Keep the service worker alive with periodic logging
let heartbeatCount = 0;
const heartbeat = setInterval(() => {
  heartbeatCount++;
  console.log(`DIAG: Heartbeat ${heartbeatCount} at ${new Date().toISOString()}`);
  
  if (heartbeatCount > 10) {
    clearInterval(heartbeat);
    console.log('DIAG: Heartbeat stopped after 10 beats');
  }
}, 5000);

console.log('DIAG: Setup complete, service worker should be ready');

// Test internal message sending after a delay
setTimeout(() => {
  console.log('DIAG: Testing if we can send messages internally...');
  // Don't actually send internal messages as it might cause issues
}, 2000);