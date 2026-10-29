// Tab Cleaner Background Service Worker
let tabActivity = {};
let settings = {
  inactiveTime: 60,
  checkInterval: 5,
  ignorePinned: true,
  ignoreAudible: true
};

// Track tab visit/focus events with timestamps
let tabVisitHistory = {};
let lastActiveTab = null;

// Last known URL of each tracked tab. Tab IDs change on every browser
// restart, so URLs are how restored tabs get their saved activity back.
let tabUrls = {};

// Saved activity whose tab ID no longer exists, as [{ url, timestamp }].
// Restored tabs can claim an entry by URL shortly after startup.
let restorePool = [];
let restorePoolExpiresAt = 0;
const RESTORE_WINDOW_MS = 5 * 60 * 1000;

// Track recently closed tabs for recovery
let recentlyClosedTabs = [];

// Pause state
let isPaused = false;

// Service worker state tracking
let isInitialized = false;
let lastKeepalive = Date.now();

// Initialize immediately when service worker starts
console.log('Service worker starting up...');
// Delay initialization slightly to ensure all functions are loaded
setTimeout(() => {
  ensureServiceWorkerInitialized();
}, 100);

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Tab Cleaner extension installed');
  await ensureServiceWorkerInitialized();
});

// Also initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Tab Cleaner extension started');
  await ensureServiceWorkerInitialized();
});

// Enhanced service worker initialization and persistence
// Concurrent callers share one in-flight initialization so a second event
// can't reload stored activity over timestamps the first one just recorded.
let initializationPromise = null;

function ensureServiceWorkerInitialized() {
  if (isInitialized) {
    return Promise.resolve();
  }
  if (!initializationPromise) {
    initializationPromise = initializeServiceWorker().finally(() => {
      initializationPromise = null;
    });
  }
  return initializationPromise;
}

async function initializeServiceWorker() {
  console.log('Initializing service worker...');
  
  // Each loader catches and logs its own errors, so one failing
  // step never stops the rest from running
  await loadTabActivityFromStorage();
  await loadSettingsAndCreateAlarm();
  await loadRecentlyClosedTabs();
  await loadPauseState();
  await initializeExistingTabs();
  
  try {
    setupEnhancedKeepalive();
  } catch (error) {
    console.error('Failed to setup keepalive:', error);
  }
  
  await updateTabCountBadge();
  
  isInitialized = true;
  console.log('Service worker initialization complete');
}

// Enhanced keepalive system
function setupEnhancedKeepalive() {
  // Create multiple alarms for redundancy
  chrome.alarms.create('keepalive-primary', {
    delayInMinutes: 0.5,
    periodInMinutes: 1
  });
  
  chrome.alarms.create('keepalive-backup', {
    delayInMinutes: 1,
    periodInMinutes: 2
  });
  
  console.log('Enhanced keepalive alarms created');
}

// Load tab activity from storage on service worker restart
async function loadTabActivityFromStorage() {
  try {
    const result = await chrome.storage.local.get([
      'backgroundTabActivity',
      'backgroundTabUrls',
      'backgroundLastActiveTab', 
      'backgroundActivityTimestamp'
    ]);
    
    if (result.backgroundTabActivity) {
      // Validate and clean the loaded tab activity data
      const rawActivity = result.backgroundTabActivity;
      tabActivity = {};
      
      Object.entries(rawActivity).forEach(([tabId, timestamp]) => {
        if (typeof timestamp === 'number' && !isNaN(timestamp) && timestamp > 0) {
          tabActivity[tabId] = timestamp;
        } else {
          console.log(`Skipping invalid timestamp for tab ${tabId}: ${timestamp} (type: ${typeof timestamp})`);
        }
      });
      
      console.log(`Restored tab activity for ${Object.keys(tabActivity).length} tabs (filtered from ${Object.keys(rawActivity).length})`);
    }

    if (result.backgroundTabUrls) {
      tabUrls = result.backgroundTabUrls;
    }
    
    if (result.backgroundLastActiveTab) {
      lastActiveTab = result.backgroundLastActiveTab;
    }
    
    // Check how recent the data is
    if (result.backgroundActivityTimestamp) {
      const dataAge = Date.now() - result.backgroundActivityTimestamp;
      console.log(`Tab activity data age: ${Math.floor(dataAge / 1000)}s`);
    }
    
  } catch (error) {
    console.error('Failed to load tab activity from storage:', error);
  }
}

// Add immediate response to ensure service worker responds quickly
chrome.runtime.onConnect.addListener(async (port) => {
  await ensureServiceWorkerInitialized();
  console.log('Port connected:', port.name);
  port.onMessage.addListener(async (message) => {
    console.log('Port message received:', message);
    if (message.action === 'ping') {
      lastKeepalive = Date.now();
      port.postMessage({ action: 'pong', timestamp: Date.now() });
    }
  });
});

// Load settings from storage
async function loadSettings() {
  settings = await chrome.storage.sync.get({
    inactiveTime: 60,
    checkInterval: 5,
    ignorePinned: true,
    ignoreAudible: true
  });
  console.log('Loaded settings:', settings);
}

// Keep in-memory settings in sync with storage
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }
  Object.entries(changes).forEach(([key, { newValue }]) => {
    if (key in settings && newValue !== undefined) {
      settings[key] = newValue;
    }
  });
});

// Load settings from storage and create alarm
async function loadSettingsAndCreateAlarm() {
  try {
    await loadSettings();
    
    // Clear existing alarm and create new one with updated interval
    await chrome.alarms.clear('cleanupTabs');
    chrome.alarms.create('cleanupTabs', {
      delayInMinutes: settings.checkInterval,
      periodInMinutes: settings.checkInterval
    });
    console.log('Created alarm with interval:', settings.checkInterval, 'minutes');
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Simple message handler that works immediately
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background script received message:', message);
  
  // Handle simple messages first without async complexity
  if (message.action === 'ping') {
    console.log('Ping received');
    sendResponse({ pong: true, timestamp: Date.now() });
    return false; // Synchronous response
  }
  
  // Handle async messages
  (async () => {
    try {
      console.log('Processing async message:', message.action);
      
      // Only initialize if needed for complex operations
      if (message.action !== 'updateBadge' && message.action !== 'getRecentlyClosedTabs') {
        console.log('Ensuring service worker is initialized...');
        await ensureServiceWorkerInitialized();
        console.log('Service worker initialization check complete');
      }
      
      if (message.action === 'updateSettings') {
        console.log('Updating settings:', message.settings);
        settings = message.settings;
        
        // Update alarm with new interval
        await chrome.alarms.clear('cleanupTabs');
        chrome.alarms.create('cleanupTabs', {
          delayInMinutes: settings.checkInterval,
          periodInMinutes: settings.checkInterval
        });
        sendResponse({ success: true });
        return;
      }
      
      if (message.action === 'getTabsData') {
        console.log('Getting tabs data...');
        const tabsData = await getTabsDataWithCustomTracking();
        console.log('Sending tabs data:', tabsData.length, 'tabs');
        sendResponse({ tabsData: tabsData });
        return;
      }
      
      if (message.action === 'updateBadge') {
        console.log('Manual badge update requested');
        try {
          const tabs = await chrome.tabs.query({});
          await chrome.action.setBadgeText({ text: tabs.length.toString() });
          sendResponse({ success: true });
        } catch (error) {
          console.error('Badge update error:', error);
          sendResponse({ error: error.message });
        }
        return;
      }
      
      if (message.action === 'getRecentlyClosedTabs') {
        console.log('Getting recently closed tabs...');
        sendResponse({ recentlyClosedTabs: recentlyClosedTabs });
        return;
      }
      
      if (message.action === 'reopenTab') {
        console.log('Reopening tab:', message.tabId);
        const newTab = await reopenClosedTab(message.tabId);
        sendResponse({ success: true, newTab: newTab });
        return;
      }
      
      if (message.action === 'closeTabWithTracking') {
        console.log('Manually closing tab with tracking:', message.tabId);
        const result = await closeTabWithTracking(message.tabId);
        sendResponse({ success: true, result: result });
        return;
      }
      
      if (message.action === 'pauseStateChanged') {
        console.log('Pause state changed:', message.paused);
        isPaused = message.paused;
        sendResponse({ success: true });
        return;
      }
      
      console.log('Unknown message action:', message.action);
      sendResponse({ error: 'Unknown action' });
      
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ error: error.message });
    }
  })();
  
  return true; // Return true for async message handling
});

// Track tab activity with custom system
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await ensureServiceWorkerInitialized();
  
  const now = Date.now();
  console.log('Tab activated:', activeInfo.tabId, 'at', new Date(now).toLocaleTimeString());
  
  // Mark previous tab as inactive
  if (lastActiveTab && lastActiveTab !== activeInfo.tabId) {
    console.log('Previous tab', lastActiveTab, 'became inactive');
  }
  
  // Record visit to new tab
  tabVisitHistory[activeInfo.tabId] = now;
  tabActivity[activeInfo.tabId] = now;
  lastActiveTab = activeInfo.tabId;
  lastKeepalive = now;
  
  // Save activity data
  await saveTabActivityToStorage();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await ensureServiceWorkerInitialized();
    
    const now = Date.now();
    console.log('Tab updated:', tabId, changeInfo, 'at', new Date(now).toLocaleTimeString());
    
    if (changeInfo.url) {
      tabUrls[tabId] = changeInfo.url;
    }
    
    // Only update activity if this is the active tab
    try {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTabs.length > 0 && activeTabs[0].id === tabId) {
        tabVisitHistory[tabId] = now;
        tabActivity[tabId] = now;
        lastKeepalive = now;
        console.log('Updated activity for active tab:', tabId);
        // Save activity data
        await saveTabActivityToStorage();
      } else if (changeInfo.url) {
        await saveTabActivityToStorage();
      }
    } catch (error) {
      console.error('Error updating tab activity:', error);
    }
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureServiceWorkerInitialized();
  
  console.log('Tab created:', tab.id);
  // Session restore creates tabs too; those get their saved activity back
  const now = Date.now();
  const activity = claimRestoredActivity(tabUrl(tab)) ?? now;
  tabActivity[tab.id] = activity;
  tabVisitHistory[tab.id] = activity;
  rememberTabUrl(tab);
  lastKeepalive = now;
  await saveTabActivityToStorage();
  await updateTabCountBadge();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureServiceWorkerInitialized();
  
  console.log('Tab removed:', tabId);
  delete tabActivity[tabId];
  delete tabVisitHistory[tabId];
  delete tabUrls[tabId];
  
  if (lastActiveTab === tabId) {
    lastActiveTab = null;
  }
  
  lastKeepalive = Date.now();
  await saveTabActivityToStorage();
  await updateTabCountBadge();
});

// Handle alarm for cleanup and keepalive
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanupTabs') {
    console.log('Running cleanup alarm');
    await ensureServiceWorkerInitialized();
    await cleanupInactiveTabs();
  } else if (alarm.name.startsWith('keepalive')) {
    const now = Date.now();
    console.log(`${alarm.name} fired - service worker staying active`);
    lastKeepalive = now;
    
    // Ensure we're initialized
    await ensureServiceWorkerInitialized();
    
    // Periodically save current state to prevent data loss
    await saveTabActivityToStorage();
  }
});

// Get tabs data with custom tracking system
async function getTabsDataWithCustomTracking() {
  try {
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const inactiveThreshold = settings.inactiveTime * 60 * 1000;
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab[0]?.id;

    console.log('Current tab activity state:', tabActivity);
    console.log('Current tab visit history:', tabVisitHistory);

    return tabs.map(tab => {
      // Use our custom tracking data - don't default to now for display
      const lastActivity = tabActivity[tab.id];
      let inactiveTime, minutesInactive, hoursInactive;
      
      if (lastActivity && typeof lastActivity === 'number') {
        inactiveTime = now - lastActivity;
        minutesInactive = Math.floor(inactiveTime / (1000 * 60));
        hoursInactive = (inactiveTime / (1000 * 60 * 60)).toFixed(1);
        console.log(`Tab ${tab.id} (${tab.title.substring(0, 30)}...): last activity ${new Date(lastActivity).toLocaleTimeString()}, inactive for ${minutesInactive}m`);
      } else {
        // No tracking data available or invalid data
        inactiveTime = 0;
        minutesInactive = 0;
        hoursInactive = 0;
        console.log(`Tab ${tab.id} (${tab.title.substring(0, 30)}...): no tracking data available`);
      }
      
      let status = 'safe';
      let statusText;
      
      // Handle tabs without tracking data
      if (!lastActivity) {
        statusText = 'Not tracked yet';
      } else {
        // Format time display - switch to hours after 120 minutes
        if (minutesInactive >= 120) {
          statusText = `Active ${hoursInactive}h ago`;
        } else {
          statusText = `Active ${minutesInactive}m ago`;
        }
      }
      
      if (tab.id === activeTabId) {
        status = 'safe';
        statusText = 'Currently Active';
      } else if (lastActivity && inactiveTime > inactiveThreshold * 0.8) {
        status = 'danger';
        statusText = `Will close soon (${hoursInactive}h inactive)`;
      } else if (lastActivity && inactiveTime > inactiveThreshold * 0.5) {
        status = 'warning';
        statusText = `${hoursInactive}h inactive`;
      }
      
      // Check if tab would be protected
      let protected = false;
      let protectedReason = '';
      
      if (tab.url.startsWith('chrome://')) {
        protected = true;
        protectedReason = 'Chrome page';
      } else if (settings.ignorePinned && tab.pinned) {
        protected = true;
        protectedReason = 'Pinned';
      } else if (settings.ignoreAudible && tab.audible) {
        protected = true;
        protectedReason = 'Playing audio';
      }
      
      if (protected) {
        status = 'safe';
        statusText = `Protected (${protectedReason})`;
      }

      return {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        status: status,
        statusText: statusText,
        inactiveTime: inactiveTime,
        minutesInactive: minutesInactive,
        hoursInactive: hoursInactive,
        protected: protected,
        protectedReason: protectedReason,
        pinned: tab.pinned,
        audible: tab.audible,
        active: tab.id === activeTabId
      };
    }).sort((a, b) => {
      // Sort by status priority, then by inactive time
      const statusOrder = { danger: 0, warning: 1, safe: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return b.inactiveTime - a.inactiveTime;
    });
  } catch (error) {
    console.error('Error getting tabs data:', error);
    return [];
  }
}

// Initialize activity tracking for existing tabs
async function initializeExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const now = Date.now();
    
    console.log('Initializing activity tracking for', tabs.length, 'existing tabs');
    
    // Record install time on first run
    const result = await chrome.storage.local.get(['extensionInstallTime']);
    if (!result.extensionInstallTime) {
      await chrome.storage.local.set({ extensionInstallTime: now });
      console.log('First extension run - saving install time:', new Date(now));
    }
    
    fillRestorePool(tabs, now);
    
    tabs.forEach(tab => {
      rememberTabUrl(tab);
      
      if (activeTab.length > 0 && tab.id === activeTab[0].id) {
        // Current active tab gets current timestamp, leaving any saved entry
        // for its URL to another restored tab
        tabActivity[tab.id] = now;
        tabVisitHistory[tab.id] = now;
        lastActiveTab = tab.id;
        console.log('Set active tab:', tab.id, 'to current time');
      } else if (tabActivity[tab.id]) {
        // Use the validated activity data that was already loaded
        tabVisitHistory[tab.id] = tabActivity[tab.id];
        console.log(`Tab ${tab.id}: Using saved activity from ${new Date(tabActivity[tab.id]).toLocaleTimeString()}`);
      } else {
        // A restored tab gets the activity saved under its old ID. Anything
        // else starts its clock now rather than being backdated.
        const activity = claimRestoredActivity(tabUrl(tab)) ?? now;
        tabActivity[tab.id] = activity;
        tabVisitHistory[tab.id] = activity;
        console.log(`Tab ${tab.id}: Tracking from ${new Date(activity).toLocaleTimeString()}`);
      }
    });
    
    // Save the initialized activity data
    await saveTabActivityToStorage();
    
    console.log('Initialized tab activity for', Object.keys(tabActivity).length, 'tabs');
    console.log('Activity summary:', Object.entries(tabActivity).map(([id, time]) => 
      `${id}: ${Math.floor((now - time) / (60 * 1000))}m ago`
    ).slice(0, 5));
  } catch (error) {
    console.error('Error initializing existing tabs:', error);
  }
}

function tabUrl(tab) {
  return tab.url || tab.pendingUrl;
}

function rememberTabUrl(tab) {
  const url = tabUrl(tab);
  if (url) {
    tabUrls[tab.id] = url;
  }
}

// Move saved activity for tab IDs that no longer exist into the restore pool
function fillRestorePool(tabs, now) {
  const existingTabIds = new Set(tabs.map(tab => String(tab.id)));
  restorePool = [];
  Object.keys(tabActivity).forEach(tabId => {
    if (existingTabIds.has(tabId)) {
      return;
    }
    if (tabUrls[tabId]) {
      restorePool.push({ url: tabUrls[tabId], timestamp: tabActivity[tabId] });
    }
    delete tabActivity[tabId];
    delete tabVisitHistory[tabId];
    delete tabUrls[tabId];
  });
  // Most recent first, so duplicate URLs never inherit more idle time than they had
  restorePool.sort((a, b) => b.timestamp - a.timestamp);
  restorePoolExpiresAt = now + RESTORE_WINDOW_MS;
  console.log(`Restore pool holds ${restorePool.length} saved tabs`);
}

// Saved activity for a restored tab with this URL, or undefined
function claimRestoredActivity(url) {
  if (!url || Date.now() > restorePoolExpiresAt) {
    return undefined;
  }
  const index = restorePool.findIndex(entry => entry.url === url);
  if (index === -1) {
    return undefined;
  }
  return restorePool.splice(index, 1)[0].timestamp;
}

// Save tab activity to storage with enhanced error handling
async function saveTabActivityToStorage() {
  try {
    const dataToSave = {
      'backgroundTabActivity': tabActivity,
      'backgroundTabUrls': tabUrls,
      'backgroundLastActiveTab': lastActiveTab,
      'backgroundActivityTimestamp': Date.now(),
      'backgroundKeepaliveTimestamp': lastKeepalive
    };
    
    await chrome.storage.local.set(dataToSave);
    console.log(`Saved activity data for ${Object.keys(tabActivity).length} tabs`);
  } catch (error) {
    console.error('Failed to save tab activity:', error);
    // Try a backup save with minimal data
    try {
      await chrome.storage.local.set({
        'backgroundTabActivity': tabActivity,
        'backgroundActivityTimestamp': Date.now()
      });
      console.log('Backup save successful');
    } catch (backupError) {
      console.error('Backup save also failed:', backupError);
    }
  }
}

// Add tab to recently closed list
async function addToRecentlyClosedTabs(tab, reason = 'auto-closed') {
  try {
    const closedTabInfo = {
      id: `closed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId,
      closedAt: Date.now(),
      reason: reason,
      inactiveTime: tabActivity[tab.id] ? Date.now() - tabActivity[tab.id] : 0
    };

    recentlyClosedTabs.unshift(closedTabInfo);
    
    // Keep only last 50 closed tabs
    if (recentlyClosedTabs.length > 50) {
      recentlyClosedTabs = recentlyClosedTabs.slice(0, 50);
    }
    
    // Remove tabs older than 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    recentlyClosedTabs = recentlyClosedTabs.filter(tab => tab.closedAt > sevenDaysAgo);
    
    // Save to storage
    await chrome.storage.local.set({
      'recentlyClosedTabs': recentlyClosedTabs
    });
    
    console.log(`Added tab to recently closed: ${tab.title}`);
  } catch (error) {
    console.error('Error saving recently closed tab:', error);
  }
}

// Load recently closed tabs from storage
async function loadRecentlyClosedTabs() {
  try {
    const result = await chrome.storage.local.get(['recentlyClosedTabs']);
    if (result.recentlyClosedTabs) {
      recentlyClosedTabs = result.recentlyClosedTabs;
      console.log(`Loaded ${recentlyClosedTabs.length} recently closed tabs`);
    }
  } catch (error) {
    console.error('Error loading recently closed tabs:', error);
  }
}

// Reopen a recently closed tab
async function reopenClosedTab(closedTabId) {
  try {
    const tabIndex = recentlyClosedTabs.findIndex(tab => tab.id === closedTabId);
    if (tabIndex === -1) {
      throw new Error('Tab not found in recently closed list');
    }
    
    const closedTab = recentlyClosedTabs[tabIndex];
    
    // Create new tab
    const newTab = await chrome.tabs.create({
      url: closedTab.url,
      windowId: closedTab.windowId
    });
    
    // Initialize activity for the reopened tab
    tabActivity[newTab.id] = Date.now();
    tabVisitHistory[newTab.id] = Date.now();
    rememberTabUrl(newTab);
    
    // Remove from recently closed list
    recentlyClosedTabs.splice(tabIndex, 1);
    await chrome.storage.local.set({
      'recentlyClosedTabs': recentlyClosedTabs
    });
    
    await saveTabActivityToStorage();
    
    console.log(`Reopened tab: ${closedTab.title}`);
    return newTab;
  } catch (error) {
    console.error('Error reopening tab:', error);
    throw error;
  }
}

// Close a tab with tracking (for manual closes from options page)
async function closeTabWithTracking(tabId) {
  try {
    // Get tab info before closing
    const tab = await chrome.tabs.get(tabId);
    
    // Save tab info to recently closed
    await addToRecentlyClosedTabs(tab, 'manually-closed');
    
    // Close the tab
    await chrome.tabs.remove(tabId);
    
    // Clean up tracking data
    delete tabActivity[tabId];
    delete tabVisitHistory[tabId];
    delete tabUrls[tabId];
    
    if (lastActiveTab === tabId) {
      lastActiveTab = null;
    }
    
    await saveTabActivityToStorage();
    
    console.log(`Manually closed tab with tracking: ${tab.title}`);
    return { tabId, title: tab.title };
  } catch (error) {
    console.error('Error closing tab with tracking:', error);
    throw error;
  }
}

// Add window focus tracking for better activity detection
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    console.log('All windows lost focus');
    return;
  }
  
  await ensureServiceWorkerInitialized();
  
  try {
    const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tabs.length > 0) {
      const now = Date.now();
      const tabId = tabs[0].id;
      tabActivity[tabId] = now;
      tabVisitHistory[tabId] = now;
      lastActiveTab = tabId;
      lastKeepalive = now;
      console.log('Window focus changed - updated activity for tab:', tabId);
      await saveTabActivityToStorage();
    }
  } catch (error) {
    console.error('Error handling window focus change:', error);
  }
});

// Ensure all current tabs are being tracked
async function ensureAllTabsTracked() {
  try {
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    let newTabsTracked = 0;
    
    tabs.forEach(tab => {
      if (!tabActivity[tab.id]) {
        // New tab discovered - give it current timestamp to prevent premature closure
        // This ensures newly discovered tabs get a fresh start
        const estimatedLastActivity = now;
        tabActivity[tab.id] = estimatedLastActivity;
        tabVisitHistory[tab.id] = estimatedLastActivity;
        rememberTabUrl(tab);
        newTabsTracked++;
        console.log(`Started tracking tab ${tab.id}, estimated last activity: ${new Date(estimatedLastActivity).toLocaleTimeString()}`);
      }
    });
    
    if (newTabsTracked > 0) {
      console.log(`Started tracking ${newTabsTracked} previously untracked tabs`);
      await saveTabActivityToStorage();
    }
    
    // Clean up tracking data for tabs that no longer exist
    const existingTabIds = new Set(tabs.map(tab => tab.id));
    const trackedTabIds = Object.keys(tabActivity).map(Number);
    let removedTracking = 0;
    
    trackedTabIds.forEach(tabId => {
      if (!existingTabIds.has(tabId)) {
        delete tabActivity[tabId];
        delete tabVisitHistory[tabId];
        delete tabUrls[tabId];
        removedTracking++;
      }
    });
    
    if (removedTracking > 0) {
      console.log(`Cleaned up tracking for ${removedTracking} non-existent tabs`);
      await saveTabActivityToStorage();
    }
    
  } catch (error) {
    console.error('Error ensuring tabs are tracked:', error);
  }
}

// Main cleanup function
async function cleanupInactiveTabs() {
  try {
    // Check if cleaning is paused
    if (isPaused) {
      console.log('Cleanup skipped - cleaning is paused');
      return;
    }
    // Read settings fresh every run: the service worker may have been
    // restarted since they were last loaded, leaving only the defaults
    await loadSettings();
    
    // First ensure all tabs are being tracked
    await ensureAllTabsTracked();
    
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab[0]?.id;
    const inactiveThreshold = settings.inactiveTime * 60 * 1000; // settings.inactiveTime is in minutes
    let tabsClosedThisRun = 0;

    console.log(`Running cleanup - checking ${tabs.length} tabs against ${settings.inactiveTime}min threshold`);
    console.log(`Currently tracking ${Object.keys(tabActivity).length} tabs`);

    for (const tab of tabs) {
      // Skip based on settings
      if (tab.id === activeTabId || tab.url.startsWith('chrome://')) {
        continue;
      }
      
      if (settings.ignorePinned && tab.pinned) {
        continue;
      }
      
      if (settings.ignoreAudible && tab.audible) {
        continue;
      }

      const lastActivity = tabActivity[tab.id];
      if (!lastActivity) {
        console.log(`Tab ${tab.id} has no activity data - skipping`);
        continue;
      }
      
      const inactiveTime = now - lastActivity;
      const inactiveMinutes = Math.floor(inactiveTime / (60 * 1000));

      if (inactiveTime > inactiveThreshold) {
        try {
          console.log(`Closing tab: ${tab.title} (${inactiveMinutes}min inactive)`);
          
          // Save tab info before closing
          await addToRecentlyClosedTabs(tab, 'auto-closed');
          
          await chrome.tabs.remove(tab.id);
          delete tabActivity[tab.id];
          delete tabVisitHistory[tab.id];
          delete tabUrls[tab.id];
          tabsClosedThisRun++;
        } catch (error) {
          console.error(`Error closing tab ${tab.id}:`, error);
        }
      }
    }
    
    // Update statistics if any tabs were closed
    if (tabsClosedThisRun > 0) {
      console.log(`Closed ${tabsClosedThisRun} inactive tabs`);
      await incrementTabsRemovedCount(tabsClosedThisRun);
      await saveTabActivityToStorage();
    } else {
      console.log('No tabs needed to be closed');
    }
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Increment the count of tabs removed
async function incrementTabsRemovedCount(count = 1) {
  try {
    const result = await chrome.storage.local.get(['tabsRemovedCount']);
    const currentCount = result.tabsRemovedCount || 0;
    const newCount = currentCount + count;
    
    await chrome.storage.local.set({
      tabsRemovedCount: newCount
    });
    
    console.log(`Updated tabs removed count: ${newCount} (added ${count})`);
    
    // Update badge after closing tabs
    updateTabCountBadge();
  } catch (error) {
    console.error('Error updating tabs removed count:', error);
  }
}

// Update the badge with current tab count
async function updateTabCountBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const tabCount = tabs.length;
    
    console.log(`Attempting to update badge with ${tabCount} tabs`);
    
    // Set badge text
    await chrome.action.setBadgeText({
      text: tabCount.toString()
    });
    
    // Set badge color based on pause state and tab count
    let badgeColor;
    if (isPaused) {
      badgeColor = '#ffc107'; // Yellow for paused
    } else {
      badgeColor = '#4CAF50'; // Green for normal count
      if (tabCount > 50) {
        badgeColor = '#FF9800'; // Orange for high count
      }
      if (tabCount > 100) {
        badgeColor = '#F44336'; // Red for very high count
      }
    }
    
    await chrome.action.setBadgeBackgroundColor({
      color: badgeColor
    });
    
    console.log(`Badge color set to ${badgeColor} (paused: ${isPaused})`);
    console.log(`Successfully updated badge: ${tabCount} tabs with color ${badgeColor}`);
    
  } catch (error) {
    console.error('Error updating badge:', error);
    
    // Try a fallback approach
    try {
      chrome.action.setBadgeText({ text: '?' });
      console.log('Set fallback badge');
    } catch (fallbackError) {
      console.error('Fallback badge update also failed:', fallbackError);
    }
  }
}

// Load pause state from storage
async function loadPauseState() {
  try {
    const result = await chrome.storage.local.get(['cleaningPaused']);
    isPaused = result.cleaningPaused || false;
    updateIconForPauseState(isPaused);
    console.log('Loaded pause state:', isPaused);
  } catch (error) {
    console.error('Error loading pause state:', error);
  }
}

// Update icon based on pause state
function updateIconForPauseState(paused) {
  try {
    const iconPath = paused
      ? {
          16: 'icons/icon16.png',
          32: 'icons/icon32.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png'
        }
      : {
          16: 'icons/icon16.png',
          32: 'icons/icon32.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png'
        };

    // For now, we'll use the same icons but with different badge color
    // In the future, you could create grayscale versions for paused state
    chrome.action.setIcon({ path: iconPath });

    // Update badge to reflect pause state
    updateTabCountBadge();

    console.log(`Icon updated for ${paused ? 'paused' : 'active'} state`);
  } catch (error) {
    console.error('Error updating icon:', error);
  }
}