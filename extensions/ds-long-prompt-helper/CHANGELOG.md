# Changelog

All notable changes to Sellify™ AI Connector will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] - 2026-04-03

### Added
- **Grok AI Support** (grok.com)
  - Added platform detection for grok.com
  - Added Grok-specific input selectors to PLATFORM_SELECTORS
  - Supports both `?q=` query parameter and `#q=` hash fragment
  - Works with Grok's native query parameter handling

### Changed
- **Updated `content.js`**:
  - Added 'grok' to `detectPlatform()` function return types
  - Added Grok selectors to PLATFORM_SELECTORS registry
- **Updated `manifest.json`**:
  - Added `https://grok.com/*` to content_scripts matches
  - Updated description to include Grok in supported platforms list
- **Updated Documentation**:
  - `README.md` - Added Grok to all platform lists and examples
  - Updated host permissions justification to include grok.com
  - Updated summary and description to mention Grok

### Technical Details
- Grok uses `?q=` parameter (same as Gemini, ChatGPT, Perplexity)
- Extension supports both hash fragments and query params for Grok
- Platform count increased from 5 to 6 AI platforms

---

## [2.1.0] - 2026-03-05

### Added
- **Hash Fragment Support (#prompt= or #q=)** - Bypasses CloudFront/WAF restrictions
  - Hash fragments are never sent to the server, staying client-side only
  - Unlimited prompt length (browser limit ~2MB, far beyond practical use)
  - Perfect for Manus platform to avoid 403 errors
  - Works on all platforms: Gemini, ChatGPT, Claude, Perplexity, Manus
- **Storage API Transport Method** for advanced automation
  - `chrome.storage.local` support for programmatic prompt passing
  - Auto-expiring storage (5 minutes) for security
  - Auto-cleanup after successful injection
  - Platform validation support
  - Helper script (`storage-helper.js`) for external tools
- **Three Transport Methods** with automatic priority detection:
  1. Storage API (checked first)
  2. Hash fragments (checked second)
  3. Query parameters (fallback)
- **Perplexity Native Handling** - Skip injection for Perplexity as it natively handles `?q=` parameter
- **Correct Source Logging** - Accurately identifies prompt source (hash vs url vs storage)
- **Documentation Files**:
  - `HASH_FRAGMENT_GUIDE.md` - Complete hash fragment usage guide
  - `STORAGE_API_USAGE.md` - Complete storage API reference
  - `CWS_SUBMISSION_FIELDS.md` - Chrome Web Store submission guide
  - `support.html` - AI-crawlable support documentation
  - `privacy.html` - AI-crawlable privacy policy
  - `terms.html` - AI-crawlable terms of service
  - `index.html` - Auto-redirect landing page

### Changed
- **Updated `content.js`**:
  - Modified `getPromptFromUrl()` to prioritize hash fragments over query params
  - Added `getPromptFromStorage()` and `clearStoredPrompt()` functions
  - Updated `initialize()` to correctly detect prompt source (hash/url/storage)
  - Fixed warning logic to not warn for hash fragments (only for long query params)
  - Added Perplexity skip logic (native `?q=` handling)
- **Updated `manifest.json`**:
  - Added `"storage"` permission for Storage API support
  - Version bumped to 2.1.0
- **Updated `README.md`**:
  - Merged content from `HASH_FRAGMENT_GUIDE.md` and `STORAGE_API_USAGE.md`
  - Added comprehensive usage examples for all three transport methods
  - Added transport method comparison table
  - Updated Chrome Web Store listing fields for multi-platform support
  - Updated version history section
  - Updated single purpose description
  - Updated host permissions justification for all 5 platforms
  - Added storage permission justification

### Fixed
- **Misleading "Long URL prompt" Warning** - Fixed to only warn for long query params, not hash fragments
- **Source Detection** - Correctly identifies hash fragment usage vs query params vs storage

### Security
- Storage API prompts auto-expire after 5 minutes
- Storage auto-clears after successful injection
- No user data collection or transmission
- All processing happens locally in browser

---

## [2.0.0] - 2026-03-04

### Added
- **Multi-Platform Support** - Extended from Gemini-only to 5 AI platforms:
  - Google Gemini (gemini.google.com)
  - ChatGPT (chat.openai.com, chatgpt.com)
  - Claude (claude.ai)
  - Perplexity AI (perplexity.ai)
  - Manus AI (manus.im)
- **Platform Detection System** - Automatic platform identification via `detectPlatform()`
- **Selector Registry** - Platform-specific CSS selectors for input elements:
  - `PLATFORM_SELECTORS` object with ordered selector arrays per platform
  - Support for both `textarea` and `contenteditable` input types
- **Unified Input Injection** - Single `fillInput()` function for all platforms
  - Proper DOM event dispatching for React/Vue compatibility
  - Handles both textarea and contenteditable elements
- **SPA Navigation Handling** - Polling mechanism for dynamic page loads
  - 30 attempts with 500ms intervals
  - Early exit on success
  - Comprehensive error logging
- **Enhanced Logging** - Detailed console logs with `[Sellify Connector]` prefix
  - Platform detection logs
  - Prompt source and length logs
  - Input element detection logs
  - Success/failure logs

### Changed
- **Rebranded** from "Sellify Gemini Connector" to "Sellify™ AI Connector"
- **Updated `manifest.json`**:
  - Changed name to "Sellify™ AI Connector"
  - Updated description for multi-platform support
  - Changed `matches` from Gemini-only to `<all_urls>` for all platforms
  - Version bumped to 2.0.0
- **Refactored `content.js`**:
  - Added platform detection logic
  - Implemented selector registry system
  - Created unified input injection mechanism
  - Added input type detection
  - Improved error handling and logging
- **Updated Documentation**:
  - `README.md` - Multi-platform examples and features
  - `support.html` - Multi-platform support documentation
  - `privacy.html` - Updated for multi-platform access
  - `terms.html` - Updated for multi-platform usage

### Removed
- Gemini-specific hardcoded selectors
- Single-platform limitations

---

## [1.0.0] - 2026-03-03

### Added
- **Initial Release** - Sellify Gemini Connector
- **URL Parameter Support** - Auto-prefill Gemini prompts via `?prompt=` or `?q=`
- **Gemini Integration** - Works with gemini.google.com
- **Content Script** - Automatic prompt injection on page load
- **Multi-line Prompt Support** - Handles complex prompts with proper formatting
- **SPA Compatibility** - Polling mechanism for dynamic page loads
- **Basic Error Handling** - Console logging for debugging
- **Sellify Branding** - Custom icons and branding
- **Chrome Extension Icons** - 16x16, 48x48, 128x128 sizes
- **Documentation**:
  - `README.md` - Chrome Web Store listing information
  - Basic usage instructions

### Technical Details
- Manifest V3 compliance
- Content script runs at `document_idle`
- Support for both `?prompt=` and `?q=` parameters
- URL decoding for encoded prompts
- Gemini-specific contenteditable input detection

---

## Version Comparison

| Version | Platforms | Transport Methods | Key Feature |
|---------|-----------|-------------------|-------------|
| **2.1.0** | 5 platforms | Hash + Query + Storage | Hash fragments bypass CloudFront |
| **2.0.0** | 5 platforms | Query params only | Multi-platform support |
| **1.0.0** | Gemini only | Query params only | Initial release |

---

## Upgrade Notes

### From 2.0.0 to 2.1.0
- **Recommended:** Switch to hash fragments (#) for all prompts, especially on Manus
- Storage API available for automation workflows
- Perplexity now skips injection (uses native `?q=` handling)
- No breaking changes - all existing URLs still work

### From 1.0.0 to 2.0.0
- Extension now works on 5 platforms instead of just Gemini
- No breaking changes - existing Gemini URLs still work
- New platforms automatically supported

---

## Support

**Website:** https://sellify.ph  
**Email:** support@sellify.ph  
**Extension Name:** Sellify™ AI Connector  
**Developer:** Sellify.ph

---

## License

© 2026 Sellify.ph. All rights reserved.
