# Tab Cleaner Chrome Extension - Developer Guide

This document provides a comprehensive understanding of the Tab Cleaner Chrome extension architecture, development workflow, and key technical concepts for future Claude instances and developers.

## 🏗️ Architecture Overview

Tab Cleaner is a Chrome Extension (Manifest V3) that automatically closes inactive tabs and provides tab activity monitoring. The extension follows a standard Chrome extension architecture with a service worker, popup interface, and options page.

### Core Components

```
tab-cleaner/
├── manifest.json       # Extension configuration and permissions
├── background.js       # Service worker (main logic, tab tracking, cleanup)
├── popup.html/js       # Statistics popup interface
├── options.html/js     # Settings/configuration page with tab monitor
├── icons/              # Extension icons (16px, 32px, 48px, 128px)
└── package.json        # Development dependencies (Prettier)
```

## 🔧 Development Setup

### Prerequisites
- Chrome browser for testing
- Node.js (for development tools)

### Getting Started
```bash
# Clone and navigate to project
git clone https://github.com/whyisjake/tab-cleaner.git
cd tab-cleaner

# Install development dependencies
npm install

# Format code (development)
npm run format
npm run format:check
```

### Loading Extension for Development
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `tab-cleaner` directory
5. Extension will load with a badge showing current tab count

### Testing Changes
- After code changes, click the refresh button on the extension card in `chrome://extensions/`
- Check the browser console and extension service worker console for errors
- Test popup and options pages separately

## 📋 Key Technical Concepts

### 1. Manifest V3 Service Worker Architecture
```javascript
// background.js is a service worker (not persistent background page)
// Must handle being terminated and restarted
// Uses chrome.alarms for scheduled tasks
// Maintains keepalive to prevent premature termination
```

**Key Differences from Manifest V2:**
- Service worker instead of persistent background page
- Must handle termination gracefully
- Uses chrome.storage for persistence
- Alarms API for scheduled tasks

### 2. Tab Activity Tracking System
The extension implements a custom tab activity tracking system:

```javascript
// Core tracking variables in background.js
let tabActivity = {};        // tabId -> last activity timestamp
let tabVisitHistory = {};    // tabId -> last visit timestamp  
let lastActiveTab = null;    // Currently active tab ID
```

**Activity Tracking Events:**
- `chrome.tabs.onActivated` - Tab becomes active
- `chrome.tabs.onUpdated` - Tab content changes/loads
- `chrome.tabs.onCreated` - New tab created
- `chrome.tabs.onRemoved` - Tab closed

**Persistence:**
- Activity data saved to `chrome.storage.local`
- Survives browser restarts and extension reloads
- Estimates activity for tabs that existed before extension install

### 3. Chrome Extension Permissions
```json
"permissions": ["tabs", "storage", "alarms"]
```

- **tabs**: Access tab information, close tabs, track tab events
- **storage**: Persist settings and activity data locally
- **alarms**: Schedule periodic cleanup checks

### 4. Storage Architecture
The extension uses Chrome's storage APIs:

**Sync Storage (`chrome.storage.sync`):**
- User settings/preferences
- Syncs across devices if user is signed in

**Local Storage (`chrome.storage.local`):**
- Tab activity tracking data
- Statistics (tabs removed count, max concurrent tabs)
- Pause state

### 5. Inter-Component Communication
```javascript
// Options/Popup -> Background messaging
chrome.runtime.sendMessage({
  action: 'getTabsData',
  settings: {...}
});

// Background -> Options/Popup responses
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getTabsData') {
    // Handle request and sendResponse()
  }
});
```

## ⚙️ Core Functionality

### 1. Automatic Tab Cleanup (`cleanupInactiveTabs()`)
- Runs on schedule via `chrome.alarms` 
- Checks each tab's last activity timestamp
- Respects protection rules (pinned, audible, active, chrome:// pages)
- Closes tabs exceeding inactive threshold
- Updates statistics after cleanup

### 2. Settings Management
**Default Settings:**
```javascript
{
  inactiveTime: 60,      // minutes (1 hour)
  checkInterval: 5,      // minutes  
  ignorePinned: true,    // protect pinned tabs
  ignoreAudible: true    // protect audio tabs
}
```

**Settings Flow:**
1. User changes settings in options.html
2. options.js saves to chrome.storage.sync
3. Sends message to background.js to update runtime settings
4. Background script updates alarms with new intervals

### 3. Statistics and Badge
- **Badge**: Shows current tab count on extension icon
- **Color coding**: Green (active), Yellow (paused), dynamic based on count
- **Statistics**: Track tabs removed, max concurrent tabs, current counts
- **Reset functionality**: Clear all statistics and activity data

### 4. Pause/Resume Functionality
- Global pause state stored in chrome.storage.local
- When paused: cleanup skipped, badge color changes to yellow
- Can be toggled from popup interface

## 🔍 Debugging and Troubleshooting

### Service Worker Debugging
1. Go to `chrome://extensions/`
2. Find Tab Cleaner extension
3. Click "service worker" link to open DevTools
4. Check console logs and errors

### Common Issues and Solutions

**Service Worker Inactive:**
- Service workers can be terminated by Chrome
- Extension uses keepalive alarms every 4 minutes
- Check if alarms are firing correctly

**Activity Tracking Issues:**
- Verify tab event listeners are properly registered
- Check if tabActivity object is being populated
- Look for storage save/load errors

**Badge Not Updating:**  
- Badge updates are async and can fail
- Extension includes fallback badge logic
- Try manual refresh via popup refresh button

### Extension State Inspection
```javascript
// In service worker console, inspect current state:
console.log('Tab Activity:', tabActivity);
console.log('Settings:', settings);
console.log('Is Paused:', isPaused);

// Check storage
chrome.storage.local.get(null, (data) => console.log('Local Storage:', data));
chrome.storage.sync.get(null, (data) => console.log('Sync Storage:', data));
```

## 🚀 Development Workflows

### Making Changes

**Background Logic Changes:**
1. Edit `background.js`
2. Reload extension in `chrome://extensions/`
3. Check service worker console for errors
4. Test with real tabs

**UI Changes:**
1. Edit HTML/CSS in popup.html or options.html
2. Edit JavaScript in popup.js or options.js
3. Reload extension
4. Open popup/options to test

**Settings Changes:**
1. Update default values in both background.js and options.js
2. Test settings save/load cycle
3. Verify background script receives updates

### Code Formatting
```bash
# Format all files
npm run format

# Check formatting
npm run format:check
```

### Testing Checklist
- [ ] Extension loads without errors
- [ ] Tab activity tracking works (check logs)
- [ ] Cleanup runs on schedule
- [ ] Settings save and apply correctly
- [ ] Badge shows correct tab count
- [ ] Pause/resume functionality works
- [ ] Statistics update correctly
- [ ] Manual tab closing works in options page

## 📝 Code Patterns and Conventions

### Error Handling
```javascript
try {
  // Chrome API calls
  const tabs = await chrome.tabs.query({});
  // Process tabs...
} catch (error) {
  console.error('Error description:', error);
  // Graceful degradation
}
```

### Async/Await Pattern
- Modern async/await used throughout
- Proper error handling with try/catch
- Chrome APIs return Promises in Manifest V3

### Storage Patterns
```javascript
// Save data
await chrome.storage.local.set({ key: value });

// Load data with defaults
const result = await chrome.storage.sync.get({ 
  defaultKey: defaultValue 
});
```

### Message Passing
```javascript
// Send message with response handling
const response = await new Promise(resolve => {
  chrome.runtime.sendMessage(message, resolve);
});
```

## 🔒 Security and Privacy Considerations

- **Local Data Only**: All data stored locally, nothing sent to servers
- **Minimal Permissions**: Only requests necessary permissions
- **Content Security Policy**: Follows Chrome extension CSP requirements
- **Input Validation**: User inputs are validated and sanitized
- **XSS Prevention**: Uses textContent instead of innerHTML where possible

## 📊 Extension Lifecycle

1. **Install**: Initialize settings, create alarms, start tracking existing tabs
2. **Runtime**: Track tab activity, run periodic cleanup, respond to user actions
3. **Update**: Preserve user data, migrate settings if needed
4. **Uninstall**: Chrome automatically cleans up storage and alarms

This document should provide comprehensive guidance for understanding and developing the Tab Cleaner extension architecture and functionality.