# Sellify™ AI Connector v2.1.0

> Automatically prefill AI chat prompts across multiple platforms using URL hash fragments, query parameters, or storage API.

## Chrome Web Store Listing

### Title
```
Sellify™ AI Connector
```

### Summary
```
Automatically prefill prompts on AI platforms (Gemini, ChatGPT, Claude, Perplexity, Manus, Grok) using hash fragments, query params, or storage API.
```

### Description
```
Sellify™ AI Connector v2.1.0 streamlines your workflow by automatically prefilling AI chat prompts across multiple platforms. Works with Google Gemini, ChatGPT, Claude, Perplexity, Manus, and Grok. Perfect for automation, testing, and rapid prototyping.

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
• Smart platform handling (Perplexity uses native ?q= support)

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

Grok:
https://grok.com/#q=Your+prompt+here

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
https://grok.com/?q=Your+prompt+here

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METHOD 3 - Storage API (Advanced Automation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For programmatic access from external tools, bookmarklets, or Chrome extensions.

✅ Best for: Automation workflows, external tool integration
✅ Max length: Unlimited
⚠️ Requires: Extension installed, chrome.storage API access
❌ Shareable: No (requires programmatic setup)

Option A - Using storage-helper.js:

// Load helper script
var script = document.createElement('script');
script.src = 'https://sellify.ph/storage-helper.js';
document.body.appendChild(script);

script.onload = function() {
    sendPromptToAI('manus', 'Your very long prompt here...');
};

Option B - Direct chrome.storage API:

chrome.storage.local.set({
    pendingPrompt: {
        text: 'Your prompt',
        platform: 'manus',
        timestamp: Date.now()
    }
}, () => {
    window.open('https://manus.im/app', '_blank');
});

Storage features:
• Platform validation (optional)
• Auto-expiration (5 minutes)
• Auto-cleanup after injection
• Fallback to clipboard if extension not available

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

### Category
```
Productivity
```
(Alternative: Developer Tools)

### Language
```
English (United States)
```

---

## Graphic Assets Requirements

### Store Icon
- **Size:** 128x128 pixels
- **Format:** PNG with transparency or JPEG
- **File:** Use your `sellify-128.png` icon
- **Note:** Should match your extension's branding

### Screenshots (Required - at least 1, up to 5)
- **Size:** 1280x800 or 640x400 pixels
- **Format:** JPEG or 24-bit PNG (no alpha)
- **Suggestions:**
  1. Screenshot showing the extension in action on Gemini
  2. Screenshot showing the extension in action on ChatGPT
  3. Screenshot showing the extension in action on Claude
  4. Screenshot showing the extension in action on Perplexity
  5. Screenshot showing the extension in action on Manus with a long prompt

### Small Promo Tile (Optional)
- **Size:** 440x280 pixels
- **Format:** JPEG or 24-bit PNG (no alpha)
- **Purpose:** Featured in Chrome Web Store promotions

### Marquee Promo Tile (Optional)
- **Size:** 1400x560 pixels
- **Format:** JPEG or 24-bit PNG (no alpha)
- **Purpose:** Large promotional banner for featured listings

---

## Additional Fields

### Official URL
```
https://sellify.ph
```
(Register this domain in Google Search Console if you own it)

### Homepage URL
```
https://sellify.ph
```
(Or create a dedicated landing page: https://sellify.ph/gemini-connector)

### Support URL
```
https://sellify.ph/support
```
(Or use: https://sellify.ph/contact or your support email as mailto:support@sellify.ph)

---

## Optional Fields

### Promo Video (YouTube)
If you create a demo video, upload to YouTube and add the URL here.
Example format: `https://www.youtube.com/watch?v=XXXXXXXXXXX`

**Video suggestions:**
- 30-60 second demo showing the extension in action
- Show URL parameter → auto-filled prompt workflow
- Highlight key use cases and benefits

---

## Visibility Settings

### Recommended Initial Setting
```
Public
```
(Or start with "Unlisted" for testing, then switch to "Public" after verification)

---

## Mature Content
```
No mature content
```
This extension does not contain sexual content, violence, strong language, or drug/alcohol references.

---

## Privacy Practice Disclosure

Since your extension:
- Does NOT collect user data
- Does NOT transmit data externally
- Only reads URL parameters locally

You should declare:
- **Data collection:** None
- **Data usage:** None
- **Data sharing:** None

---

## Chrome Web Store Privacy Requirements

### Single Purpose

**Single purpose description:**
```
This extension automatically prefills AI chat prompts across multiple platforms (Gemini, ChatGPT, Claude, Perplexity, Manus) using URL hash fragments, query parameters, or storage API. It enables users to share pre-configured prompts via URLs for workflow automation and faster testing.
```
(Character count: 295/1000)

---

### Permission Justification

**Host permission justification:**
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
• grok.com - Grok AI

The extension only runs on these AI platforms and does not make external network requests or access any other websites. All processing happens locally in the browser.
```
(Character count: 698/1000)

---

### Remote Code Usage

**Are you using remote code?**
```
No, I am not using Remote code
```

**Justification:**
```
This extension does not use any remote code. All JavaScript is contained within the extension package (content.js). There are no external script references, no eval() calls, no dynamic imports from external sources, and no WebAssembly modules. The extension is completely self-contained.
```
(Character count: 295/1000)

---

### Data Usage Disclosure

**What user data do you plan to collect from users now or in the future?**

Select **NONE** of the following checkboxes:
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
This extension does NOT collect, store, or transmit any user data. It only:
- Reads URL parameters locally in the browser
- Interacts with the DOM to prefill an input box
- All processing happens locally on the user's device
- No data is sent to external servers
- No analytics or tracking is implemented

---

### Required Certifications

**Check ALL three boxes:**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

### Privacy Policy

**Privacy policy URL:**
```
https://sellify.ph/privacy
```

**Note:** You must create a privacy policy page at this URL. Here's a template:

---

## Privacy Policy Template (for https://sellify.ph/privacy)

```markdown
# Privacy Policy for Sellify Gemini Connector

**Last Updated:** [Current Date]

## Overview
Sellify Gemini Connector ("the Extension") is a Chrome browser extension that automatically prefills Google Gemini's prompt input using URL parameters.

## Data Collection
**We do NOT collect any user data.**

The Extension:
- Does NOT collect personal information
- Does NOT track user behavior
- Does NOT store any data locally or remotely
- Does NOT use cookies or analytics
- Does NOT transmit any information to external servers

## How the Extension Works
The Extension only:
1. Reads URL parameters (?prompt= or ?q=) from the current page URL
2. Locates the Gemini input box on gemini.google.com
3. Prefills the input box with the URL parameter value
4. All processing happens locally in your browser

## Permissions
The Extension requires access to "https://gemini.google.com/*" to:
- Detect when you visit Google Gemini
- Read URL parameters
- Interact with the Gemini input box

No other websites or domains are accessed.

## Third-Party Services
The Extension does not integrate with, communicate with, or share data with any third-party services.

## Data Security
Since no data is collected, stored, or transmitted, there are no data security concerns related to user information.

## Children's Privacy
The Extension does not knowingly collect information from children under 13 years of age.

## Changes to This Policy
We may update this privacy policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact
For questions about this privacy policy, contact:
- Email: support@sellify.ph
- Website: https://sellify.ph

## Developer
Sellify Gemini Connector is developed and maintained by sellify.ph.
```

---

### Quick Privacy Form Checklist

When filling out the Chrome Web Store privacy form:

1. **Single Purpose:** Copy the single purpose description above
2. **Host Permission:** Copy the host permission justification above
3. **Remote Code:** Select "No" and copy the justification
4. **Data Collection:** Select NONE of the data types
5. **Certifications:** Check all three required boxes
6. **Privacy Policy URL:** Enter `https://sellify.ph/privacy` (after creating the page)

---

## Distribution Settings

### Regions
```
All regions
```
(Or select specific countries if you want to limit distribution)

### Pricing
```
Free
```

---

## Screenshot Ideas

### Screenshot 1: Main Feature Demo
Show Gemini page with URL bar visible containing:
`https://gemini.google.com/?q=Analyze+sales+data+for+Q4+2025`
And the prompt auto-filled in the input box.

### Screenshot 2: Use Case Example
Show a practical example like:
`https://gemini.google.com/?prompt=Write+a+product+description+for+an+eco-friendly+water+bottle`

### Screenshot 3: Before/After
Split screen showing manual typing vs. automatic prefill.

---

## Quick Checklist Before Submission

- [ ] manifest.json is valid and under 132 chars description
- [ ] All icons present (16, 48, 128)
- [ ] Extension tested locally in Chrome
- [ ] At least 1 screenshot prepared (1280x800 or 640x400)
- [ ] Store icon ready (128x128)
- [ ] Description filled out (up to 16,000 chars)
- [ ] Category selected (Productivity or Developer Tools)
- [ ] Homepage URL added
- [ ] Support URL added
- [ ] Privacy practices declared
- [ ] Visibility set to Public or Unlisted

---

## Post-Submission

After submission, Chrome Web Store review typically takes:
- **Initial review:** 1-3 business days
- **Updates:** Usually faster (few hours to 1 day)

---

## Version History

### v2.1.0 (Current - Hash Fragment & Storage API)
- ✅ Hash fragment support (#prompt= or #q=) - bypasses CloudFront/WAF
- ✅ Storage API transport for advanced automation
- ✅ Multi-platform support: Gemini, ChatGPT, Claude, Perplexity, Manus
- ✅ Three transport methods with automatic priority detection
- ✅ Correct source logging (hash vs url vs storage)
- ✅ Platform-specific input detection and injection
- ✅ Auto-expiring storage (5 minutes)
- ✅ No false warnings for hash fragment usage

### v2.0.0 (Multi-Platform Release)
- Multi-platform support added
- Platform detection system
- Selector registry for each platform
- Unified input injection mechanism

### v1.0.0 (Initial Release)
- Auto-prefill Gemini prompts via URL parameters
- Support for ?prompt= and ?q= parameters
- Sellify branding integration

---

## Transport Method Comparison

| Feature | Hash Fragment (#) | Query Param (?) | Storage API |
|---------|------------------|-----------------|-------------|
| **Max Length** | Unlimited* | ~2000 chars | Unlimited |
| **Manus Support** | ✅ Perfect | ❌ Blocked >2000 | ✅ Perfect |
| **CloudFront/WAF** | ✅ Bypassed | ❌ May block | ✅ Bypassed |
| **Setup Required** | None | None | Helper script |
| **Shareable URLs** | ✅ Yes | ✅ Yes | ❌ No |
| **Privacy** | Client-side only | Visible in URL | Local storage |
| **Best Use Case** | **Long prompts** | Short prompts | Automation |
| **Recommended For** | **Manus, all platforms** | Legacy support | External tools |

*Browser limit ~2MB for hash, far beyond practical prompt lengths

**Recommendation:** Use hash fragments (#) for all prompts, especially on Manus platform.

---

## Documentation Files

- **README.md** (this file) - Chrome Web Store listing and overview
- **HASH_FRAGMENT_GUIDE.md** - Detailed hash fragment usage and migration guide
- **STORAGE_API_USAGE.md** - Complete storage API reference and examples
- **storage-helper.js** - Helper library for external tools

---

## Support & Contact

**Website:** https://sellify.ph  
**Email:** support@sellify.ph  
**Extension Name:** Sellify™ AI Connector  
**Version:** 2.1.0  
**Developer:** sellify.ph
