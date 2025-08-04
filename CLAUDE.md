# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tab Cleaner is a Chrome extension (Manifest V3) that automatically closes inactive tabs to improve browser performance. The extension tracks tab activity, provides usage statistics, and allows users to configure cleanup behavior.

## Development Commands

This is a browser extension project with no build system - files are loaded directly by Chrome:

```bash
# Load extension for development
# 1. Open chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select the project directory

# No build, test, or lint commands - this is a simple JavaScript extension
```

## Architecture

### Core Components

- **background.js**: Service worker that handles:
  - Tab activity tracking in `tabActivity` object
  - Settings management with defaults (60min inactive, 5min checks)
  - Periodic cleanup via Chrome alarms API
  - Badge count updates and keepalive functionality
  - Tab lifecycle event listeners (created, activated, updated, removed)

- **popup.js/popup.html**: Statistics popup showing:
  - Current tab counts and window information
  - All-time statistics (tabs removed, max concurrent)
  - Manual refresh and options access

- **options.js/options.html**: Settings page with:
  - Inactive time configuration (hours)
  - Check interval settings (1-60 minutes)
  - Tab protection options (pinned, audio tabs)
  - Live tab monitoring with manual close buttons

### Key Data Structures

- `tabActivity`: Maps tab IDs to last activity timestamps
- `tabVisitHistory`: Tracks tab visit patterns
- `settings`: Configuration object with inactive time, intervals, and protection flags

### Chrome Extension APIs Used

- `chrome.tabs`: Tab management and monitoring
- `chrome.storage.sync`: Settings persistence
- `chrome.alarms`: Periodic cleanup scheduling
- `chrome.action`: Badge updates and popup

### Tab Management Logic

- Tracks all tab lifecycle events (create, activate, update, remove)
- Estimates activity for new tabs based on extension install time
- Protects pinned tabs and audio-playing tabs based on settings
- Uses Chrome alarms for reliable background processing
- Implements keepalive mechanism for service worker persistence

## File Structure

```
├── manifest.json       # Extension configuration (v3)
├── background.js       # Service worker (main logic)
├── popup.html/js       # Statistics popup
├── options.html/js     # Settings page
└── icons/             # Extension icons (16, 32, 48, 128px)
```

## Development Notes

- No external dependencies or build tools
- Uses vanilla JavaScript with Chrome Extension APIs
- Settings are stored using chrome.storage.sync
- All tab activity data remains local to browser
- Service worker uses keepalive pattern for reliability
