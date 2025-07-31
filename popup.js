// Popup statistics functionality
document.addEventListener('DOMContentLoaded', async function() {
    await loadStatistics();
    setupEventListeners();
});

// Set up button event listeners
function setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', loadStatistics);
    document.getElementById('resetBtn').addEventListener('click', resetStatistics);
    document.getElementById('openOptionsBtn').addEventListener('click', openOptionsPage);

    // Add badge update functionality to refresh button
    document.getElementById('refreshBtn').addEventListener('click', updateBadge);
}

// Update the badge manually
function updateBadge() {
    try {
        chrome.runtime.sendMessage({ action: 'updateBadge' });
        console.log('Badge update requested');
    } catch (error) {
        console.error('Error updating badge:', error);
    }
}

// Load and display all statistics
async function loadStatistics() {
    try {
        showLoading();

        // Load Chrome info
        await loadChromeInfo();

        // Load tab statistics
        await loadTabStatistics();

        // Load persistent statistics
        await loadPersistentStats();

        // Load recently closed tabs
        await loadRecentlyClosedTabs();

        showStats();

    } catch (error) {
        console.error('Error loading statistics:', error);
        showError();
    }
}

// Load Chrome browser information
async function loadChromeInfo() {
    try {
        const platformInfo = await chrome.runtime.getPlatformInfo();
        const manifestData = chrome.runtime.getManifest();

        const chromeInfo = document.getElementById('chromeInfo');
        chromeInfo.textContent = `Chrome ${platformInfo.os} - ${manifestData.name} ${manifestData.version}`;
    } catch (error) {
        console.error('Error loading Chrome info:', error);
        document.getElementById('chromeInfo').textContent = 'Tab Cleaner Extension';
    }
}

// Load current tab statistics
async function loadTabStatistics() {
    try {
        // Get all tabs and windows
        const allTabs = await chrome.tabs.query({});
        const allWindows = await chrome.windows.getAll();
        const currentWindow = await chrome.windows.getCurrent({ populate: true });

        // Calculate statistics
        const openWindows = allWindows.length;
        const openTabs = allTabs.length;
        const currentWindowTabs = currentWindow.tabs ? currentWindow.tabs.length : 0;
        const currentWindowPinned = currentWindow.tabs ?
            currentWindow.tabs.filter(tab => tab.pinned).length : 0;

        // Update UI
        document.getElementById('openWindows').textContent = openWindows;
        document.getElementById('openTabs').textContent = openTabs;
        document.getElementById('currentWindowTabs').textContent = currentWindowTabs;
        document.getElementById('currentWindowPinned').textContent = currentWindowPinned;

        // Update max concurrent tabs if current is higher
        await updateMaxConcurrentTabs(openTabs);

    } catch (error) {
        console.error('Error loading tab statistics:', error);
        throw error;
    }
}

// Load persistent statistics from storage
async function loadPersistentStats() {
    try {
        const result = await chrome.storage.local.get([
            'tabsRemovedCount',
            'maxConcurrentTabs',
            'statisticsStartDate'
        ]);

        const tabsRemoved = result.tabsRemovedCount || 0;
        const maxConcurrent = result.maxConcurrentTabs || 0;

        document.getElementById('tabsRemoved').textContent = tabsRemoved;
        document.getElementById('maxConcurrentTabs').textContent = maxConcurrent;

        // Initialize statistics start date if not set
        if (!result.statisticsStartDate) {
            await chrome.storage.local.set({
                statisticsStartDate: Date.now()
            });
        }

    } catch (error) {
        console.error('Error loading persistent stats:', error);
        document.getElementById('tabsRemoved').textContent = '0';
        document.getElementById('maxConcurrentTabs').textContent = '0';
    }
}

// Update max concurrent tabs if current count is higher
async function updateMaxConcurrentTabs(currentCount) {
    try {
        const result = await chrome.storage.local.get(['maxConcurrentTabs']);
        const currentMax = result.maxConcurrentTabs || 0;

        if (currentCount > currentMax) {
            await chrome.storage.local.set({
                maxConcurrentTabs: currentCount
            });
            document.getElementById('maxConcurrentTabs').textContent = currentCount;
        }
    } catch (error) {
        console.error('Error updating max concurrent tabs:', error);
    }
}

// Reset all statistics
async function resetStatistics() {
    if (!confirm('Are you sure you want to reset all statistics? This cannot be undone.')) {
        return;
    }

    try {
        await chrome.storage.local.set({
            tabsRemovedCount: 0,
            maxConcurrentTabs: 0,
            statisticsStartDate: Date.now()
        });

        // Also clear tab activity data
        await chrome.storage.local.remove([
            'optionsTabActivity',
            'optionsLastActiveTab',
            'optionsActivityTimestamp'
        ]);

        // Reload statistics
        await loadStatistics();

        console.log('Statistics reset successfully');

    } catch (error) {
        console.error('Error resetting statistics:', error);
        alert('Error resetting statistics. Please try again.');
    }
}

// Open the options page
function openOptionsPage() {
    chrome.runtime.openOptionsPage();
    window.close();
}

// Show loading state
function showLoading() {
    document.getElementById('loadingMessage').style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('statsContainer').style.display = 'none';
}

// Show statistics
function showStats() {
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('statsContainer').style.display = 'block';
    document.getElementById('recentlyClosedContainer').style.display = 'block';
}

// Show error state
function showError() {
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('statsContainer').style.display = 'none';
}

// Load recently closed tabs
async function loadRecentlyClosedTabs() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getRecentlyClosedTabs' });
        const recentlyClosedTabs = response.recentlyClosedTabs || [];
        
        displayRecentlyClosedTabs(recentlyClosedTabs);
    } catch (error) {
        console.error('Error loading recently closed tabs:', error);
        displayRecentlyClosedTabs([]);
    }
}

// Display recently closed tabs in the UI
function displayRecentlyClosedTabs(tabs) {
    const container = document.getElementById('recentlyClosedList');
    
    if (!tabs || tabs.length === 0) {
        container.innerHTML = '<div class="no-recent-tabs">No recently closed tabs</div>';
        return;
    }
    
    // Show only the most recent 5 tabs
    const recentTabs = tabs.slice(0, 5);
    
    // Clear container and build elements properly
    container.innerHTML = '';
    
    recentTabs.forEach(tab => {
        const timeSinceClosed = formatTimeSince(tab.closedAt);
        const fallbackFavicon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23ccc"/></svg>';
        
        // Create elements properly to avoid HTML injection issues
        const itemDiv = document.createElement('div');
        itemDiv.className = 'closed-tab-item';
        
        const favicon = document.createElement('img');
        favicon.className = 'closed-tab-favicon';
        favicon.src = tab.favIconUrl || fallbackFavicon;
        favicon.alt = '';
        favicon.onerror = function() { this.src = fallbackFavicon; };
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'closed-tab-info';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'closed-tab-title';
        titleDiv.textContent = tab.title;
        titleDiv.title = tab.title;
        
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'closed-tab-details';
        detailsDiv.textContent = `${timeSinceClosed} • ${tab.reason}`;
        
        const reopenBtn = document.createElement('button');
        reopenBtn.className = 'reopen-btn';
        reopenBtn.textContent = 'Reopen';
        reopenBtn.onclick = () => reopenTab(tab.id);
        
        // Assemble the structure
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(detailsDiv);
        itemDiv.appendChild(favicon);
        itemDiv.appendChild(infoDiv);
        itemDiv.appendChild(reopenBtn);
        container.appendChild(itemDiv);
    });
}

// Reopen a closed tab
async function reopenTab(tabId) {
    try {
        const response = await chrome.runtime.sendMessage({ 
            action: 'reopenTab', 
            tabId: tabId 
        });
        
        if (response.success) {
            console.log('Tab reopened successfully');
            // Refresh the recently closed tabs list
            await loadRecentlyClosedTabs();
            // Also refresh statistics
            await loadTabStatistics();
        } else {
            console.error('Failed to reopen tab:', response.error);
            alert('Failed to reopen tab: ' + response.error);
        }
    } catch (error) {
        console.error('Error reopening tab:', error);
        alert('Error reopening tab. Please try again.');
    }
}

// Format time since closed
function formatTimeSince(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
        return 'Just now';
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
