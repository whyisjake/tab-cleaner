# Tab Cleaner

[![Publish to Chrome Web Store](https://github.com/whyisjake/tab-cleaner/actions/workflows/publish-extension.yml/badge.svg)](https://github.com/whyisjake/tab-cleaner/actions/workflows/publish-extension.yml)
[![Tests](https://github.com/whyisjake/tab-cleaner/actions/workflows/test.yml/badge.svg)](https://github.com/whyisjake/tab-cleaner/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/whyisjake/tab-cleaner/graph/badge.svg)](https://codecov.io/gh/whyisjake/tab-cleaner)

A Chrome extension that automatically closes inactive tabs to keep your browser clean, fast, and organized.

**[📖 Read the launch blog post →](https://jakespurlock.com/2025/07/introducing-tab-cleaner-automatic-tab-management-for-chrome/)**

## Features

### 🧹 **Automatic Tab Cleanup**
- Automatically closes tabs that have been inactive for a specified time
- Configurable timeout from 1 hour to any number of hours
- Smart protection for pinned tabs, active tabs, and tabs playing audio
- Customizable check intervals (1-60 minutes)

### 📊 **Tab Activity Monitoring**
- Real-time tab activity tracking
- Visual status indicators (safe/warning/danger)
- Detailed activity timestamps showing when tabs were last used
- Persistent activity history across browser sessions

### 📈 **Usage Statistics**
- Live tab count badge on extension icon
- Comprehensive statistics popup showing:
  - Number of open windows and tabs
  - Current window tab details
  - All-time tabs removed count
  - Maximum concurrent tabs reached
- Color-coded badge (green/orange/red) based on tab count

### ⚙️ **Advanced Settings**
- Customizable inactive time threshold (hours)
- Adjustable cleanup check frequency (minutes)
- Options to protect pinned tabs and tabs playing audio
- Manual tab management with close buttons
- Statistics reset functionality

### 🎯 **Smart Tab Management**
- Never closes the currently active tab
- Protects Chrome internal pages (chrome://)
- Respects user preferences for pinned and audio tabs
- Graceful error handling and user feedback

## Installation

### From Chrome Web Store (Recommended)
1. Visit the [Tab Cleaner Chrome Web Store page](link-to-store-page)
2. Click "Add to Chrome"
3. Click "Add extension" in the confirmation dialog
4. The extension will appear in your toolbar with a tab count badge

### Manual Installation (Development)
1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked"
5. Select the folder containing the extension files
6. The extension will be loaded and ready to use

## Usage

### Quick Start
1. **Install the extension** - it starts working immediately with default settings
2. **View statistics** - click the extension icon to see your tab usage
3. **Customize settings** - right-click the icon and select "Options" to configure

### Default Behavior
- Closes tabs inactive for **1 hour**
- Checks for inactive tabs every **5 minutes**
- Protects **pinned tabs** and **tabs playing audio**
- Shows **tab count badge** on the extension icon

### Customization
**Open Settings:** Right-click extension icon → Options

- **Inactive Time**: Set how long tabs can be inactive before closing (minimum 1 hour)
- **Check Interval**: How often to scan for inactive tabs (1-60 minutes)
- **Protection Options**: Choose what types of tabs to never close
- **Tab Monitoring**: View and manually close specific tabs
- **Statistics**: View detailed usage statistics and reset data

### Tab Activity Monitor
The options page includes a comprehensive tab list showing:
- **Tab titles and URLs** with visual indicators
- **Activity status** (when last active)
- **Protection status** (pinned, playing audio, etc.)
- **Manual close buttons** for immediate tab management
- **Color-coded warnings** for tabs about to be closed

## Privacy & Permissions

### Required Permissions
- **`tabs`**: Read tab information and close inactive tabs
- **`storage`**: Save user preferences and activity data
- **`alarms`**: Schedule periodic cleanup checks

### Privacy Policy
Tab Cleaner respects your privacy:
- ✅ **All data stays local** - nothing is sent to external servers
- ✅ **No tracking** - we don't collect personal information
- ✅ **No analytics** - no usage data is transmitted
- ✅ **Open source** - code is transparent and auditable

**Data Storage:**
- Tab activity timestamps (local storage only)
- User preferences (local storage only)
- Usage statistics (local storage only)
- No browsing history or personal data is collected

## Technical Details

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Background**: Service worker with keepalive for reliability
- **Storage**: Chrome's local storage API for persistence
- **Permissions**: Minimal required permissions only

## Troubleshooting

### Extension Not Working
1. **Reload the extension**: Go to `chrome://extensions/` and click the reload button
2. **Check settings**: Ensure inactive time is set appropriately
3. **Verify permissions**: Make sure the extension has tab access

### Badge Not Showing
1. **Reload the extension** completely
2. **Check Chrome theme**: Some themes may hide badges
3. **Open popup**: Click the extension icon to refresh statistics

### Tabs Not Closing
1. **Check protection settings**: Pinned/audio tabs may be protected
2. **Verify inactive time**: Tabs must exceed the threshold
3. **Review tab activity**: Use the monitor to see activity status

## Support

For issues, feature requests, or questions:
- **GitHub Issues**: [Report a bug or request a feature](https://github.com/whyisjake/tab-cleaner/issues)
- **Chrome Web Store**: Leave a review and feedback
- **Email**: whyisjake@gmail.com

## Development

### Building from Source
```bash
git clone https://github.com/whyisjake/tab-cleaner.git
cd tab-cleaner
# Load unpacked extension in Chrome
```

### File Structure
```
tab-cleaner/
├── manifest.json       # Extension configuration
├── background.js       # Service worker logic
├── popup.html          # Statistics popup
├── popup.js            # Popup functionality
├── options.html        # Settings page
├── options.js          # Settings functionality
├── ui.css              # Shared design tokens and components (light and dark)
├── popup.css           # Popup layout
├── options.css         # Settings page layout
├── icons/              # Extension icons and social link sprite (social.svg)
└── README.md           # This file
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

### Version 1.3.1
- **Fixed**: Restarting the browser reset every tab's inactive time, so with a long limit and a daily restart nothing was ever closed. Restored tabs now keep the inactive time they had before the restart

### Version 1.3.0
- **New**: Redesigned popup and settings page with a shared, modern look
- **New**: Dark mode that follows your system setting
- **New**: Links to the author's GitHub, X, Instagram, Facebook and website in the popup and settings page
- **Improved**: Pinned, audio and active markers in the tab monitor stay visible on long titles
- **Fixed**: Refreshing the popup no longer leaves the recently closed list showing under the loading or error message

### Version 1.2.2
- **Improved**: The store package now contains only the files the extension loads (10 files, about 24 KB, down from 40 files and about 800 KB)

### Version 1.2.1
- **Fixed**: The "Close tabs after" setting was ignored once the browser restarted the background service worker, so tabs closed after the 1-hour default instead
- **Fixed**: Tabs restored after a browser restart are now closed once they pass the inactive limit; before, they stayed open until you visited them
- **Fixed**: Overlapping service worker startups no longer overwrite fresh tab activity
- **Improved**: Settings changes apply immediately without waiting for the next check

### Version 1.2.0
- **Fixed**: Tab Activity Monitor now shows accurate activity times instead of misleading "0m ago" for all tabs
- **Improved**: Newly discovered tabs show "Tracking started" until first genuine activity
- **Improved**: Better handling of tabs without tracking data with clear "Not tracked yet" status
- **Enhanced**: More reliable tab activity tracking prevents premature closure of newly discovered tabs

### Version 1.1.0
- **Added**: Pause/Resume functionality - Users can pause tab cleanup from the popup
- **Added**: Visual pause indicators - Badge turns yellow when paused, button updates accordingly
- **Added**: Code formatting with Prettier - Consistent code style across the project
- **Added**: Recently closed tabs feature - View and reopen recently closed tabs from popup
- **Improved**: Enhanced popup UI with pause controls and recently closed tabs section
- **Improved**: Tab management system now tracks both auto-closed and manually closed tabs
- **Fixed**: Console.log statements are now properly removed in production builds

### Version 1.0.7
- **Improved**: Production builds now automatically remove console.log statements
- **Enhanced**: Cleaner Chrome Web Store releases with optimized JavaScript

### Version 1.0.6
- **Added**: GitHub Actions workflow for automated Chrome Web Store publishing
- **Added**: Automated GitHub releases with version tags
- **Improved**: Development and deployment workflow automation

### Version 1.0.5
- **Added**: Comprehensive build system with package management
- **Added**: Chrome Web Store automation scripts
- **Improved**: Development tooling and validation

### Version 1.0.4
- **Added**: Recently closed tabs restoration feature
- **Improved**: Tab management functionality

### Version 1.0.1
- **Fixed**: Tab activity tracking now properly monitors all open tabs
- **Fixed**: Improved tab cleanup timing accuracy
- **Fixed**: Enhanced persistence of activity data across browser sessions
- **Added**: Twitter link in popup and options pages
- **Improved**: More reliable service worker background processing

### Version 1.0.0
- Initial release
- Automatic tab cleanup functionality
- Real-time activity monitoring
- Statistics tracking and display
- Customizable settings and preferences
- Manual tab management tools

---

**Made with ❤️ for productivity and browser performance**
