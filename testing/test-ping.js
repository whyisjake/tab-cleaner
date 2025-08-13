// Simple ping test
console.log('Testing ping...');

chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
  if (chrome.runtime.lastError) {
    console.log('✗ Ping failed:', chrome.runtime.lastError);
  } else {
    console.log('✓ Ping successful:', response);
  }
});