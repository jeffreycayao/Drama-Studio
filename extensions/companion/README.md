# Drama Studio™ Companion

The browser extension that works alongside the Drama Studio desktop app. It is
one WXT + Vue 3 + strict TypeScript Manifest V3 extension with three parts:

| Part             | Where it runs                                                      | What it does                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grok batches** | Side panel + `grok.com` content script                             | Queues many prompts on Grok Imagine in the person's own signed-in tab, paces them, and downloads results. Stops at once on a CAPTCHA, usage limit, moderation message or sign-in page. |
| **Prompt fill**  | Content script on Gemini, ChatGPT, Claude, Perplexity, Manus, Grok | Types a long prompt into the chat box. It never presses Send.                                                                                                                          |
| **Desktop link** | Background worker                                                  | Client side of the native-messaging link to Drama Studio (plan §4); the desktop host is in `electron/companionLink/`.                                                                  |

The plan, the decisions behind it and what is still open are in
[`docs/PLAN_BROWSER_EXTENSIONS.md`](../../docs/PLAN_BROWSER_EXTENSIONS.md).

## Develop

This folder is its own npm project with its own lockfile. Run everything from
here, never from the app root.

```powershell
npm ci
npm run dev     # WXT dev build with reload
npm run check   # format, types, lint, unit + tooling tests, source scan
npm run build   # production build into .output/chrome-mv3
npm run verify  # check + build + build verifier + output scan
npm run ci      # verify + zip + ZIP verifier
```

Load `.output/chrome-mv3` through `chrome://extensions` → **Developer mode** →
**Load unpacked**. Node 24 (see `.nvmrc`).

Optional browser smoke test (needs Chrome for Testing; it opens Grok Imagine
but never presses Run):

```powershell
npm run smoke:browser -- "C:\path\to\chrome.exe" --capture-dir .smoke
```

## Layout

```
entrypoints/
  background.ts            downloads, side panel, desktop-link routing
  grok.content.ts          Grok batch runner (grok.com only)
  prompt-fill.content.ts   prompt fill (exact AI-site hosts only)
  sidepanel/               Vue side panel
src/
  sites/                   declarative site adapters
    grok.ts                Grok selectors, health check, stop signals
    prompt-sites.ts        prompt-box selectors for each AI chat site
    page-state.ts          CAPTCHA / limit / moderation / sign-in detection
    health.ts              "this site changed" check
  content/                 batch queue, workers, Grok automation, downloads
  prompt-fill/             link parsing, consent bar, filling
  desktop/                 native-messaging contracts and client
  sidepanel/               side-panel app, settings, spreadsheet import
  brand/                   Drama Studio fonts and sf-* tokens
scripts/                   build, ZIP and source verifiers, smoke test
tests/                     Vitest unit tests and node:test tooling tests
```

## Safety rules

- **Stop, don't retry.** Before every prompt, after every failure and every
  1.5 s while a batch runs, the Grok tab is checked for a CAPTCHA, a usage
  limit, a moderation message or a sign-in page. Any of them stops the whole
  batch, cancels its pending downloads, and the side panel says why. Only
  timeouts and network errors are retried.
- **Site changes are visible.** Before a batch starts, the Grok adapter's
  health check must find the prompt box. If it cannot, the batch stops with
  "This site changed … an update is pending" instead of failing silently.
- **Links ask first.** A `#prompt=` / `?prompt=` link from any web page shows a
  "Prompt from a link: Fill / Dismiss" bar (in a closed shadow root, trusted
  clicks only). Only a one-time `#ds=<token>` from Drama Studio fills without
  asking, and the prompt itself never travels in the URL.
- **Never press Send** on AI chat sites.
- Never add CAPTCHA solving, limit bypassing, account rotation, stealth or
  watermark removal.

## Updating a site adapter

Grok's selectors live in one object in `src/sites/grok.ts`. When Grok changes:

1. Update the selectors (the dialect supports `:eq()`, `:contains()`,
   `:last()` and `:visible`, see `src/content/dom/jquery-bridge.ts`).
2. Bump `revision` to today's date.
3. Run `npm run check` and do a low-volume test on an owner-controlled account.

Prompt-fill selectors live in `src/sites/prompt-sites.ts`; each site has a
fixture test in `tests/prompt-fill/fill.test.ts`.

## Permissions

| Permission                                 | Why                                        |
| ------------------------------------------ | ------------------------------------------ |
| `storage`                                  | Settings and download naming               |
| `tabs`                                     | Find, open, focus and zoom the Grok tab    |
| `downloads`                                | Save generated media                       |
| `sidePanel`                                | The side panel                             |
| `grok.com`, `imgen.x.ai`, `vidgen.x.ai`    | Batch runner and generated-media downloads |
| Content scripts on the six AI chat sites   | Prompt fill                                |
| `nativeMessaging` (optional, asked on use) | The Drama Studio desktop link              |

The extension has no server of its own and makes no network requests besides
the Grok media it downloads for the person.
