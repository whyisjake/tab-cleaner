const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, MINUTE, HOUR } = require('./helpers/load-background');
const { createEvent, failOnce, touchesKey } = require('./helpers/chrome-mock');

const DAY_SETTINGS = { inactiveTime: 24 * 60, checkInterval: 5, ignorePinned: true, ignoreAudible: true };
const HOUR_SETTINGS = { ...DAY_SETTINGS, inactiveTime: 60 };

// Load a worker and run its startup initialization
async function started(options) {
  const bg = loadBackground(options);
  await bg.runTimers();
  return bg;
}

function ago(ms) {
  return Date.now() - ms;
}

describe('service worker startup', () => {
  it('initializes on load and schedules cleanup at the saved interval', async () => {
    const bg = await started({
      sync: { ...DAY_SETTINGS, checkInterval: 10 },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });

    assert.equal(bg.get('isInitialized'), true);
    assert.deepEqual(bg.plain(bg.chrome._alarms.cleanupTabs), { delayInMinutes: 10, periodInMinutes: 10 });
    assert.ok(bg.chrome._alarms['keepalive-primary']);
    assert.ok(bg.chrome._alarms['keepalive-backup']);
    assert.equal(bg.chrome._badge.text, '2');
    assert.ok(bg.chrome.storage.local.data.extensionInstallTime);
    assert.deepEqual(bg.errors, []);
  });

  it('only initializes once across startup, install, and later events', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    let loads = 0;
    const originalGet = bg.chrome.storage.sync.get;
    bg.chrome.storage.sync.get = (...args) => {
      loads++;
      return originalGet(...args);
    };

    await bg.chrome.runtime.onInstalled.fire();
    await bg.chrome.runtime.onStartup.fire();

    assert.equal(loads, 0);
  });

  it('shares one initialization between events that arrive together', async () => {
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { backgroundTabActivity: { 1: ago(90 * MINUTE), 2: ago(90 * MINUTE) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });

    // Tab 2 is activated while the startup initialization is still running
    bg.timers.splice(0).forEach(({ callback }) => callback());
    await bg.activate(2);
    await bg.activate(1);
    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 2]);
  });

  it('logs and continues when the toolbar icon cannot be set', async () => {
    const bg = loadBackground({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.action, 'setIcon', { sync: true });

    await bg.runTimers();

    assert.equal(bg.get('isInitialized'), true);
    assert.deepEqual(bg.errors.map(([message]) => message), ['Error updating icon:']);
  });

  it('drops invalid saved timestamps and restores the last active tab', async () => {
    const bg = await started({
      local: {
        backgroundTabActivity: { 1: ago(MINUTE), 2: 'newly_discovered', 3: -5, 4: NaN },
        backgroundLastActiveTab: 1,
        backgroundActivityTimestamp: ago(MINUTE)
      },
      tabs: [{ id: 1 }, { id: 2 }]
    });

    assert.deepEqual(Object.keys(bg.get('tabActivity')).sort(), ['1', '2']);
    assert.equal(typeof bg.get('tabActivity')[2], 'number');
    assert.equal(bg.get('lastActiveTab'), 1);
  });

  it('keeps going when each startup step fails', async () => {
    const bg = loadBackground({ tabs: [{ id: 1, active: true }] });
    const { storage, alarms } = bg.chrome;
    failOnce(storage.local, 'get', { when: touchesKey('backgroundTabActivity') });
    failOnce(storage.sync, 'get');
    failOnce(storage.local, 'get', { when: touchesKey('recentlyClosedTabs') });
    failOnce(storage.local, 'get', { when: touchesKey('cleaningPaused') });
    failOnce(storage.local, 'get', { when: touchesKey('extensionInstallTime') });
    failOnce(alarms, 'create', { sync: true, when: name => name.startsWith('keepalive') });

    await bg.runTimers();

    assert.equal(bg.get('isInitialized'), true);
    assert.deepEqual(bg.errors.map(([message]) => message).sort(), [
      'Error initializing existing tabs:',
      'Error loading pause state:',
      'Error loading recently closed tabs:',
      'Failed to load settings:',
      'Failed to load tab activity from storage:',
      'Failed to setup keepalive:'
    ]);
  });
});

describe('cleanup', () => {
  it('uses the saved inactive time after a worker restart, not the 1 hour default', async () => {
    // Regression: v1.2.0 only loaded settings in onInstalled/onStartup, so a
    // worker woken by an ordinary event ran cleanup with the 60 minute default
    const bg = loadBackground({ sync: DAY_SETTINGS, tabs: [{ id: 1, active: true }, { id: 2 }] });
    await bg.activate(2);
    await bg.activate(1);
    bg.get('tabActivity')[2] = ago(70 * MINUTE);

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 2]);
  });

  it('closes tabs idle longer than the saved inactive time', async () => {
    const bg = loadBackground({
      sync: DAY_SETTINGS,
      local: { backgroundTabActivity: { 1: Date.now(), 2: ago(25 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2, title: 'Old tab' }]
    });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1]);
    assert.equal(bg.chrome.storage.local.data.tabsRemovedCount, 1);
    const [closed] = bg.chrome.storage.local.data.recentlyClosedTabs;
    assert.equal(closed.title, 'Old tab');
    assert.equal(closed.reason, 'auto-closed');
    assert.ok(closed.inactiveTime >= 25 * HOUR);
    assert.equal(bg.chrome.storage.local.data.backgroundTabActivity[2], undefined);
  });

  it('does not close restored tabs after a browser restart', async () => {
    // Tab IDs change on restart, so none of the saved IDs match
    const bg = loadBackground({
      sync: DAY_SETTINGS,
      local: {
        backgroundTabActivity: { 1: ago(2 * HOUR), 2: ago(2 * HOUR) },
        extensionInstallTime: ago(30 * 24 * HOUR)
      },
      tabs: [{ id: 101, active: true }, { id: 102 }, { id: 103 }]
    });

    await bg.chrome.runtime.onStartup.fire();
    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [101, 102, 103]);
    assert.deepEqual(Object.keys(bg.chrome.storage.local.data.backgroundTabActivity).sort(), ['101', '102', '103']);
  });

  it('gives restored tabs their saved activity back by URL', async () => {
    // Regression: restarting the browser reset every tab's idle clock, so with
    // a 24 hour limit and a daily restart nothing ever closed
    const bg = loadBackground({
      sync: DAY_SETTINGS,
      local: {
        backgroundTabActivity: { 1: ago(25 * HOUR), 2: ago(2 * HOUR), 3: ago(30 * HOUR) },
        backgroundTabUrls: { 1: 'https://old.example', 2: 'https://recent.example', 3: 'https://gone.example' }
      },
      tabs: [
        { id: 101, active: true, url: 'https://old.example' },
        { id: 102, url: 'https://old.example' },
        { id: 103, url: 'https://recent.example' },
        { id: 104, url: 'https://new.example' }
      ]
    });
    const saved = bg.chrome.storage.local.data.backgroundTabActivity;
    const recent = saved[2];

    await bg.chrome.runtime.onStartup.fire();
    await bg.alarm('cleanupTabs');

    // The active tab is fresh even though its URL matched; 102 then took the old entry
    assert.deepEqual(bg.tabIds(), [101, 103, 104]);
    assert.equal(bg.get('tabActivity')[103], recent);
    assert.ok(bg.get('tabActivity')[104] > ago(MINUTE));
    assert.deepEqual(bg.plain(bg.chrome.storage.local.data.backgroundTabUrls), {
      101: 'https://old.example',
      103: 'https://recent.example',
      104: 'https://new.example'
    });
  });

  it('gives tabs restored after startup their saved activity back', async () => {
    const bg = await started({
      sync: DAY_SETTINGS,
      local: {
        backgroundTabActivity: { 1: ago(25 * HOUR), 2: ago(3 * HOUR) },
        backgroundTabUrls: { 1: 'https://a.example', 2: 'https://b.example' }
      },
      tabs: [{ id: 101, active: true, url: 'https://new.example' }]
    });
    const pool = bg.plain(bg.get('restorePool'));
    bg.chrome._tabs.push(
      { id: 102, windowId: 1, url: 'https://a.example', title: 'A' },
      { id: 103, windowId: 1, url: '', title: 'B' }
    );

    await bg.chrome.tabs.onCreated.fire({ id: 102, url: 'https://a.example' });
    await bg.chrome.tabs.onCreated.fire({ id: 103, url: '', pendingUrl: 'https://b.example' });
    await bg.alarm('cleanupTabs');

    assert.equal(pool.length, 2);
    assert.deepEqual(bg.tabIds(), [101, 103]);
    assert.ok(bg.get('tabActivity')[103] < ago(2 * HOUR));
  });

  it('gives a URL open twice each saved entry once, most recent first', async () => {
    const bg = await started({
      sync: DAY_SETTINGS,
      local: {
        backgroundTabActivity: { 1: ago(30 * HOUR), 2: ago(2 * HOUR) },
        backgroundTabUrls: { 1: 'https://dup.example', 2: 'https://dup.example' }
      },
      tabs: [{ id: 100, active: true, url: 'https://x.example' }]
    });

    await bg.chrome.tabs.onCreated.fire({ id: 101, url: 'https://dup.example' });
    await bg.chrome.tabs.onCreated.fire({ id: 102, url: 'https://dup.example' });
    await bg.chrome.tabs.onCreated.fire({ id: 103, url: 'https://dup.example' });

    const activity = bg.get('tabActivity');
    assert.ok(activity[101] > ago(3 * HOUR) && activity[101] < ago(HOUR));
    assert.ok(activity[102] < ago(29 * HOUR));
    assert.ok(activity[103] > ago(MINUTE));
  });

  it('stops restoring saved activity once the startup window has passed', async () => {
    const bg = await started({
      sync: DAY_SETTINGS,
      local: {
        backgroundTabActivity: { 1: ago(25 * HOUR) },
        backgroundTabUrls: { 1: 'https://a.example' }
      },
      tabs: [{ id: 101, active: true, url: 'https://x.example' }]
    });
    bg.get('restorePoolExpiresAt = Date.now() - 1');

    await bg.chrome.tabs.onCreated.fire({ id: 102, url: 'https://a.example' });

    assert.ok(bg.get('tabActivity')[102] > ago(MINUTE));
  });

  it('eventually closes restored tabs that are never visited', async () => {
    const bg = await started({
      sync: DAY_SETTINGS,
      local: { backgroundTabActivity: { 1: ago(2 * HOUR) } },
      tabs: [{ id: 101, active: true }, { id: 102 }]
    });

    // Restored tabs need a real timestamp, or idle time is NaN and never expires
    assert.equal(typeof bg.get('tabActivity')[102], 'number');

    bg.get('tabActivity')[102] = ago(25 * HOUR);
    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [101]);
  });

  it('picks up a lowered inactive time on the next run', async () => {
    const bg = await started({
      sync: DAY_SETTINGS,
      local: { backgroundTabActivity: { 1: Date.now(), 2: ago(70 * MINUTE) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });

    await bg.chrome.storage.sync.set({ inactiveTime: 60 });
    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1]);
  });

  it('skips the active tab, chrome:// pages, pinned tabs, and audible tabs', async () => {
    const old = ago(2 * HOUR);
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { backgroundTabActivity: { 1: old, 2: old, 3: old, 4: old, 5: old } },
      tabs: [
        { id: 1, active: true },
        { id: 2, url: 'chrome://settings' },
        { id: 3, pinned: true },
        { id: 4, audible: true },
        { id: 5 }
      ]
    });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 2, 3, 4]);
  });

  it('closes pinned and audible tabs when protection is off', async () => {
    const old = ago(2 * HOUR);
    const bg = loadBackground({
      sync: { ...HOUR_SETTINGS, ignorePinned: false, ignoreAudible: false },
      local: { backgroundTabActivity: { 1: old, 2: old, 3: old } },
      tabs: [{ id: 1, active: true }, { id: 2, pinned: true }, { id: 3, audible: true }]
    });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1]);
  });

  it('does nothing while paused', async () => {
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { cleaningPaused: true, backgroundTabActivity: { 1: Date.now(), 2: ago(2 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 2]);
  });

  it('starts tracking tabs it has never seen instead of closing them', async () => {
    const bg = await started({ sync: HOUR_SETTINGS, tabs: [{ id: 1, active: true }] });
    bg.chrome._tabs.push({ id: 9, windowId: 1, url: 'https://example.com/9', title: 'Untracked' });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 9]);
    assert.equal(typeof bg.get('tabActivity')[9], 'number');
  });

  it('skips a tab with no activity data', async () => {
    const bg = await started({ sync: HOUR_SETTINGS, tabs: [{ id: 1, active: true }] });
    bg.chrome._tabs.push({ id: 9, windowId: 1, url: 'https://example.com/9', title: 'Untracked' });
    // Tracking pass fails, so tab 9 reaches the close loop untracked
    failOnce(bg.chrome.tabs, 'query', { when: query => Object.keys(query).length === 0 });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 9]);
    assert.equal(bg.errors[0][0], 'Error ensuring tabs are tracked:');
  });

  it('forgets saved activity for tabs that no longer exist', async () => {
    const bg = await started({ sync: DAY_SETTINGS, tabs: [{ id: 1, active: true }] });
    bg.get('tabActivity')[77] = Date.now();

    await bg.alarm('cleanupTabs');

    assert.equal(bg.get('tabActivity')[77], undefined);
  });

  it('closes nothing if settings cannot be read', async () => {
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { backgroundTabActivity: { 1: Date.now(), 2: ago(2 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });
    await bg.runTimers();
    failOnce(bg.chrome.storage.sync, 'get');

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 2]);
    assert.equal(bg.errors[0][0], 'Error during cleanup:');
  });

  it('keeps closing other tabs when one close fails', async () => {
    const old = ago(2 * HOUR);
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { backgroundTabActivity: { 1: Date.now(), 2: old, 3: old } },
      tabs: [{ id: 1, active: true }, { id: 2 }, { id: 3 }]
    });
    await bg.runTimers();
    failOnce(bg.chrome.tabs, 'remove', { when: id => id === 2 });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1, 2]);
    assert.equal(bg.errors[0][0], 'Error closing tab 2:');
  });

  it('still closes tabs when the removed-count statistic cannot be saved', async () => {
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { tabsRemovedCount: 4, backgroundTabActivity: { 1: Date.now(), 2: ago(2 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });
    await bg.runTimers();
    failOnce(bg.chrome.storage.local, 'get', { when: touchesKey('tabsRemovedCount') });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1]);
    assert.equal(bg.chrome.storage.local.data.tabsRemovedCount, 4);
    assert.equal(bg.errors[0][0], 'Error updating tabs removed count:');
  });

  it('adds to an existing removed count', async () => {
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { tabsRemovedCount: 4, backgroundTabActivity: { 1: Date.now(), 2: ago(2 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });

    await bg.alarm('cleanupTabs');

    assert.equal(bg.chrome.storage.local.data.tabsRemovedCount, 5);
  });
});

describe('recently closed tabs', () => {
  function closedTab(n, closedAt = Date.now()) {
    return { id: `closed_${n}`, title: `Closed ${n}`, url: `https://example.com/closed/${n}`, windowId: 1, closedAt };
  }

  it('keeps the newest 50 and drops entries older than 7 days', async () => {
    const existing = Array.from({ length: 50 }, (_, n) => closedTab(n));
    existing[10].closedAt = ago(8 * 24 * HOUR);
    const bg = await started({
      sync: HOUR_SETTINGS,
      local: { recentlyClosedTabs: existing, backgroundTabActivity: { 1: Date.now(), 2: ago(2 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2, title: 'Newest' }]
    });

    await bg.alarm('cleanupTabs');

    const saved = bg.chrome.storage.local.data.recentlyClosedTabs;
    assert.equal(saved.length, 49);
    assert.equal(saved[0].title, 'Newest');
    assert.ok(!saved.some(tab => tab.id === 'closed_10'));
    assert.ok(!saved.some(tab => tab.id === 'closed_49'));
  });

  it('records a closed tab with no activity data as zero inactive time', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2 }] });
    delete bg.get('tabActivity')[2];

    await bg.sendMessage({ action: 'closeTabWithTracking', tabId: 2 });

    assert.equal(bg.chrome.storage.local.data.recentlyClosedTabs[0].inactiveTime, 0);
  });

  it('still closes the tab when the closed list cannot be saved', async () => {
    const bg = loadBackground({
      sync: HOUR_SETTINGS,
      local: { backgroundTabActivity: { 1: Date.now(), 2: ago(2 * HOUR) } },
      tabs: [{ id: 1, active: true }, { id: 2 }]
    });
    await bg.runTimers();
    failOnce(bg.chrome.storage.local, 'set', { when: touchesKey('recentlyClosedTabs') });

    await bg.alarm('cleanupTabs');

    assert.deepEqual(bg.tabIds(), [1]);
    assert.equal(bg.errors[0][0], 'Error saving recently closed tab:');
  });

  it('returns the list without initializing the worker', async () => {
    const bg = loadBackground({ local: { recentlyClosedTabs: [closedTab(1)] } });

    const empty = await bg.sendMessage({ action: 'getRecentlyClosedTabs' });

    assert.deepEqual(empty, { recentlyClosedTabs: [] });
    assert.equal(bg.get('isInitialized'), false);
  });

  it('returns the loaded list', async () => {
    const bg = await started({ local: { recentlyClosedTabs: [closedTab(1)] } });

    const response = await bg.sendMessage({ action: 'getRecentlyClosedTabs' });

    assert.equal(response.recentlyClosedTabs[0].id, 'closed_1');
  });

  it('reopens a closed tab, tracks it, and removes it from the list', async () => {
    const bg = await started({
      local: { recentlyClosedTabs: [closedTab(1), closedTab(2)] },
      tabs: [{ id: 1, active: true }]
    });

    const response = await bg.sendMessage({ action: 'reopenTab', tabId: 'closed_1' });

    assert.equal(response.success, true);
    assert.equal(response.newTab.url, 'https://example.com/closed/1');
    assert.equal(typeof bg.get('tabActivity')[response.newTab.id], 'number');
    assert.deepEqual(bg.chrome.storage.local.data.recentlyClosedTabs.map(tab => tab.id), ['closed_2']);
  });

  it('reports an error when reopening an unknown tab', async () => {
    const bg = await started({});

    const response = await bg.sendMessage({ action: 'reopenTab', tabId: 'closed_missing' });

    assert.deepEqual(response, { error: 'Tab not found in recently closed list' });
  });
});

describe('manual close', () => {
  it('closes the tab, records it, and clears the last active tab', async () => {
    const bg = await started({ tabs: [{ id: 1 }, { id: 2, active: true, title: 'Closing' }] });

    const response = await bg.sendMessage({ action: 'closeTabWithTracking', tabId: 2 });

    assert.deepEqual(response, { success: true, result: { tabId: 2, title: 'Closing' } });
    assert.deepEqual(bg.tabIds(), [1]);
    assert.equal(bg.get('lastActiveTab'), null);
    assert.equal(bg.chrome.storage.local.data.recentlyClosedTabs[0].reason, 'manually-closed');
  });

  it('leaves the last active tab alone when closing a different tab', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2 }] });

    await bg.sendMessage({ action: 'closeTabWithTracking', tabId: 2 });

    assert.equal(bg.get('lastActiveTab'), 1);
  });

  it('reports an error for a tab that does not exist', async () => {
    const bg = await started({});

    const response = await bg.sendMessage({ action: 'closeTabWithTracking', tabId: 404 });

    assert.deepEqual(response, { error: 'No tab with id: 404' });
  });
});

describe('activity tracking', () => {
  it('records activation as activity', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2 }] });
    bg.get('tabActivity')[2] = ago(HOUR);

    await bg.activate(2);

    assert.ok(bg.get('tabActivity')[2] > ago(MINUTE));
    assert.equal(bg.get('lastActiveTab'), 2);
    assert.equal(bg.chrome.storage.local.data.backgroundLastActiveTab, 2);
  });

  it('records page loads in the active tab only', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2 }] });
    bg.get('tabActivity')[1] = ago(HOUR);
    bg.get('tabActivity')[2] = ago(HOUR);

    await bg.chrome.tabs.onUpdated.fire(1, { status: 'complete' }, {});
    await bg.chrome.tabs.onUpdated.fire(2, { url: 'https://example.com/new' }, {});

    assert.ok(bg.get('tabActivity')[1] > ago(MINUTE));
    assert.ok(bg.get('tabActivity')[2] < ago(MINUTE));
  });

  it('remembers the URL each tab navigates to and forgets it when the tab closes', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2 }] });

    await bg.chrome.tabs.onUpdated.fire(2, { url: 'https://example.com/elsewhere' }, {});
    assert.equal(bg.chrome.storage.local.data.backgroundTabUrls[2], 'https://example.com/elsewhere');

    await bg.chrome.tabs.remove(2);
    await bg.chrome.tabs.onRemoved.fire(2);
    assert.equal(bg.chrome.storage.local.data.backgroundTabUrls[2], undefined);
  });

  it('ignores updates that are not loads or navigations', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    bg.get('tabActivity')[1] = ago(HOUR);

    await bg.chrome.tabs.onUpdated.fire(1, { title: 'New title' }, {});

    assert.ok(bg.get('tabActivity')[1] < ago(MINUTE));
  });

  it('logs and continues when the active tab lookup fails on update', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.tabs, 'query');

    await bg.chrome.tabs.onUpdated.fire(1, { status: 'complete' }, {});

    assert.equal(bg.errors[0][0], 'Error updating tab activity:');
  });

  it('starts new tabs at the current time', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    bg.chrome._tabs.push({ id: 2, windowId: 1, url: 'https://example.com/2', title: 'New' });

    await bg.chrome.tabs.onCreated.fire({ id: 2 });

    assert.ok(bg.get('tabActivity')[2] > ago(MINUTE));
    assert.equal(bg.chrome._badge.text, '2');
  });

  it('forgets removed tabs', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2 }] });

    await bg.chrome.tabs.remove(1);
    await bg.chrome.tabs.onRemoved.fire(1);
    await bg.chrome.tabs.onRemoved.fire(2);

    assert.equal(bg.get('tabActivity')[1], undefined);
    assert.equal(bg.get('lastActiveTab'), null);
  });

  it('records the active tab when a window gains focus', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }, { id: 2, windowId: 2, active: true }] });
    bg.get('tabActivity')[2] = ago(HOUR);

    await bg.chrome.windows.onFocusChanged.fire(2);

    assert.ok(bg.get('tabActivity')[2] > ago(MINUTE));
    assert.equal(bg.get('lastActiveTab'), 2);
  });

  it('ignores focus leaving all windows and windows without tabs', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });

    await bg.chrome.windows.onFocusChanged.fire(bg.chrome.windows.WINDOW_ID_NONE);
    await bg.chrome.windows.onFocusChanged.fire(99);

    assert.equal(bg.get('lastActiveTab'), 1);
  });

  it('logs and continues when the focused window lookup fails', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.tabs, 'query');

    await bg.chrome.windows.onFocusChanged.fire(1);

    assert.equal(bg.errors[0][0], 'Error handling window focus change:');
  });
});

describe('storage', () => {
  it('falls back to a minimal save when the full save fails', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.storage.local, 'set', { when: touchesKey('backgroundLastActiveTab') });

    await bg.chrome.tabs.onCreated.fire({ id: 2 });

    assert.equal(bg.errors[0][0], 'Failed to save tab activity:');
    assert.ok(bg.chrome.storage.local.data.backgroundTabActivity[2]);
  });

  it('logs when the fallback save fails too', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.storage.local, 'set', { when: touchesKey('backgroundLastActiveTab') });
    failOnce(bg.chrome.storage.local, 'set', {
      when: items => touchesKey('backgroundTabActivity')(items) && !touchesKey('backgroundLastActiveTab')(items)
    });

    await bg.chrome.tabs.onCreated.fire({ id: 2 });

    assert.deepEqual(bg.errors.map(([message]) => message), ['Failed to save tab activity:', 'Backup save also failed:']);
  });

  it('applies synced setting changes and ignores everything else', async () => {
    const bg = await started({ sync: DAY_SETTINGS });

    await bg.chrome.storage.onChanged.fire({ inactiveTime: { newValue: 120 } }, 'sync');
    await bg.chrome.storage.onChanged.fire({ checkInterval: { newValue: 30 } }, 'local');
    await bg.chrome.storage.onChanged.fire({ unrelated: { newValue: 1 } }, 'sync');
    await bg.chrome.storage.onChanged.fire({ ignorePinned: { oldValue: true } }, 'sync');

    assert.deepEqual(bg.plain(bg.get('settings')), { ...DAY_SETTINGS, inactiveTime: 120 });
  });
});

describe('alarms', () => {
  it('saves state on keepalive alarms', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    bg.get('tabActivity')[1] = 12345;

    await bg.alarm('keepalive-primary');

    assert.equal(bg.chrome.storage.local.data.backgroundTabActivity[1], 12345);
  });

  it('ignores unknown alarms', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });

    await bg.alarm('something-else');

    assert.deepEqual(bg.errors, []);
  });
});

describe('messages', () => {
  it('answers ping synchronously', async () => {
    const bg = loadBackground();

    const response = await bg.sendMessage({ action: 'ping' });

    assert.equal(response.pong, true);
    assert.equal(bg.lastMessageReturn, false);
  });

  it('updates settings and reschedules the cleanup alarm', async () => {
    const bg = await started({ sync: DAY_SETTINGS });

    const response = await bg.sendMessage({ action: 'updateSettings', settings: { ...DAY_SETTINGS, checkInterval: 15 } });

    assert.deepEqual(response, { success: true });
    assert.equal(bg.lastMessageReturn, true);
    assert.deepEqual(bg.plain(bg.chrome._alarms.cleanupTabs), { delayInMinutes: 15, periodInMinutes: 15 });
  });

  it('updates the badge on request', async () => {
    const bg = loadBackground({ tabs: [{ id: 1 }, { id: 2 }, { id: 3 }] });

    const response = await bg.sendMessage({ action: 'updateBadge' });

    assert.deepEqual(response, { success: true });
    assert.equal(bg.chrome._badge.text, '3');
  });

  it('reports a badge update failure', async () => {
    const bg = loadBackground();
    failOnce(bg.chrome.tabs, 'query');

    const response = await bg.sendMessage({ action: 'updateBadge' });

    assert.deepEqual(response, { error: 'query failed' });
  });

  it('records pause state changes', async () => {
    const bg = await started({});

    await bg.sendMessage({ action: 'pauseStateChanged', paused: true });

    assert.equal(bg.get('isPaused'), true);
  });

  it('rejects unknown actions', async () => {
    const bg = await started({});

    assert.deepEqual(await bg.sendMessage({ action: 'nope' }), { error: 'Unknown action' });
  });

  it('answers pings over a connected port', async () => {
    const bg = await started({});
    const posted = [];
    const port = { name: 'keepalive', onMessage: createEvent(), postMessage: message => posted.push(message) };

    await bg.chrome.runtime.onConnect.fire(port);
    await port.onMessage.fire({ action: 'ping' });
    await port.onMessage.fire({ action: 'other' });

    assert.deepEqual(posted.map(message => message.action), ['pong']);
  });
});

describe('tab activity monitor data', () => {
  it('describes each tab and sorts the most at-risk first', async () => {
    const bg = await started({
      sync: { ...DAY_SETTINGS, inactiveTime: 10 * 60 },
      tabs: [
        { id: 1, active: true },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
        { id: 6, url: 'chrome://extensions' },
        { id: 7, pinned: true },
        { id: 8, audible: true }
      ]
    });
    Object.assign(bg.get('tabActivity'), {
      2: ago(30 * MINUTE),
      3: ago(3 * HOUR),
      4: ago(6 * HOUR),
      5: ago(9 * HOUR),
      6: ago(9 * HOUR),
      7: ago(9 * HOUR),
      8: ago(9 * HOUR)
    });
    bg.chrome._tabs.push({ id: 9, windowId: 1, url: 'https://example.com/9', title: 'Untracked', pinned: false, audible: false });

    const { tabsData } = await bg.sendMessage({ action: 'getTabsData' });
    const byId = Object.fromEntries(tabsData.map(tab => [tab.id, tab]));

    assert.deepEqual(tabsData.map(tab => tab.id).slice(0, 2), [5, 4]);
    assert.equal(byId[1].statusText, 'Currently Active');
    assert.equal(byId[1].active, true);
    assert.equal(byId[2].statusText, 'Active 30m ago');
    assert.equal(byId[3].statusText, 'Active 3.0h ago');
    assert.equal(byId[4].status, 'warning');
    assert.equal(byId[4].statusText, '6.0h inactive');
    assert.equal(byId[5].status, 'danger');
    assert.equal(byId[5].statusText, 'Will close soon (9.0h inactive)');
    assert.equal(byId[6].statusText, 'Protected (Chrome page)');
    assert.equal(byId[7].statusText, 'Protected (Pinned)');
    assert.equal(byId[8].statusText, 'Protected (Playing audio)');
    assert.equal(byId[8].status, 'safe');
    assert.equal(byId[9].statusText, 'Not tracked yet');
    assert.equal(byId[9].inactiveTime, 0);
  });

  it('returns an empty list when tabs cannot be read', async () => {
    const bg = await started({});
    failOnce(bg.chrome.tabs, 'query');

    assert.deepEqual(await bg.sendMessage({ action: 'getTabsData' }), { tabsData: [] });
  });
});

describe('badge', () => {
  async function badgeColorFor(tabCount, local = {}) {
    const tabs = Array.from({ length: tabCount }, (_, n) => ({ id: n + 1, active: n === 0 }));
    const bg = await started({ tabs, local });
    await bg.idle();
    return bg.chrome._badge.color;
  }

  it('is green normally, orange above 50 tabs, red above 100, yellow when paused', async () => {
    assert.equal(await badgeColorFor(3), '#4CAF50');
    assert.equal(await badgeColorFor(51), '#FF9800');
    assert.equal(await badgeColorFor(101), '#F44336');
    assert.equal(await badgeColorFor(3, { cleaningPaused: true }), '#ffc107');
  });

  it('shows ? when the badge cannot be updated', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.action, 'setBadgeBackgroundColor');

    await bg.chrome.tabs.onCreated.fire({ id: 2 });

    assert.equal(bg.chrome._badge.text, '?');
    assert.equal(bg.errors[0][0], 'Error updating badge:');
  });

  it('logs when the fallback badge fails too', async () => {
    const bg = await started({ tabs: [{ id: 1, active: true }] });
    failOnce(bg.chrome.action, 'setBadgeBackgroundColor');
    failOnce(bg.chrome.action, 'setBadgeText', { sync: true, when: ({ text }) => text === '?' });

    await bg.chrome.tabs.onCreated.fire({ id: 2 });

    assert.deepEqual(bg.errors.map(([message]) => message), ['Error updating badge:', 'Fallback badge update also failed:']);
  });
});
