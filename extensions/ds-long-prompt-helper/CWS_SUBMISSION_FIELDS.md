# Chrome Web Store Submission - Complete Field Guide

**Extension:** Sellify™ AI Connector v2.1.0  
**Date:** March 5, 2026

---

## 📋 SECTION 1: PRODUCT DETAILS

### 1.1 Extension Name
```
Sellify™ AI Connector
```
**Character limit:** 45 characters  
**Current count:** 24 characters ✅

---

### 1.2 Summary (Short Description)
```
Auto-prefill AI prompts on Gemini, ChatGPT, Claude, Perplexity, Manus, Grok via hash/query/storage methods.
```
**Character limit:** 132 characters  
**Current count:** 110 characters ✅

---

### 1.3 Detailed Description
```
Sellify™ AI Connector v2.2.0 streamlines your workflow by automatically prefilling AI chat prompts across multiple platforms. Works with Google Gemini, ChatGPT, Claude, Perplexity, Manus, and Grok. Perfect for automation, testing, and rapid prototyping.

🚀 KEY FEATURES:
• Multi-platform support: Gemini, ChatGPT, Claude, Perplexity, Manus, Grok
• Three transport methods: Hash fragments (#) + Query params (?) + Storage API
• Hash fragments bypass CloudFront/WAF - unlimited prompt length (RECOMMENDED)
• No 403 errors on Manus platform (hash never sent to server)
• Handles prompts of any length - no URL limitations
• Supports multi-line prompts with proper formatting
• No manual copy-paste needed
• Perfect for workflow automation and API integrations
• Works seamlessly with SPA (Single Page Application) architectures
• Auto-expiring storage (5 minutes) for security
• Platform-specific input detection (textarea & contenteditable)

💡 HOW TO USE:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METHOD 1 - Hash Fragments (⭐ RECOMMENDED)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use # instead of ? to bypass CloudFront/WAF restrictions.
Hash fragments are NEVER sent to the server - they stay in the browser!

✅ Best for: Long prompts, Manus platform, any length prompts
✅ Max length: Unlimited (browser limit ~2MB, far beyond practical use)
✅ Bypasses: CloudFront/WAF blocks, server-side URL length limits
✅ Shareable: Yes, URLs work normally

Examples:

Manus (recommended for all prompts):
https://manus.im/app/#prompt=Your+very+long+prompt+here

Gemini:
https://gemini.google.com/#q=Your+prompt+here

ChatGPT:
https://chat.openai.com/#prompt=Your+prompt+here

Claude:
https://claude.ai/#q=Your+prompt+here

Perplexity:
https://www.perplexity.ai/#prompt=Your+prompt+here

Why it works:
❌ Query Params:  https://manus.im/app/?prompt=LONG_TEXT
   → CloudFront sees full URL → 403 BLOCKED

✅ Hash Fragment:  https://manus.im/app/#prompt=LONG_TEXT
   → CloudFront only sees /app/ → 200 OK
   → Hash stays in browser → Extension reads it → Success!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METHOD 2 - Query Parameters (Traditional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Traditional method using ? in URL.

✅ Best for: Short prompts (<2000 chars), backward compatibility
⚠️ Limitations: URL length limits, CloudFront may block long URLs on Manus
✅ Shareable: Yes

Examples:
https://gemini.google.com/?q=Your+prompt+here
https://chat.openai.com/?q=Your+prompt+here
https://claude.ai/?prompt=Your+prompt+here

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METHOD 3 - Storage API (Advanced Automation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For programmatic access from external tools, bookmarklets, or Chrome extensions.

✅ Best for: Automation workflows, external tool integration
✅ Max length: Unlimited
⚠️ Requires: Extension installed, chrome.storage API access
❌ Shareable: No (requires programmatic setup)

The extension automatically:
✓ Detects the AI platform
✓ Checks storage first, then hash, then query params
✓ Finds the correct input element (textarea or contenteditable)
✓ Injects the prompt with proper DOM events
✓ Clears storage after successful injection

🔧 USE CASES:
• Automate repetitive AI queries across multiple platforms
• Create shareable prompt links for teams
• Integrate with external tools and workflows
• Speed up testing and development
• Build custom automation scripts
• Share complex, multi-line prompts via simple URLs
• Bypass URL length limitations for long prompts

✨ POWERED BY SELLIFY:
This extension is brought to you by Sellify.ph, your trusted partner for e-commerce and workflow automation solutions.

🔒 PRIVACY:
This extension does not collect, store, or transmit any user data. It only reads URL parameters and interacts with AI platform input boxes locally in your browser. You must be logged in to each platform for the extension to work.

📧 SUPPORT:
For questions, feature requests, or support, visit https://sellify.ph/support or contact support@sellify.ph
```
**Character limit:** 16,000 characters  
**Current count:** ~4,200 characters ✅

---

### 1.4 Category
**Select:** `Productivity`  
**Alternative:** `Developer Tools`

---

### 1.5 Language
**Select:** `English (United States)`

---

### 1.6 Official URL (Optional)
```
https://sellify.ph
```

---

### 1.7 Homepage URL (Optional)
```
https://sellify.ph
```

---

### 1.8 Support URL (Optional)
```
https://sellify.ph/support
```
**Alternative:** `mailto:support@sellify.ph`

---

## 📸 SECTION 2: GRAPHIC ASSETS

### 2.1 Store Icon (Required)
- **File:** `icons/sellify-128.png`
- **Size:** 128x128 pixels
- **Format:** PNG with transparency or JPEG
- **Note:** Must match extension branding

---

### 2.2 Screenshots (Required - at least 1, up to 5)
- **Size:** 1280x800 or 640x400 pixels
- **Format:** JPEG or 24-bit PNG (no alpha channel)

**Recommended screenshots:**
1. Extension in action on Gemini with hash fragment URL visible
2. Extension in action on ChatGPT
3. Extension in action on Manus with long prompt
4. Extension in action on Claude
5. Before/after comparison or multi-platform showcase

---

### 2.3 Small Promo Tile (Optional)
- **Size:** 440x280 pixels
- **Format:** JPEG or 24-bit PNG (no alpha)

---

### 2.4 Marquee Promo Tile (Optional)
- **Size:** 1400x560 pixels
- **Format:** JPEG or 24-bit PNG (no alpha)

---

## 🔒 SECTION 3: PRIVACY PRACTICES

### 3.1 Single Purpose Description
```
This extension automatically prefills AI chat prompts across multiple platforms (Gemini, ChatGPT, Claude, Perplexity, Manus) using URL hash fragments, query parameters, or storage API. It enables users to share pre-configured prompts via URLs for workflow automation and faster testing.
```
**Character limit:** 1,000 characters  
**Current count:** 295 characters ✅

---

### 3.2 Permission Justifications

#### Host Permissions Justification
```
This extension requires access to multiple AI platform domains to:

1. Detect when the user visits AI platforms with URL parameters or hash fragments
2. Read #prompt=, #q=, ?prompt=, or ?q= from the URL
3. Check chrome.storage for pending prompts (for long prompts)
4. Locate platform-specific input elements (textarea or contenteditable)
5. Automatically prefill the prompt text into the input field

Required domains:
• gemini.google.com - Google Gemini
• chat.openai.com, chatgpt.com - ChatGPT
• claude.ai - Anthropic Claude
• perplexity.ai - Perplexity AI
• manus.im - Manus AI

The extension only runs on these AI platforms and does not make external network requests or access any other websites. All processing happens locally in the browser.
```
**Character limit:** 1,000 characters  
**Current count:** 698 characters ✅

---

#### Storage Permission Justification
```
The "storage" permission is required to:

1. Store pending prompts temporarily (max 5 minutes) for advanced automation workflows
2. Enable external tools and scripts to send long prompts that exceed URL length limits
3. Bypass CloudFront/WAF restrictions on platforms like Manus

Storage usage:
• Only stores prompt text, target platform, and timestamp
• Auto-expires after 5 minutes
• Auto-clears after successful injection
• No user data or analytics stored
• All data stays local in the browser

This permission enables the Storage API transport method for automation tools while maintaining user privacy.
```
**Character limit:** 1,000 characters  
**Current count:** 598 characters ✅

---

### 3.3 Remote Code Usage

**Question:** Are you using remote code?  
**Answer:** `No, I am not using Remote code`

**Justification:**
```
This extension does not use any remote code. All JavaScript is contained within the extension package (content.js and storage-helper.js). There are no external script references, no eval() calls, no dynamic imports from external sources, and no WebAssembly modules. The extension is completely self-contained.
```
**Character limit:** 1,000 characters  
**Current count:** 320 characters ✅

---

### 3.4 Data Collection Disclosure

**Question:** What user data do you plan to collect from users now or in the future?

**Answer:** Select **NONE** of the following checkboxes:
- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Authentication information
- [ ] Personal communications
- [ ] Location
- [ ] Web history
- [ ] User activity
- [ ] Website content

**Explanation:**
```
This extension does NOT collect, store, or transmit any user data. It only:
• Reads URL parameters and hash fragments locally in the browser
• Interacts with the DOM to prefill input boxes
• Temporarily stores prompts in chrome.storage.local (auto-expires in 5 minutes)
• All processing happens locally on the user's device
• No data is sent to external servers
• No analytics or tracking is implemented
```

---

### 3.5 Required Certifications

**Check ALL three boxes:**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

### 3.6 Privacy Policy URL (Required)
```
https://sellify.ph/privacy
```

**⚠️ IMPORTANT:** You must create a privacy policy page at this URL before submission.

**Privacy Policy Template:**

```markdown
# Privacy Policy for Sellify™ AI Connector

**Last Updated:** March 5, 2026

## Overview
Sellify™ AI Connector ("the Extension") is a Chrome browser extension that automatically prefills AI chat prompts across multiple platforms (Gemini, ChatGPT, Claude, Perplexity, Manus) using URL parameters, hash fragments, or storage API.

## Data Collection
**We do NOT collect any user data.**

The Extension:
- Does NOT collect personal information
- Does NOT track user behavior
- Does NOT store any data permanently
- Does NOT use cookies or analytics
- Does NOT transmit any information to external servers

## How the Extension Works
The Extension only:
1. Reads URL parameters (?prompt= or ?q=) or hash fragments (#prompt= or #q=) from the current page URL
2. Checks chrome.storage.local for pending prompts (auto-expires after 5 minutes)
3. Locates platform-specific input boxes on supported AI platforms
4. Prefills the input box with the prompt text
5. All processing happens locally in your browser

## Temporary Storage
The Extension may temporarily store prompts in chrome.storage.local for:
- Advanced automation workflows
- Bypassing URL length limitations
- Storage auto-expires after 5 minutes
- Storage is cleared after successful injection
- No user data or analytics are stored

## Permissions
The Extension requires access to the following domains:
- gemini.google.com - Google Gemini
- chat.openai.com, chatgpt.com - ChatGPT
- claude.ai - Anthropic Claude
- perplexity.ai - Perplexity AI
- manus.im - Manus AI

The Extension also requires the "storage" permission to enable the Storage API transport method for automation workflows.

No other websites or domains are accessed.

## Third-Party Services
The Extension does not integrate with, communicate with, or share data with any third-party services. It only interacts with the AI platforms you visit directly.

## Data Security
Since no data is collected, stored permanently, or transmitted, there are no data security concerns related to user information.

## Children's Privacy
The Extension does not knowingly collect information from children under 13 years of age.

## Changes to This Policy
We may update this privacy policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact
For questions about this privacy policy, contact:
- Email: support@sellify.ph
- Website: https://sellify.ph

## Developer
Sellify™ AI Connector is developed and maintained by Sellify.ph.
```

---

## 🌍 SECTION 4: DISTRIBUTION

### 4.1 Visibility
**Select:** `Public`  
**Alternative for testing:** `Unlisted` (then switch to Public after verification)

---

### 4.2 Regions
**Select:** `All regions`  
**Alternative:** Select specific countries if you want to limit distribution

---

### 4.3 Pricing
**Select:** `Free`

---

### 4.4 Mature Content
**Select:** `No mature content`

**Explanation:** This extension does not contain sexual content, violence, strong language, or drug/alcohol references.

---

## ✅ PRE-SUBMISSION CHECKLIST

Before submitting, verify:

- [ ] **manifest.json** is valid (version 2.1.0)
- [ ] **Description** is under 132 characters for summary
- [ ] **All icons** present (16x16, 48x48, 128x128)
- [ ] **Extension tested** locally in Chrome
- [ ] **At least 1 screenshot** prepared (1280x800 or 640x400)
- [ ] **Store icon** ready (128x128)
- [ ] **Privacy policy** page created at https://sellify.ph/privacy
- [ ] **Category** selected (Productivity)
- [ ] **Homepage URL** added
- [ ] **Support URL** added
- [ ] **Privacy practices** declared (NO data collection)
- [ ] **All certifications** checked
- [ ] **Visibility** set to Public or Unlisted
- [ ] **Extension packaged** as .zip file (without key field in manifest)

---

## 📦 PACKAGING INSTRUCTIONS

### Remove the "key" field from manifest.json before packaging:

1. Open `manifest.json`
2. Remove the `"key"` field if present
3. Save the file
4. Create a ZIP file containing:
   - `manifest.json`
   - `content.js`
   - `icons/` folder (with all icon files)
   - `storage-helper.js`
   - Any other extension files

**Do NOT include:**
- `README.md`
- `HASH_FRAGMENT_GUIDE.md`
- `STORAGE_API_USAGE.md`
- `CWS_SUBMISSION_FIELDS.md` (this file)
- `.git` folder
- Any development files

---

## 📧 POST-SUBMISSION

After submission, Chrome Web Store review typically takes:
- **Initial review:** 1-3 business days
- **Updates:** Usually faster (few hours to 1 day)

You'll receive email notifications about review status at the email associated with your Chrome Web Store Developer account.

---

## 🆘 SUPPORT

**Developer:** Sellify.ph  
**Email:** support@sellify.ph  
**Website:** https://sellify.ph  
**Extension Version:** 2.1.0  
**Submission Date:** March 5, 2026

---

**Good luck with your submission! 🚀**
