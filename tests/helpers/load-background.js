// Loads a fresh copy of background.js into its own V8 context with a mocked
// `chrome`, simulating one service worker lifetime. Passing the real filename
// lets `node --test --experimental-test-coverage` attribute coverage to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createChrome } = require('./chrome-mock');

const BACKGROUND_PATH = path.join(__dirname, '..', '..', 'background.js');
const source = fs.readFileSync(BACKGROUND_PATH, 'utf8');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function loadBackground(options = {}) {
  const chrome = options.chrome || createChrome(options);
  const timers = [];
  const errors = [];

  const context = vm.createContext({
    chrome,
    console: {
      log() {},
      warn() {},
      error(...args) {
        errors.push(args);
      }
    },
    // Captured so tests decide when the startup timer runs
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    }
  });

  vm.runInContext(source, context, { filename: BACKGROUND_PATH });

  const bg = {
    chrome,
    errors,
    timers,

    // Read a top-level binding (let/const/function) from the worker
    get(expression) {
      return vm.runInContext(expression, context);
    },

    // Results cross a realm boundary; normalize for deepStrictEqual
    plain(value) {
      return JSON.parse(JSON.stringify(value));
    },

    tabIds() {
      return chrome._tabs.map(tab => tab.id);
    },

    async runTimers() {
      const pending = timers.splice(0);
      pending.forEach(({ callback }) => callback());
      await bg.idle();
    },

    // Let fire-and-forget promise chains inside the worker settle
    async idle() {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
    },

    // Also waits out work the listener doesn't await
    async alarm(name) {
      await chrome.alarms.onAlarm.fire({ name });
      await bg.idle();
    },

    async activate(tabId, windowId = chrome._currentWindowId) {
      chrome._tabs.forEach(tab => {
        if (tab.windowId === windowId) {
          tab.active = tab.id === tabId;
        }
      });
      await chrome.tabs.onActivated.fire({ tabId, windowId });
    },

    sendMessage(message) {
      return new Promise(resolve => {
        let returned;
        chrome.runtime.onMessage.listeners.forEach(listener => {
          returned = listener(message, {}, response => resolve(bg.plain(response)));
        });
        bg.lastMessageReturn = returned;
      });
    }
  };

  return bg;
}

module.exports = { loadBackground, MINUTE, HOUR };
