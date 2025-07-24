# Tab Cleaner

A Chrome extension that automatically closes inactive tabs to keep your browser clean, fast, and organized.

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
├── popup.html         # Statistics popup
├── popup.js          # Popup functionality
├── options.html      # Settings page
├── options.js       # Settings functionality
├── icons/          # Extension icons
└── README.md      # This file
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

### Version 1.0.0
- Initial release
- Automatic tab cleanup functionality
- Real-time activity monitoring
- Statistics tracking and display
- Customizable settings and preferences
- Manual tab management tools

---

**Made with ❤️ for productivity and browser performance**
