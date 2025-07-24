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
}

// Show error state
function showError() {
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('statsContainer').style.display = 'none';
}
