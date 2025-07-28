// Tab Cleaner Background Service Worker
let tabActivity = {};
let settings = {
  inactiveTime: 60,
  checkInterval: 5,
  ignorePinned: true,
  ignoreAudible: true,
};

// Pause state
let isPaused = false;

// Track tab visit/focus events with timestamps
let tabVisitHistory = {};
let lastActiveTab = null;

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Tab Cleaner extension installed');

  // Load settings and create alarm
  loadSettingsAndCreateAlarm();

  // Initialize activity tracking for existing tabs
  initializeExistingTabs();

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
  setupKeepalive();
  loadPauseState();
  updateTabCountBadge();
});

// Keep service worker alive
function setupKeepalive() {
  // Create a keepalive alarm that fires every 4 minutes
  chrome.alarms.create('keepalive', {
    delayInMinutes: 1,
    periodInMinutes: 4,
  });

  console.log('Keepalive alarm created');
}

// Add immediate response to ensure service worker responds quickly
chrome.runtime.onConnect.addListener(port => {
  console.log('Port connected:', port.name);
  port.onMessage.addListener(message => {
    console.log('Port message received:', message);
    if (message.action === 'ping') {
      port.postMessage({ action: 'pong', timestamp: Date.now() });
    }
  });
});

// Load settings from storage and create alarm
function loadSettingsAndCreateAlarm() {
  chrome.storage.sync.get(
    {
      inactiveTime: 60,
      checkInterval: 5,
      ignorePinned: true,
      ignoreAudible: true,
    },
    function (items) {
      settings = items;
      console.log('Loaded settings:', settings);

      // Clear existing alarm and create new one with updated interval
      chrome.alarms.clear('cleanupTabs', () => {
        chrome.alarms.create('cleanupTabs', {
          delayInMinutes: settings.checkInterval,
          periodInMinutes: settings.checkInterval,
        });
        console.log(
          'Created alarm with interval:',
          settings.checkInterval,
          'minutes'
        );
      });
    }
  );
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
        periodInMinutes: settings.checkInterval,
      });
    });
    return false; // No async response needed
  }

  if (message.action === 'getTabsData') {
    console.log('Getting tabs data...');
    getTabsDataWithCustomTracking()
      .then(tabsData => {
        console.log('Sending tabs data:', tabsData.length, 'tabs');
        sendResponse({ tabsData: tabsData });
      })
      .catch(error => {
        console.error('Error getting tabs data:', error);
        sendResponse({ tabsData: [], error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.action === 'pauseStateChanged') {
    console.log('Pause state changed:', message.paused);
    isPaused = message.paused;
    updateIconForPauseState(isPaused);
    return false;
  }

  if (message.action === 'updateBadge') {
    console.log('Manual badge update requested');
    updateTabCountBadge();
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
    const activeTab = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeTabId = activeTab[0]?.id;

    return tabs
      .map(tab => {
        const lastActivity = tabActivity[tab.id] || now;
        const inactiveTime = now - lastActivity;
        const minutesInactive = Math.floor(inactiveTime / (1000 * 60));
        const hoursInactive = (inactiveTime / (1000 * 60 * 60)).toFixed(1);

        let status = 'safe';
        let statusText = `Active ${minutesInactive}m ago`;

        if (tab.id === activeTabId) {
          status = 'safe';
          statusText = 'Currently Active';
        } else if (inactiveTime > inactiveThreshold * 0.8) {
          status = 'danger';
          statusText = `Will close soon (${hoursInactive}h inactive)`;
        } else if (inactiveTime > inactiveThreshold * 0.5) {
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
          active: tab.id === activeTabId,
        };
      })
      .sort((a, b) => {
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
chrome.tabs.onActivated.addListener(activeInfo => {
  const now = Date.now();
  console.log(
    'Tab activated:',
    activeInfo.tabId,
    'at',
    new Date(now).toLocaleTimeString()
  );

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
    console.log(
      'Tab updated:',
      tabId,
      changeInfo,
      'at',
      new Date(now).toLocaleTimeString()
    );

    // Only update activity if this is the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
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

chrome.tabs.onCreated.addListener(tab => {
  console.log('Tab created:', tab.id);
  // Initialize activity for new tab
  const now = Date.now();
  tabActivity[tab.id] = now;
  tabVisitHistory[tab.id] = now;
  saveTabActivityToStorage();
  updateTabCountBadge();
});

chrome.tabs.onRemoved.addListener(tabId => {
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
chrome.alarms.onAlarm.addListener(alarm => {
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
    const activeTab = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeTabId = activeTab[0]?.id;

    console.log('Current tab activity state:', tabActivity);
    console.log('Current tab visit history:', tabVisitHistory);

    return tabs
      .map(tab => {
        // Use our custom tracking data
        const lastActivity = tabActivity[tab.id] || now;
        const inactiveTime = now - lastActivity;
        const minutesInactive = Math.floor(inactiveTime / (1000 * 60));
        const hoursInactive = (inactiveTime / (1000 * 60 * 60)).toFixed(1);

        console.log(
          `Tab ${tab.id} (${tab.title.substring(
            0,
            30
          )}...): last activity ${new Date(
            lastActivity
          ).toLocaleTimeString()}, inactive for ${minutesInactive}m`
        );

        let status = 'safe';
        let statusText = `Active ${minutesInactive}m ago`;

        if (tab.id === activeTabId) {
          status = 'safe';
          statusText = 'Currently Active';
        } else if (inactiveTime > inactiveThreshold * 0.8) {
          status = 'danger';
          statusText = `Will close soon (${hoursInactive}h inactive)`;
        } else if (inactiveTime > inactiveThreshold * 0.5) {
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
          active: tab.id === activeTabId,
        };
      })
      .sort((a, b) => {
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
    const activeTab = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const now = Date.now();

    console.log(
      'Initializing activity tracking for',
      tabs.length,
      'existing tabs'
    );

    // Load existing activity data from storage first
    const result = await chrome.storage.local.get([
      'backgroundTabActivity',
      'extensionInstallTime',
    ]);
    const savedActivity = result.backgroundTabActivity || {};
    let installTime = result.extensionInstallTime;

    // If this is first run, save install time
    if (!installTime) {
      installTime = now;
      await chrome.storage.local.set({ extensionInstallTime: installTime });
      console.log(
        'First extension run - saving install time:',
        new Date(installTime)
      );
    }

    tabs.forEach(tab => {
      if (savedActivity[tab.id]) {
        // Use saved activity if available
        tabActivity[tab.id] = savedActivity[tab.id];
        tabVisitHistory[tab.id] = savedActivity[tab.id];
        console.log(
          `Tab ${tab.id}: Using saved activity from ${new Date(
            savedActivity[tab.id]
          ).toLocaleTimeString()}`
        );
      } else {
        // For unknown tabs, estimate age based on when extension was installed
        // Assume tabs existed before install, so set their last activity to install time
        // This allows them to accumulate inactivity time naturally
        const estimatedLastActivity = Math.min(
          installTime,
          now - 5 * 60 * 1000
        ); // At least 5 minutes ago
        tabActivity[tab.id] = estimatedLastActivity;
        tabVisitHistory[tab.id] = estimatedLastActivity;
        console.log(
          `Tab ${tab.id}: New tab, estimated last activity ${new Date(
            estimatedLastActivity
          ).toLocaleTimeString()}`
        );
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

    console.log(
      'Initialized tab activity for',
      Object.keys(tabActivity).length,
      'tabs'
    );
    console.log(
      'Activity summary:',
      Object.entries(tabActivity)
        .map(
          ([id, time]) =>
            `${id}: ${Math.floor((now - time) / (60 * 1000))}m ago`
        )
        .slice(0, 5)
    );
  } catch (error) {
    console.error('Error initializing existing tabs:', error);
  }
}

// Save tab activity to storage
async function saveTabActivityToStorage() {
  try {
    await chrome.storage.local.set({
      backgroundTabActivity: tabActivity,
      backgroundLastActiveTab: lastActiveTab,
      backgroundActivityTimestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to save tab activity:', error);
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
        // New tab discovered - estimate its age
        // Use install time as baseline, but allow for some pre-existing age
        const estimatedLastActivity = Math.min(
          installTime,
          now - 10 * 60 * 1000
        ); // At least 10 minutes ago
        tabActivity[tab.id] = estimatedLastActivity;
        tabVisitHistory[tab.id] = estimatedLastActivity;
        newTabsTracked++;
        console.log(
          `Started tracking tab ${tab.id}, estimated last activity: ${new Date(
            estimatedLastActivity
          ).toLocaleTimeString()}`
        );
      }
    });

    if (newTabsTracked > 0) {
      console.log(
        `Started tracking ${newTabsTracked} previously untracked tabs`
      );
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
      console.log(
        `Cleaned up tracking for ${removedTracking} non-existent tabs`
      );
      await saveTabActivityToStorage();
    }
  } catch (error) {
    console.error('Error ensuring tabs are tracked:', error);
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
          128: 'icons/icon128.png',
        }
      : {
          16: 'icons/icon16.png',
          32: 'icons/icon32.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png',
        };

    // For now, we'll use the same icons but with different badge color
    // In the future, you could create grayscale versions for paused state
    chrome.action.setIcon({ path: iconPath });

    // Update badge color by calling updateTabCountBadge which handles color logic
    updateTabCountBadge();

    console.log(`Icon updated for ${paused ? 'paused' : 'active'} state`);
  } catch (error) {
    console.error('Error updating icon:', error);
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
    const activeTab = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeTabId = activeTab[0]?.id;
    const inactiveThreshold = settings.inactiveTime * 60 * 1000; // settings.inactiveTime is in minutes
    let tabsClosedThisRun = 0;

    console.log(
      `Running cleanup - checking ${tabs.length} tabs against ${settings.inactiveTime}min threshold`
    );
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
          console.log(
            `Closing tab: ${tab.title} (${inactiveMinutes}min inactive)`
          );
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
      tabsRemovedCount: newCount,
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
      text: tabCount.toString(),
    });

    // Set badge color based on pause state
    const badgeColor = isPaused ? '#ffc107' : '#28a745'; // Yellow for paused, green for active

    await chrome.action.setBadgeBackgroundColor({
      color: badgeColor,
    });

    console.log(`Badge color set to ${badgeColor} (paused: ${isPaused})`);

    console.log(
      `Successfully updated badge: ${tabCount} tabs with color ${badgeColor}`
    );
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
