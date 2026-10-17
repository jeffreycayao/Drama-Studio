# Storage API Usage Guide

## Overview

The Sellify™ AI Connector supports two methods for sending prompts to AI platforms:

1. **URL Parameters** (traditional) - Good for short prompts (<2000 chars)
2. **Storage API** (new) - Required for long prompts that exceed URL limits

## Why Storage API?

Some AI platforms (especially Manus) use CloudFront/WAF that blocks long URLs before the page even loads. The storage API bypasses this limitation by:

1. Storing the prompt in `chrome.storage.local`
2. Opening the AI platform with a clean URL (no query params)
3. Extension reads from storage and injects the prompt
4. Storage is cleared after successful injection

## Method 1: URL Parameters (Traditional)

**Best for:** Short prompts (<2000 characters)

### Usage:
```
https://gemini.google.com/?q=Your+prompt+here
https://chat.openai.com/?q=Your+prompt+here
https://claude.ai/?prompt=Your+prompt+here
https://www.perplexity.ai/?q=Your+prompt+here
https://manus.im/app?q=Your+prompt+here
```

**Limitations:**
- Browser URL limits (~2000-8000 chars depending on browser)
- CloudFront/WAF may block long URLs (Manus limit ~2000-2500 chars)
- Not suitable for complex, multi-line prompts

---

## Method 2: Storage API (Recommended for Long Prompts)

**Best for:** Long prompts (>2000 characters), complex prompts, Manus platform

### Option A: Using the Helper Script

Include `storage-helper.js` in your page or bookmarklet:

```javascript
// Load the helper
var script = document.createElement('script');
script.src = 'https://sellify.ph/storage-helper.js';
document.body.appendChild(script);

// Send a prompt to Manus
script.onload = function() {
    const longPrompt = `
        Conduct a comprehensive SEO audit of our website...
        [Your very long prompt here - no character limits!]
    `;
    
    sendPromptToAI('manus', longPrompt);
    // This will:
    // 1. Store the prompt in chrome.storage
    // 2. Open https://manus.im/app (clean URL)
    // 3. Extension injects the prompt automatically
};
```

### Option B: Direct Storage API Usage

If you're building a Chrome extension or have access to `chrome.storage`:

```javascript
// Store the prompt
chrome.storage.local.set({
    pendingPrompt: {
        text: "Your very long prompt here...",
        platform: "manus",  // Optional: 'gemini', 'chatgpt', 'claude', 'perplexity', 'manus'
        timestamp: Date.now()
    }
}, () => {
    console.log('Prompt stored');
    
    // Open the platform (clean URL, no query params)
    window.open('https://manus.im/app', '_blank');
});
```

### Option C: Bookmarklet

Create a bookmarklet that uses the storage API:

```javascript
javascript:(function(){
    var s=document.createElement('script');
    s.src='https://sellify.ph/storage-helper.js';
    document.body.appendChild(s);
    s.onload=function(){
        var p=prompt('Enter your prompt:');
        if(p){
            sendPromptToAIWithFallback('manus', p);
        }
    };
})();
```

---

## API Reference

### `sendPromptToAI(platform, promptText, autoOpen)`

Sends a prompt via storage API.

**Parameters:**
- `platform` (string) - Target platform: `'gemini'`, `'chatgpt'`, `'claude'`, `'perplexity'`, `'manus'`
- `promptText` (string) - The prompt to send (no length limit)
- `autoOpen` (boolean, optional) - Auto-open the platform (default: `true`)

**Returns:** `Promise<void>`

**Example:**
```javascript
await sendPromptToAI('manus', 'Your long prompt here');
```

### `sendPromptToAIWithFallback(platform, promptText)`

Same as above, but falls back to clipboard copy if extension is not available.

**Example:**
```javascript
await sendPromptToAIWithFallback('claude', 'Your prompt here');
```

---

## Storage Data Format

The extension expects this format in `chrome.storage.local`:

```javascript
{
    pendingPrompt: {
        text: "Your prompt text",
        platform: "manus",      // Optional: validates platform match
        timestamp: 1234567890   // Auto-expires after 5 minutes
    }
}
```

**Features:**
- **Platform validation:** If specified, prompt only injects on matching platform
- **Auto-expiration:** Prompts expire after 5 minutes to prevent stale data
- **Auto-cleanup:** Storage is cleared after successful injection

---

## Comparison: URL vs Storage

| Feature | URL Parameters | Storage API |
|---------|---------------|-------------|
| **Max Length** | ~2000 chars (varies) | Unlimited |
| **Manus Support** | ❌ Blocked by CloudFront | ✅ Works perfectly |
| **Setup** | None required | Requires helper script |
| **Shareable** | ✅ Yes (via URL) | ❌ No |
| **Security** | Visible in URL | Stored locally only |
| **Use Case** | Short prompts, sharing | Long prompts, automation |

---

## Best Practices

1. **Use URL params for short prompts** (<2000 chars) - simpler and shareable
2. **Use Storage API for:**
   - Prompts >2000 characters
   - Manus platform (any length)
   - Automation workflows
   - Privacy-sensitive prompts

3. **Always check extension is installed** before using storage API
4. **Use `sendPromptToAIWithFallback()`** for user-facing tools (provides clipboard fallback)

---

## Troubleshooting

### "Chrome storage API not available"
- Ensure the Sellify™ AI Connector extension is installed
- Check that the extension has storage permissions
- Verify you're calling the API from a web page (not file://)

### Prompt not injecting
- Check browser console for `[Sellify Connector]` logs
- Verify you're on the correct platform
- Ensure prompt hasn't expired (>5 minutes old)
- Try refreshing the page

### CloudFront 403 error on Manus
- This means you're using URL params with a long prompt
- Switch to Storage API method instead
- URL should be clean: `https://manus.im/app` (no `?prompt=`)

---

## Example: Complete Workflow

```javascript
// 1. Load helper script
const script = document.createElement('script');
script.src = 'https://sellify.ph/storage-helper.js';
document.body.appendChild(script);

// 2. Wait for load
script.onload = async function() {
    // 3. Prepare your long prompt
    const auditPrompt = `
        Conduct a comprehensive SEO audit of our website including:
        - Technical SEO analysis
        - Content optimization recommendations
        - Backlink profile review
        - Competitor analysis
        - Mobile performance
        - Page speed insights
        [... thousands more characters ...]
    `;
    
    // 4. Send to Manus via storage
    try {
        await sendPromptToAI('manus', auditPrompt);
        console.log('Prompt sent successfully!');
    } catch (error) {
        console.error('Failed to send prompt:', error);
    }
};
```

---

## Support

For questions or issues:
- Email: support@sellify.ph
- Website: https://sellify.ph/support
- Documentation: https://sellify.ph/
