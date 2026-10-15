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
        inactiveTime: 60,
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

// Options page now uses background script's tracking data
// No need for duplicate local tracking system

// Refresh tabs list using background script data
async function refreshTabsList() {
    const container = document.getElementById('tabsContainer');
    container.innerHTML = '<div class="empty-state">Loading tabs...</div>';

    try {
        // Wake up service worker to ensure it's running
        await wakeUpServiceWorker();

        // Get tabs data from background script
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getTabsData' }, resolve);
        });

        if (response && response.tabsData) {
            console.log('Received tabs data from background script:', response.tabsData.length, 'tabs');
            displayTabs(response.tabsData);
            // Update tab stats display
            updateTabStats(response.tabsData);
        } else {
            console.error('Failed to get tabs data from background script:', response);
            container.innerHTML = '<div class="empty-state error">Error loading tabs data. Try refreshing.</div>';
        }

    } catch (error) {
        console.error('Error refreshing tabs list:', error);
        container.innerHTML = '<div class="empty-state error">Error: ' + escapeHtml(error.message) + '</div>';
    }
}



// Display tabs in the UI
function displayTabs(tabs) {
    const container = document.getElementById('tabsContainer');

    if (tabs.length === 0) {
        container.innerHTML = '<div class="empty-state">No tabs found</div>';
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

        const title = escapeHtml(tab.title);

        // Markers sit outside the truncated title so they stay visible
        const markers = [
            tab.pinned ? '<span class="badge">📌 Pinned</span>' : '',
            tab.audible ? '<span class="badge">🔊 Audio</span>' : '',
            tab.active ? '<span class="badge accent">Active</span>' : ''
        ].join('');

        return `
            <div class="tab-item">
                <span class="tab-icon" aria-hidden="true">${icon}</span>
                <div class="tab-info">
                    <div class="tab-title">${title}</div>
                    <div class="tab-url muted">${escapeHtml(tab.url)}</div>
                    ${markers ? `<div class="tab-markers">${markers}</div>` : ''}
                </div>
                <div class="tab-actions">
                    <div class="tab-status badge ${escapeHtml(tab.status)}">${escapeHtml(tab.statusText)}</div>
                    <button class="close-tab-btn btn btn-danger btn-sm" data-tab-id="${tab.id}" aria-label="Close ${title}" ${closeButtonDisabled}>
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

        // Close the tab with tracking via background script
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
                action: 'closeTabWithTracking', 
                tabId: tabId 
            }, resolve);
        });

        if (response && response.success) {
            // Update the all-time tabs removed counter
            await incrementTabsRemovedCount(1);

            console.log('Successfully closed tab:', response.result.title);
        } else {
            throw new Error(response?.error || 'Failed to close tab');
        }

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

// Escape HTML to prevent XSS (quotes too, so values are safe inside attributes)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
