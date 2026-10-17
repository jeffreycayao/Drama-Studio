# Prompt for Claude: Refactor Webapp to Use Hash Fragments (#) Instead of Query Parameters (?)

---

## Context

I have an existing web application that currently sends prompts to AI platforms (Gemini, ChatGPT, Claude, Perplexity, Manus, and Grok) using URL query parameters (`?prompt=` or `?q=`). I need to refactor this to use **hash fragments** (`#prompt=` or `#q=`) instead.

**Why the change?**
- Hash fragments bypass CloudFront/WAF restrictions (especially critical for Manus platform)
- Hash fragments are never sent to the server - they stay client-side only
- No URL length limitations (browser limit ~2MB vs server limits ~2000 chars)
- Prevents 403 errors on platforms with strict CDN/WAF rules

---

## Current Behavior (What I Have Now)

My webapp currently generates URLs like this:
```
https://manus.im/app/?prompt=ENCODED_PROMPT_TEXT
https://gemini.google.com/?q=ENCODED_PROMPT_TEXT
https://chat.openai.com/?q=ENCODED_PROMPT_TEXT
```

**I don't know:**
- Where in my codebase these URLs are being constructed
- What function(s) or file(s) handle the URL building
- Whether there are multiple places doing this
- What the current implementation looks like

---

## Desired Behavior (What I Want)

I want my webapp to generate URLs like this instead:
```
https://manus.im/app/#prompt=ENCODED_PROMPT_TEXT
https://gemini.google.com/#q=ENCODED_PROMPT_TEXT
https://chat.openai.com/#q=ENCODED_PROMPT_TEXT
https://grok.com/#q=ENCODED_PROMPT_TEXT
```

**Key requirement:** Just change `?` to `#` - that's the only change needed for the URL structure.

---

## Platform-Specific URL Formats

Here are the correct URL formats for each platform:

| Platform | Hash Fragment Format | Query Param Format (old) |
|----------|---------------------|---------------------------|
| Gemini | `https://gemini.google.com/#q=TEXT` | `?q=TEXT` |
| ChatGPT | `https://chat.openai.com/#prompt=TEXT` | `?prompt=TEXT` |
| Claude | `https://claude.ai/#q=TEXT` | `?q=TEXT` |
| Perplexity | `https://www.perplexity.ai/#prompt=TEXT` | `?prompt=TEXT` |
| Manus | `https://manus.im/app/#prompt=TEXT` | `?prompt=TEXT` |
| Grok | `https://grok.com/#q=TEXT` | `?q=TEXT` |

**Note:** The parameter name (`prompt` vs `q`) stays the same - only the separator changes from `?` to `#`.

---

## What I Need You To Do

### Step 1: Analyze My Codebase
1. **Search** for all instances where URLs are being constructed for AI platforms
2. **Identify** the files, functions, and code patterns used
3. **List** all locations where changes are needed
4. **Show me** the current implementation (don't assume - read my actual code)

### Step 2: Explain the Changes
1. **Describe** what needs to change in each location
2. **Explain** the impact of each change
3. **Identify** any potential side effects or edge cases
4. **Warn me** about any breaking changes

### Step 3: Provide Refactoring Guidance
1. **Recommend** the best approach for my specific codebase structure
2. **Suggest** whether to:
   - Do a simple find-replace
   - Refactor into a centralized URL builder function
   - Update multiple scattered locations
3. **Prioritize** changes (what's critical vs nice-to-have)

---

## Important Constraints

**DO NOT:**
- Assume my code structure or framework
- Assume where the URL building happens
- Assume variable names or function names
- Write code without showing me what currently exists first
- Make changes without explaining them

**DO:**
- Read my actual files to understand the current implementation
- Ask clarifying questions if you need more context
- Show me the "before" state before suggesting "after" changes
- Explain why each change is necessary
- Consider backward compatibility if needed

---

## Search Hints

Look for patterns like:
- `?prompt=`
- `?q=`
- `encodeURIComponent`
- Platform URLs: `manus.im`, `gemini.google.com`, `chat.openai.com`, `claude.ai`, `perplexity.ai`, `grok.com`
- Functions that might be named like: `sendToManus`, `sendToAI`, `buildUrl`, `generatePromptUrl`, etc.
- JavaScript files that handle AI platform integration
- Any files related to "manus", "gemini", "chatgpt", "ai", "prompt", etc.

---

## Example of What I'm Looking For

**Current Code (example - yours will be different):**
```javascript
function sendToManus(prompt) {
    const url = 'https://manus.im/app/?prompt=' + encodeURIComponent(prompt);
    window.open(url, '_blank');
}
```

**Refactored Code (example):**
```javascript
function sendToManus(prompt) {
    const url = 'https://manus.im/app/#prompt=' + encodeURIComponent(prompt);
    window.open(url, '_blank');
}
```

**Change:** Just `?` → `#` (one character)

---

## Testing Guidance I Need

After you help me refactor, I need to know:
1. How to verify the URLs are being generated correctly
2. What to test to ensure nothing broke
3. Whether I need to update any documentation
4. If there are any browser compatibility concerns

---

## My Codebase Context

**Project Location:** `c:\xampp\htdocs\abv2\` (or wherever your webapp is)

**What I know:**
- I have a webapp that sends prompts to AI platforms
- It currently uses query parameters (`?`)
- I need to switch to hash fragments (`#`)

**What I don't know:**
- Where this logic lives in my code
- How many places need to be updated
- What the current implementation looks like

---

## Expected Output From You

1. **Analysis Report:**
   - List of all files that need changes
   - Current code snippets from each location
   - Explanation of what each piece does

2. **Refactoring Plan:**
   - Step-by-step changes needed
   - Priority order (what to change first)
   - Risk assessment for each change

3. **Implementation Guidance:**
   - Recommended approach for my specific codebase
   - Code examples (based on my actual code, not assumptions)
   - Testing checklist

4. **Migration Notes:**
   - Any backward compatibility considerations
   - Whether to support both `?` and `#` temporarily
   - Rollback plan if something goes wrong

---

## Questions You Should Ask Me

Before making recommendations, you should ask:
1. What framework/libraries am I using? (vanilla JS, jQuery, React, etc.)
2. Do I need to maintain backward compatibility with old URLs?
3. Are there any analytics or tracking that rely on query parameters?
4. Do I have any server-side code that reads these URLs?
5. Are there any bookmarks or saved links I need to consider?

---

## Success Criteria

The refactoring is successful when:
- ✅ All AI platform URLs use `#` instead of `?`
- ✅ Long prompts (>2000 chars) work without 403 errors on Manus
- ✅ Existing functionality is preserved
- ✅ No breaking changes to user experience
- ✅ Code is clean and maintainable

---

## Additional Notes

- My Chrome extension (Sellify™ AI Connector v2.2.0) already supports hash fragments
- The extension reads prompts in this priority: Storage API → Hash fragments → Query params
- Hash fragments work on all 6 platforms (Gemini, ChatGPT, Claude, Perplexity, Manus, Grok)
- This is purely a client-side change - no server modifications needed

---

**Please start by analyzing my codebase and showing me what currently exists before suggesting any changes.**
