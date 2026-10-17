# Hash Fragment Method - Bypass CloudFront/WAF Restrictions

## Overview

The **hash fragment method** uses URL hash (#) instead of query parameters (?) to pass prompts. This bypasses CloudFront/WAF restrictions because hash fragments are **never sent to the server**.

## Why Hash Fragments Work

```
❌ Query Params:  https://manus.im/app/?prompt=LONG_TEXT
   Browser → CloudFront sees full URL → 403 BLOCKED

✅ Hash Fragment:  https://manus.im/app/#prompt=LONG_TEXT
   Browser → CloudFront only sees /app/ → 200 OK ✓
   Hash stays in browser → Extension reads it → Injects prompt
```

**Key Insight:** Everything after `#` is **client-side only** and never sent in HTTP requests.

---

## Extension Support

The Sellify™ AI Connector now supports **three methods** (in priority order):

1. **Hash fragments** (#prompt= or #q=) - **Recommended for long prompts**
2. **Query parameters** (?prompt= or ?q=) - Good for short prompts
3. **Storage API** (chrome.storage) - Advanced use cases

---

## Usage Examples

### For Manus (Recommended):
```
https://manus.im/app/#prompt=Your+very+long+prompt+here...
https://manus.im/app/#q=Your+prompt
```

### For Other Platforms:
```
https://gemini.google.com/#q=Your+prompt
https://chat.openai.com/#prompt=Your+prompt
https://claude.ai/#q=Your+prompt
https://www.perplexity.ai/#prompt=Your+prompt
```

---

## Changes Needed in Your App

### File: `manus-ai-meta.js` (or wherever you build URLs)

**Before:**
```javascript
function sendToManus(prompt) {
    const url = 'https://manus.im/app/?prompt=' + encodeURIComponent(prompt);
    window.open(url, '_blank');
}
```

**After:**
```javascript
function sendToManus(prompt) {
    // Use hash fragment instead of query param
    const url = 'https://manus.im/app/#prompt=' + encodeURIComponent(prompt);
    window.open(url, '_blank');
}
```

**That's it!** Just change `?` to `#` - one character change.

---

## Complete Example for Your App

```javascript
// In your manus-ai-meta.js or similar file

function sendToManus(promptText) {
    // Encode the prompt
    const encoded = encodeURIComponent(promptText);
    
    // Build URL with hash fragment (bypasses CloudFront)
    const url = `https://manus.im/app/#prompt=${encoded}`;
    
    // Open in new tab
    window.open(url, '_blank');
    
    console.log('Sent to Manus via hash fragment (' + promptText.length + ' chars)');
}

// Example usage
const longPrompt = `
    Conduct a comprehensive SEO audit...
    [10,000+ characters - no problem!]
`;

sendToManus(longPrompt);
```

---

## Comparison: All Three Methods

| Method | URL Format | CloudFront Sees | Max Length | Use Case |
|--------|-----------|-----------------|------------|----------|
| **Hash Fragment** | `#prompt=TEXT` | `/app/` only | Unlimited* | **Long prompts, Manus** |
| **Query Param** | `?prompt=TEXT` | Full URL | ~2000 chars | Short prompts, sharing |
| **Storage API** | Clean URL | `/app/` only | Unlimited | Advanced automation |

*Browser limits apply (~2MB for hash), but far beyond practical prompt lengths

---

## Benefits of Hash Fragment Method

✅ **Simple** - One character change (`?` → `#`)  
✅ **No server changes** - Works with existing infrastructure  
✅ **Bypasses CloudFront/WAF** - Hash never sent to server  
✅ **Unlimited length** - No practical limit for prompts  
✅ **Shareable** - URLs still work (unlike storage API)  
✅ **No extension permissions** - Uses standard web APIs  
✅ **Backward compatible** - Extension still supports `?` params  

---

## Testing

### Test Short Prompt:
```
https://manus.im/app/#q=Test+prompt
```

### Test Long Prompt:
```javascript
const longText = "A".repeat(5000); // 5000 characters
const url = `https://manus.im/app/#prompt=${encodeURIComponent(longText)}`;
window.open(url);
```

### Verify in Console:
Look for: `[Sellify Connector] Reading from hash fragment (bypasses CDN)`

---

## Migration Guide

### Step 1: Update Your App
In `http://localhost/abv2/tools/manus-ai-meta.js`:

```javascript
// Find this line:
const url = 'https://manus.im/app/?prompt=' + ...

// Change to:
const url = 'https://manus.im/app/#prompt=' + ...
```

### Step 2: Test
1. Generate a long prompt (>3000 chars)
2. Click your "Send to Manus" button
3. Verify Manus opens without 403 error
4. Check extension injects the prompt

### Step 3: Deploy
- No extension changes needed (already supports hash)
- Just deploy your app changes
- Works immediately

---

## Troubleshooting

### Hash not working?
- Check console for `[Sellify Connector]` logs
- Verify extension is installed and enabled
- Ensure you're using `#` not `?`

### Prompt not injecting?
- Extension reads hash on page load
- If you change hash after load, reload the page
- Check that prompt is properly URL-encoded

### Still getting 403?
- Verify you're using `#` not `?`
- Check the actual URL in browser address bar
- CloudFront should only see `/app/` in logs

---

## Advanced: Dynamic Hash Updates

If you need to update the prompt after page load:

```javascript
// Update hash (doesn't reload page)
window.location.hash = '#prompt=' + encodeURIComponent(newPrompt);

// Extension won't auto-inject on hash change
// User needs to refresh, or you can trigger manually
```

For dynamic updates, consider the Storage API instead.

---

## Summary

**For your app (`manus-ai-meta.js`):**
```javascript
// Change this:
'https://manus.im/app/?prompt=' + encodeURIComponent(prompt)

// To this:
'https://manus.im/app/#prompt=' + encodeURIComponent(prompt)
```

**That's the entire change!** The extension already supports it. 🚀

---

## Support

Questions? Contact support@sellify.ph or see full documentation at https://sellify.ph/support
