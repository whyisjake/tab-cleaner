// Load saved settings on page load
document.addEventListener('DOMContentLoaded', function() {
    loadSettings();

    // Add refresh button event listener
    document.getElementById('refreshBtn').addEventListener('click', refreshTabsList);

    // Add save button event listener
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
});

function loadSettings() {
    chrome.storage.sync.get({
        inactiveTime: 30,
        checkInterval: 5,
        ignorePinned: true,
        ignoreAudible: true
    }, function(items) {
        console.log('Loaded settings:', items);
        const hoursValue = items.inactiveTime / 60;
        // Remove trailing zeros and decimal point if it's a whole number
        document.getElementById('inactiveTime').value = hoursValue % 1 === 0 ? hoursValue.toString() : hoursValue.toFixed(1);
        document.getElementById('checkInterval').value = items.checkInterval;
        document.getElementById('ignorePinned').checked = items.ignorePinned;
        document.getElementById('ignoreAudible').checked = items.ignoreAudible;
    });
}

// Save settings
function saveSettings() {
    const inactiveTimeHours = parseFloat(document.getElementById('inactiveTime').value);
    const inactiveTimeMinutes = Math.round(inactiveTimeHours * 60); // Convert hours to minutes
    const checkInterval = parseInt(document.getElementById('checkInterval').value);
    const ignorePinned = document.getElementById('ignorePinned').checked;
    const ignoreAudible = document.getElementById('ignoreAudible').checked;

    console.log('Saving settings:', {
        inactiveTime: inactiveTimeMinutes,
        checkInterval: checkInterval,
        ignorePinned: ignorePinned,
        ignoreAudible: ignoreAudible
    });

    chrome.storage.sync.set({
        inactiveTime: inactiveTimeMinutes,
        checkInterval: checkInterval,
        ignorePinned: ignorePinned,
        ignoreAudible: ignoreAudible
    }, function() {
        console.log('Settings saved successfully');

        // Update alarm with new interval
        chrome.runtime.sendMessage({
            action: 'updateSettings',
            settings: {
                inactiveTime: inactiveTimeMinutes,
                checkInterval: checkInterval,
                ignorePinned: ignorePinned,
                ignoreAudible: ignoreAudible
            }
        }, function(response) {
            console.log('Message sent to background script');
        });

        const status = document.getElementById('status');
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    });
}

// Try to wake up service worker using port connection
async function wakeUpServiceWorkerWithPort() {
    return new Promise((resolve) => {
        try {
            const port = chrome.runtime.connect({ name: 'wakeup' });
            
            const timeout = setTimeout(() => {
                port.disconnect();
                console.log('Port wake-up timeout');
                resolve(false);
            }, 2000);
            
            port.onMessage.addListener((message) => {
                clearTimeout(timeout);
                if (message.action === 'pong') {
                    console.log('Service worker responded via port');
                    port.disconnect();
                    resolve(true);
                }
            });
            
            port.postMessage({ action: 'ping' });
            
        } catch (error) {
            console.error('Port wake-up failed:', error);
            resolve(false);
        }
    });
}

// Wake up service worker by triggering a Chrome API call
async function wakeUpServiceWorker() {
    try {
        // Try port method first
        const portSuccess = await wakeUpServiceWorkerWithPort();
        if (portSuccess) {
            return true;
        }
        
        // Fallback to API call
        await chrome.runtime.getPlatformInfo();
        console.log('Service worker wake-up call completed');
        return true;
    } catch (error) {
        console.error('Failed to wake up service worker:', error);
        return false;
    }
}

// Self-contained tab activity tracker
let localTabActivity = {};
let localLastActiveTab = null;
let activityTrackingInitialized = false;

// Save tab activity to storage
async function saveTabActivity() {
    try {
        await chrome.storage.local.set({
            'optionsTabActivity': localTabActivity,
            'optionsLastActiveTab': localLastActiveTab,
            'optionsActivityTimestamp': Date.now()
        });
        console.log('Saved tab activity to storage');
    } catch (error) {
        console.error('Failed to save tab activity:', error);
    }
}

// Load tab activity from storage
async function loadTabActivity() {
    try {
        const result = await chrome.storage.local.get([
            'optionsTabActivity', 
            'optionsLastActiveTab', 
            'optionsActivityTimestamp'
        ]);
        
        if (result.optionsTabActivity) {
            localTabActivity = result.optionsTabActivity;
            localLastActiveTab = result.optionsLastActiveTab;
            
            const savedTimestamp = result.optionsActivityTimestamp || 0;
            const now = Date.now();
            const timeSinceSave = now - savedTimestamp;
            
            console.log(`Loaded tab activity from storage (${Math.floor(timeSinceSave / 1000)}s ago):`, localTabActivity);
            
            // Clean up very old data (older than 7 days)
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            Object.keys(localTabActivity).forEach(tabId => {
                if (now - localTabActivity[tabId] > maxAge) {
                    delete localTabActivity[tabId];
                }
            });
            
            return true;
        } else {
            console.log('No saved tab activity found, starting fresh');
            return false;
        }
    } catch (error) {
        console.error('Failed to load tab activity:', error);
        return false;
    }
}

// Initialize local activity tracking
async function initializeLocalTracking() {
    if (activityTrackingInitialized) return;
    
    console.log('Initializing local tab activity tracking');
    
    // Load existing activity data
    await loadTabActivity();
    
    // Set up tab event listeners
    chrome.tabs.onActivated.addListener((activeInfo) => {
        const now = Date.now();
        console.log('Local tracking: Tab activated:', activeInfo.tabId);
        localTabActivity[activeInfo.tabId] = now;
        localLastActiveTab = activeInfo.tabId;
        saveTabActivity(); // Save immediately
    });
    
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' || changeInfo.url) {
            // Only update if this is the active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                if (activeTabs.length > 0 && activeTabs[0].id === tabId) {
                    const now = Date.now();
                    console.log('Local tracking: Active tab updated:', tabId);
                    localTabActivity[tabId] = now;
                    saveTabActivity(); // Save immediately
                }
            });
        }
    });
    
    chrome.tabs.onRemoved.addListener((tabId) => {
        console.log('Local tracking: Tab removed:', tabId);
        delete localTabActivity[tabId];
        if (localLastActiveTab === tabId) {
            localLastActiveTab = null;
        }
        saveTabActivity(); // Save immediately
    });
    
    activityTrackingInitialized = true;
}

// Refresh tabs list with local tracking
async function refreshTabsList() {
    const container = document.getElementById('tabsContainer');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Loading tabs...</div>';
    
    // Initialize local tracking if not done
    await initializeLocalTracking();
    
    try {
        // Get current settings
        const settings = await new Promise(resolve => {
            chrome.storage.sync.get({
                inactiveTime: 30,
                checkInterval: 5,
                ignorePinned: true,
                ignoreAudible: true
            }, resolve);
        });
        
        // Get tabs and build activity data locally
        const tabs = await chrome.tabs.query({});
        const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTabId = activeTab[0]?.id;
        const now = Date.now();
        const inactiveThreshold = settings.inactiveTime * 60 * 1000;
        
        // Initialize activity for tabs we haven't seen before
        tabs.forEach(tab => {
            if (!localTabActivity[tab.id]) {
                localTabActivity[tab.id] = now; // Assume current time for new tabs
            }
        });
        
        console.log('Local tab activity state:', localTabActivity);
        
        const tabsData = tabs.map(tab => {
            const lastActivity = localTabActivity[tab.id] || now;
            const inactiveTime = now - lastActivity;
            const minutesInactive = Math.floor(inactiveTime / (1000 * 60));
            const hoursInactive = (inactiveTime / (1000 * 60 * 60)).toFixed(1);
            
            console.log(`Tab ${tab.id} (${tab.title.substring(0, 30)}...): last activity ${new Date(lastActivity).toLocaleTimeString()}, inactive for ${minutesInactive}m`);
            
            let status = 'safe';
            let statusText;
            
            // Format time display - switch to hours after 120 minutes
            if (minutesInactive >= 120) {
                statusText = `Active ${hoursInactive}h ago`;
            } else {
                statusText = `Active ${minutesInactive}m ago`;
            }
            
            if (tab.id === activeTabId) {
                status = 'safe';
                statusText = 'Currently Active';
                // Update activity for currently active tab
                localTabActivity[tab.id] = now;
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
                active: tab.id === activeTabId
            };
        }).sort((a, b) => {
            // First priority: Pinned tabs come first
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            
            // Within pinned or unpinned groups, sort by activity (most recent first)
            return a.inactiveTime - b.inactiveTime;
        });
        
        displayTabs(tabsData);
        
        // Update tab stats display
        updateTabStats(tabsData);
        
        // Save activity data after display
        await saveTabActivity();
        
    } catch (error) {
        console.error('Error in local tab tracking:', error);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Error: ' + error.message + '</div>';
    }
}



// Display tabs in the UI
function displayTabs(tabs) {
    const container = document.getElementById('tabsContainer');

    if (tabs.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No tabs found</div>';
        return;
    }

    const tabsHtml = tabs.map(tab => {
        // Use a simple icon instead of favicon to avoid CSP issues
        const icon = tab.url.startsWith('chrome://') ? '🔧' :
                    tab.url.startsWith('chrome-extension://') ? '🧩' :
                    tab.url.startsWith('https://') ? '🔒' :
                    tab.url.startsWith('http://') ? '🌐' : '📄';

        // Determine if tab can be closed
        const canClose = !tab.url.startsWith('chrome://') && !tab.active;
        const closeButtonText = tab.active ? 'Active' : 'Close';
        const closeButtonDisabled = !canClose ? 'disabled' : '';

        return `
            <div class="tab-item">
                <div class="tab-info">
                    <div class="tab-title">
                        <span style="margin-right: 8px; font-size: 14px;">${icon}</span>${escapeHtml(tab.title)}
                        ${tab.pinned ? ' 📌' : ''}
                        ${tab.audible ? ' 🔊' : ''}
                        ${tab.active ? ' (Active)' : ''}
                    </div>
                    <div class="tab-url">${escapeHtml(tab.url)}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="tab-status ${tab.status}">${escapeHtml(tab.statusText)}</div>
                    <button class="close-tab-btn" data-tab-id="${tab.id}" ${closeButtonDisabled}>
                        ${closeButtonText}
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = tabsHtml;
    
    // Add event listeners to close buttons
    const closeButtons = container.querySelectorAll('.close-tab-btn');
    closeButtons.forEach(button => {
        if (!button.disabled) {
            button.addEventListener('click', function() {
                const tabId = parseInt(this.getAttribute('data-tab-id'));
                closeTab(tabId);
            });
        }
    });
}

// Close a specific tab
async function closeTab(tabId) {
    try {
        console.log('Attempting to close tab:', tabId);
        
        // Close the tab
        await chrome.tabs.remove(tabId);
        
        // Remove from local activity tracking
        delete localTabActivity[tabId];
        if (localLastActiveTab === tabId) {
            localLastActiveTab = null;
        }
        
        // Update the all-time tabs removed counter
        await incrementTabsRemovedCount(1);
        
        console.log('Successfully closed tab:', tabId);
        
        // Refresh the tab list to show updated state
        await refreshTabsList();
        
    } catch (error) {
        console.error('Error closing tab:', error);
        alert('Error closing tab. It may have already been closed.');
        
        // Refresh anyway to sync the display
        await refreshTabsList();
    }
}

// Increment the count of tabs removed (manual closes)
async function incrementTabsRemovedCount(count = 1) {
    try {
        const result = await chrome.storage.local.get(['tabsRemovedCount']);
        const currentCount = result.tabsRemovedCount || 0;
        const newCount = currentCount + count;
        
        await chrome.storage.local.set({
            tabsRemovedCount: newCount
        });
        
        console.log(`Updated tabs removed count: ${newCount} (added ${count} from manual close)`);
    } catch (error) {
        console.error('Error updating tabs removed count:', error);
    }
}

// Update tab statistics display
function updateTabStats(tabsData) {
    const statsElement = document.getElementById('tabStats');
    
    // Count different tab types
    const totalTabs = tabsData.length;
    const pinnedTabs = tabsData.filter(tab => tab.pinned).length;
    const audibleTabs = tabsData.filter(tab => tab.audible).length;
    const protectedTabs = tabsData.filter(tab => tab.protected).length;
    const dangerTabs = tabsData.filter(tab => tab.status === 'danger').length;
    const warningTabs = tabsData.filter(tab => tab.status === 'warning').length;
    const safeTabs = tabsData.filter(tab => tab.status === 'safe').length;
    
    // Build stats text
    let statsText = `${totalTabs} tabs total`;
    
    if (pinnedTabs > 0) {
        statsText += ` • ${pinnedTabs} pinned`;
    }
    
    if (audibleTabs > 0) {
        statsText += ` • ${audibleTabs} playing audio`;
    }
    
    if (protectedTabs > 0) {
        statsText += ` • ${protectedTabs} protected`;
    }
    
    if (dangerTabs > 0) {
        statsText += ` • ${dangerTabs} closing soon`;
    }
    
    if (warningTabs > 0) {
        statsText += ` • ${warningTabs} warning`;
    }
    
    statsElement.textContent = statsText;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
