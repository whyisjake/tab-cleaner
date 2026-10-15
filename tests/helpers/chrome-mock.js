// Minimal in-memory stand-in for the Chrome extension APIs background.js uses.
// Events never fire on their own (e.g. tabs.remove does not fire onRemoved);
// tests fire them explicitly so every step of a scenario is visible.

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    fire(...args) {
      return Promise.all(listeners.map(listener => listener(...args)));
    }
  };
}

function createStorageArea(areaName, data, onChanged) {
  return {
    data,
    async get(keys) {
      if (keys === null || keys === undefined) {
        return { ...data };
      }
      if (typeof keys === 'string') {
        keys = [keys];
      }
      if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(key => {
          if (key in data) {
            result[key] = data[key];
          }
        });
        return result;
      }
      // Object form: keys with defaults
      const result = {};
      Object.entries(keys).forEach(([key, fallback]) => {
        result[key] = key in data ? data[key] : fallback;
      });
      return result;
    },
    async set(items) {
      const changes = {};
      Object.entries(items).forEach(([key, newValue]) => {
        changes[key] = { oldValue: data[key], newValue };
        data[key] = newValue;
      });
      await onChanged.fire(changes, areaName);
    }
  };
}

function createChrome({ sync = {}, local = {}, tabs = [] } = {}) {
  const onChanged = createEvent();
  let nextTabId = 1000;

  const matchesQuery = (tab, query) => {
    if (query.active !== undefined && tab.active !== query.active) {
      return false;
    }
    if (query.currentWindow && tab.windowId !== chrome._currentWindowId) {
      return false;
    }
    if (query.windowId !== undefined && tab.windowId !== query.windowId) {
      return false;
    }
    return true;
  };

  const chrome = {
    _currentWindowId: 1,
    _tabs: tabs.map(tab => ({
      windowId: 1,
      active: false,
      pinned: false,
      audible: false,
      title: `Tab ${tab.id}`,
      url: `https://example.com/${tab.id}`,
      ...tab
    })),
    _alarms: {},
    _badge: { text: undefined, color: undefined },
    _icons: [],

    runtime: {
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: createEvent(),
      onConnect: createEvent()
    },

    storage: {
      sync: createStorageArea('sync', sync, onChanged),
      local: createStorageArea('local', local, onChanged),
      onChanged
    },

    tabs: {
      async query(query = {}) {
        return chrome._tabs.filter(tab => matchesQuery(tab, query)).map(tab => ({ ...tab }));
      },
      async get(tabId) {
        const tab = chrome._tabs.find(t => t.id === tabId);
        if (!tab) {
          throw new Error(`No tab with id: ${tabId}`);
        }
        return { ...tab };
      },
      async remove(tabId) {
        const index = chrome._tabs.findIndex(t => t.id === tabId);
        if (index === -1) {
          throw new Error(`No tab with id: ${tabId}`);
        }
        chrome._tabs.splice(index, 1);
      },
      async create({ url, windowId = chrome._currentWindowId }) {
        const tab = {
          id: nextTabId++,
          windowId,
          active: false,
          pinned: false,
          audible: false,
          title: url,
          url
        };
        chrome._tabs.push(tab);
        return { ...tab };
      },
      onActivated: createEvent(),
      onUpdated: createEvent(),
      onCreated: createEvent(),
      onRemoved: createEvent()
    },

    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: createEvent()
    },

    alarms: {
      create(name, info) {
        chrome._alarms[name] = info;
      },
      async clear(name) {
        const existed = name in chrome._alarms;
        delete chrome._alarms[name];
        return existed;
      },
      onAlarm: createEvent()
    },

    action: {
      async setBadgeText({ text }) {
        chrome._badge.text = text;
      },
      async setBadgeBackgroundColor({ color }) {
        chrome._badge.color = color;
      },
      setIcon({ path }) {
        chrome._icons.push(path);
      }
    }
  };

  return chrome;
}

// Make obj[method] fail on its next call (or next call matching `when`),
// then pass calls through. Wrappers stack, so several failures can be queued
// on one method. `sync: true` throws instead of returning a rejection.
function failOnce(obj, method, { sync = false, when = () => true, message = `${method} failed` } = {}) {
  const original = obj[method];
  let spent = false;
  obj[method] = function (...args) {
    if (spent || !when(...args)) {
      return original.apply(this, args);
    }
    spent = true;
    const error = new Error(message);
    if (sync) {
      throw error;
    }
    return Promise.reject(error);
  };
}

// Matches a storage.get/set call that touches `key`
function touchesKey(key) {
  return arg => {
    if (Array.isArray(arg)) {
      return arg.includes(key);
    }
    return arg !== null && typeof arg === 'object' && key in arg;
  };
}

module.exports = { createChrome, createEvent, failOnce, touchesKey };
