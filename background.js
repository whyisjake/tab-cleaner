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

// Track recently closed tabs for recovery
let recentlyClosedTabs = [];

// Pause state
let isPaused = false;

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Tab Cleaner extension installed');
  
  // Load settings and create alarm
  loadSettingsAndCreateAlarm();
  
  // Initialize activity tracking for existing tabs
  initializeExistingTabs();
  
  // Load recently closed tabs
  loadRecentlyClosedTabs();
  
  // Set up keepalive
  setupKeepalive();
  
  // Load pause state
  loadPauseState();
  
  // Update badge with initial tab count
  updateTabCountBadge();
});

// Also initialize on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Tab Cleaner extension started');
  loadSettingsAndCreateAlarm();
  initializeExistingTabs();
  loadRecentlyClosedTabs();
  setupKeepalive();
  loadPauseState();
  updateTabCountBadge();
});

// Keep service worker alive
function setupKeepalive() {
  // Create a keepalive alarm that fires every 4 minutes
  chrome.alarms.create('keepalive', {
    delayInMinutes: 1,
    periodInMinutes: 4
  });
  
  console.log('Keepalive alarm created');
}

// Add immediate response to ensure service worker responds quickly
chrome.runtime.onConnect.addListener((port) => {
  console.log('Port connected:', port.name);
  port.onMessage.addListener((message) => {
    console.log('Port message received:', message);
    if (message.action === 'ping') {
      port.postMessage({ action: 'pong', timestamp: Date.now() });
    }
  });
});

// Load settings from storage and create alarm
function loadSettingsAndCreateAlarm() {
  chrome.storage.sync.get({
    inactiveTime: 60,
    checkInterval: 5,
    ignorePinned: true,
    ignoreAudible: true
  }, function(items) {
    settings = items;
    console.log('Loaded settings:', settings);
    
    // Clear existing alarm and create new one with updated interval
    chrome.alarms.clear('cleanupTabs', () => {
      chrome.alarms.create('cleanupTabs', {
        delayInMinutes: settings.checkInterval,
        periodInMinutes: settings.checkInterval
      });
      console.log('Created alarm with interval:', settings.checkInterval, 'minutes');
    });
  });
}

// Handle messages from options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background script received message:', message);
  
  if (message.action === 'updateSettings') {
    console.log('Updating settings:', message.settings);
    settings = message.settings;
    
    // Update alarm with new interval
    chrome.alarms.clear('cleanupTabs', () => {
      chrome.alarms.create('cleanupTabs', {
        delayInMinutes: settings.checkInterval,
        periodInMinutes: settings.checkInterval
      });
    });
    return false; // No async response needed
  }
  
  if (message.action === 'getTabsData') {
    console.log('Getting tabs data...');
    getTabsDataWithCustomTracking().then(tabsData => {
      console.log('Sending tabs data:', tabsData.length, 'tabs');
      sendResponse({ tabsData: tabsData });
    }).catch(error => {
      console.error('Error getting tabs data:', error);
      sendResponse({ tabsData: [], error: error.message });
    });
    return true; // Keep message channel open for async response
  }
  
  if (message.action === 'updateBadge') {
    console.log('Manual badge update requested');
    updateTabCountBadge();
    return false;
  }
  
  if (message.action === 'getRecentlyClosedTabs') {
    console.log('Getting recently closed tabs...');
    sendResponse({ recentlyClosedTabs: recentlyClosedTabs });
    return false;
  }
  
  if (message.action === 'reopenTab') {
    console.log('Reopening tab:', message.tabId);
    reopenClosedTab(message.tabId).then(newTab => {
      sendResponse({ success: true, newTab: newTab });
    }).catch(error => {
      console.error('Error reopening tab:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  }
  
  if (message.action === 'closeTabWithTracking') {
    console.log('Manually closing tab with tracking:', message.tabId);
    closeTabWithTracking(message.tabId).then(result => {
      sendResponse({ success: true, result: result });
    }).catch(error => {
      console.error('Error closing tab with tracking:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response  
  }
  
  if (message.action === 'pauseStateChanged') {
    console.log('Pause state changed:', message.paused);
    isPaused = message.paused;
    updateIconForPauseState(isPaused);
    return false;
  }
  
  console.log('Unknown message action:', message.action);
  return false; // No response needed for other messages
});

// Get tabs data with activity information
async function getTabsData() {
  try {
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const inactiveThreshold = settings.inactiveTime * 60 * 1000;
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab[0]?.id;

    return tabs.map(tab => {
      // Use stored activity data - don't default to now for display
      const lastActivity = tabActivity[tab.id];
      let inactiveTime, minutesInactive, hoursInactive;
      
      if (lastActivity && lastActivity !== 'newly_discovered') {
        inactiveTime = now - lastActivity;
        minutesInactive = Math.floor(inactiveTime / (1000 * 60));
        hoursInactive = (inactiveTime / (1000 * 60 * 60)).toFixed(1);
      } else {
        // No tracking data available or newly discovered
        inactiveTime = 0;
        minutesInactive = 0;
        hoursInactive = 0;
      }
      
      let status = 'safe';
      let statusText;
      
      // Handle tabs without tracking data or newly discovered tabs
      if (!lastActivity) {
        statusText = 'Not tracked yet';
      } else if (lastActivity === 'newly_discovered') {
        statusText = 'Tracking started';
      } else {
        statusText = `Active ${minutesInactive}m ago`;
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

// Track tab activity with custom system
chrome.tabs.onActivated.addListener((activeInfo) => {
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
  
  // Save activity data
  saveTabActivityToStorage();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    const now = Date.now();
    console.log('Tab updated:', tabId, changeInfo, 'at', new Date(now).toLocaleTimeString());
    
    // Only update activity if this is the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      if (activeTabs.length > 0 && activeTabs[0].id === tabId) {
        tabVisitHistory[tabId] = now;
        tabActivity[tabId] = now;
        console.log('Updated activity for active tab:', tabId);
        // Save activity data
        saveTabActivityToStorage();
      }
    });
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  console.log('Tab created:', tab.id);
  // Initialize activity for new tab
  const now = Date.now();
  tabActivity[tab.id] = now;
  tabVisitHistory[tab.id] = now;
  saveTabActivityToStorage();
  updateTabCountBadge();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('Tab removed:', tabId);
  delete tabActivity[tabId];
  delete tabVisitHistory[tabId];
  
  if (lastActiveTab === tabId) {
    lastActiveTab = null;
  }
  
  saveTabActivityToStorage();
  updateTabCountBadge();
});

// Handle alarm for cleanup and keepalive
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanupTabs') {
    console.log('Running cleanup alarm');
    cleanupInactiveTabs();
  } else if (alarm.name === 'keepalive') {
    console.log('Keepalive alarm fired - service worker staying active');
    // Just logging keeps the service worker active
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
      
      if (lastActivity && lastActivity !== 'newly_discovered') {
        inactiveTime = now - lastActivity;
        minutesInactive = Math.floor(inactiveTime / (1000 * 60));
        hoursInactive = (inactiveTime / (1000 * 60 * 60)).toFixed(1);
        console.log(`Tab ${tab.id} (${tab.title.substring(0, 30)}...): last activity ${new Date(lastActivity).toLocaleTimeString()}, inactive for ${minutesInactive}m`);
      } else {
        // No tracking data available or newly discovered
        inactiveTime = 0;
        minutesInactive = 0;
        hoursInactive = 0;
        if (lastActivity === 'newly_discovered') {
          console.log(`Tab ${tab.id} (${tab.title.substring(0, 30)}...): newly discovered, tracking started`);
        } else {
          console.log(`Tab ${tab.id} (${tab.title.substring(0, 30)}...): no tracking data available`);
        }
      }
      
      let status = 'safe';
      let statusText;
      
      // Handle tabs without tracking data or newly discovered tabs
      if (!lastActivity) {
        statusText = 'Not tracked yet';
      } else if (lastActivity === 'newly_discovered') {
        statusText = 'Tracking started';
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
    
    // Load existing activity data from storage first
    const result = await chrome.storage.local.get(['backgroundTabActivity', 'extensionInstallTime']);
    const savedActivity = result.backgroundTabActivity || {};
    let installTime = result.extensionInstallTime;
    
    // If this is first run, save install time
    if (!installTime) {
      installTime = now;
      await chrome.storage.local.set({ extensionInstallTime: installTime });
      console.log('First extension run - saving install time:', new Date(installTime));
    }
    
    tabs.forEach(tab => {
      if (savedActivity[tab.id]) {
        // Use saved activity if available
        tabActivity[tab.id] = savedActivity[tab.id];
        tabVisitHistory[tab.id] = savedActivity[tab.id];
        console.log(`Tab ${tab.id}: Using saved activity from ${new Date(savedActivity[tab.id]).toLocaleTimeString()}`);
      } else {
        // For unknown tabs, mark them as newly discovered
        // Use a special marker to indicate tracking just started
        tabActivity[tab.id] = 'newly_discovered';
        tabVisitHistory[tab.id] = now; // Use current time for visit history to prevent premature closure
        console.log(`Tab ${tab.id}: Newly discovered tab, tracking started`);
      }
      
      if (activeTab.length > 0 && tab.id === activeTab[0].id) {
        // Current active tab gets current timestamp
        tabActivity[tab.id] = now;
        tabVisitHistory[tab.id] = now;
        lastActiveTab = tab.id;
        console.log('Set active tab:', tab.id, 'to current time');
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

// Save tab activity to storage
async function saveTabActivityToStorage() {
  try {
    await chrome.storage.local.set({
      'backgroundTabActivity': tabActivity,
      'backgroundLastActiveTab': lastActiveTab,
      'backgroundActivityTimestamp': Date.now()
    });
  } catch (error) {
    console.error('Failed to save tab activity:', error);
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
      inactiveTime: (tabActivity[tab.id] && tabActivity[tab.id] !== 'newly_discovered') ? Date.now() - tabActivity[tab.id] : 0
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

// Ensure all current tabs are being tracked
async function ensureAllTabsTracked() {
  try {
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    let newTabsTracked = 0;
    
    // Get install time to properly estimate age of new tabs
    const result = await chrome.storage.local.get(['extensionInstallTime']);
    const installTime = result.extensionInstallTime || now;
    
    tabs.forEach(tab => {
      if (!tabActivity[tab.id]) {
        // New tab discovered - give it current timestamp to prevent premature closure
        // This ensures newly discovered tabs get a fresh start
        const estimatedLastActivity = now;
        tabActivity[tab.id] = estimatedLastActivity;
        tabVisitHistory[tab.id] = estimatedLastActivity;
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
      if (!lastActivity || lastActivity === 'newly_discovered') {
        console.log(`Tab ${tab.id} has no activity data or is newly discovered - skipping`);
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