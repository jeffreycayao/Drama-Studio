# Plan: browser extensions and the desktop link (2026-10-17)

Internal planning document. Not user-facing.

Two extensions were brought into this repository under `extensions/`. This
document records what each one does today, what has to change before either
ships as part of Drama Studio, and how the desktop app and the extension talk
to each other. It builds on section 3 of
[PLAN_CLOUD_ALTERNATIVES.md](PLAN_CLOUD_ALTERNATIVES.md) (the browser bridge
and its four modes).

| Folder | Came from | Stack | State |
| --- | --- | --- | --- |
| `extensions/ds-chrome-automator/` | `01.1 Drama Studio - Extentions/01. DS CHROME AUTOMATOR` | npm-workspaces monorepo: WXT + Vue 3 + TypeScript MV3 extension, React dashboard, Node/Vercel API, shared Zod contracts | Grok only, `0.0.13` |
| `extensions/ds-long-prompt-helper/` | `01.1 Drama Studio - Extentions/02. DS LONG PROMPT HELPER` | Plain MV3, two content scripts, no build step | `2.2.0`, not yet on WXT |

The copies leave out `node_modules`, build output (`.output`, `.wxt`, `dist`),
`.vercel`, real `.env` files, the signed reference build and an old zip. The
originals in `01.1 Drama Studio - Extentions` are untouched.

---

## 1. DS Chrome Automator: what it does today

A side panel on `grok.com/imagine` that queues many prompts and collects the
results.

- **Modes:** Text to Video, Frame to Video, Ingredients to Video, Text to
  Image, Image to Image.
- **Prompt input:** prompts separated by blank lines, or imported from TXT,
  CSV, XLS or XLSX with a preview.
- **Reference images:** multi-file upload, drag and drop, reorder, and
  matching images to prompts by file name (character names).
- **Per prompt:** duration, image-chain mode, assigned images, checked before
  anything is sent.
- **Batch controls:** concurrency, random delay, output count, download
  folder, automatic file names, prompt range.
- **Queue:** status per group and prompt, retries, progress, cancel. A queue
  is tied to the tab it started in.
- **Downloads:** results staged in IndexedDB and saved through
  `chrome.downloads`.
- **Settings and debug:** default mode, model, aspect and sequence, retries,
  download quality, language, a capped action log, a local diagnostic report.
- **Account gate:** Google sign-in (PKCE) against `paks-api.vercel.app`. Every
  **Run** asks the server for an `automation.run` allowance. Plans:
  `free-plan`, `single-license`, `all-apps`. Stripe checkout is scaffolded,
  not finished.
- **Also in the workspace:** `faceless-automation-dashboard` (landing page,
  guides, admin) and `faceless-platform-api` (identity, guides, commerce, rate
  limits, Neon Postgres). Both are for the Paks Tools account platform, not
  for the extension's automation itself.

Not there yet: **Google Flow**. The automator only knows Grok's pages
(`grok.com`, `imgen.x.ai`, `vidgen.x.ai`).

Checked and clean: no real keys or secrets (only test fixtures such as
`whsec_testSigningSecret`), no CAPTCHA solving, no stealth or fingerprint code,
no `navigator.webdriver` tricks, no account rotation.

## 2. DS Long Prompt Helper: what it does today

Fills a prompt into the chat box of Gemini, ChatGPT, Claude, Perplexity,
Manus and Grok when the page opens.

- **Three ways to pass the prompt:**
  - **`#` hash fragment** (`https://chatgpt.com/#prompt=...`): the text stays in
    the browser, so there is no server URL-length limit. This is the main path.
  - **`?` query parameter**, the traditional way, with length limits.
  - **`chrome.storage`**: a `pendingPrompt` with a 5-minute expiry, for
    prompts too long even for a URL.
- **Filling:** handles both `textarea` and `contenteditable` boxes, keeps line
  breaks, escapes HTML before inserting, and works on single-page apps.
- **It never presses Send.** The user reviews and submits.
- Permission: `storage` only. No network calls of its own.

## 3. Changes needed before shipping

### Both

- **Rebrand to Drama Studio.**
  - The automator is still "Paks Tools Faceless automations" / "Grok
    Automator™". Its repository name is `Chris.dev-faceless-automations-monorepo`.
    It was rebuilt from the signed "Grok Automation 2.6.3" extension.
  - The helper is "Sellify™ AI Connector", author `sellify.ph`.
  - **Owner question:** confirm that we hold the rights to ship both under
    Drama Studio. In particular, check the 2.6.3 reference port and the
    Sellify code.
- **Merge into one extension, "Drama Studio Companion"** (WXT + Vue, using the
  automator's tooling). The helper becomes the prompt-fill module of the
  Companion's site adapters. One listing, one permission review, one link to
  the desktop app.
- **Stay inside the sites' rules (modes 1–3 only).** See section 3 of the
  cloud plan. No unattended farms, no limit bypassing, no account rotation,
  no watermark removal.

### Automator

1. **Stop on limits.** The queue retries failed prompts with random delays,
   and it has no check for a CAPTCHA, a usage-limit or moderation message, or
   a sign-in prompt. Add a page-state check that **stops the whole queue**,
   with no retry, and tells the user why. Retries stay only for real network
   or timeout errors. This is required before batch mode ships.
2. **Replace the Paks Tools account gate.** For Drama Studio, Run is allowed
   when the extension is paired with the desktop app (section 4).
   - The Google sign-in, Stripe plans, dashboard and API are then not needed.
     Keep them in the workspace only if the owner wants a separate paid web
     product.
   - **Owner decision.**
3. **Site adapters.** Move Grok's selectors into one declarative adapter file,
   then add **Google Flow**, ChatGPT images, Higgsfield and InVideo one by
   one. Each adapter has a health check, so a site change shows "this site
   changed, update pending" instead of failing silently.
4. **Send results to Drama Studio** rather than only to the Downloads folder
   (section 4, Capture).
5. Keep its strict checks (`npm run check`, ZIP verification, smoke test) as
   the Companion's CI.

### Long Prompt Helper

1. **Drop the "bypasses CloudFront/WAF" wording** from the README, store text
   and comments. What it really does is keep long text out of the URL that
   goes to the server. Say "works with very long prompts" instead.
2. **Don't fill prompts from any link.** Today, any web page can send the user
   to `chatgpt.com/#prompt=...` with text it chose. Nothing is sent
   automatically, but a planted prompt is easy to miss. Instead, fill only
   from a one-time Drama Studio token (section 4). For a plain `#prompt=`
   link, show a bar ("Prompt from a link — Fill / Dismiss") rather than
   filling silently.
3. **Remove the bookmarklet** that loads `https://sellify.ph/storage-helper.js`
   into the page. That is remote code.
4. Port it to WXT inside the Companion, with tests for each site's input box.

---

## 4. Wiring the desktop app to the extension

### Channel: Chrome Native Messaging

```
Drama Studio (Electron)  <── local pipe ──>  native host  <── stdio ──>  Companion (MV3)
                                             (started by Chrome)
```

- **Native host.** A small program Chrome starts when the extension calls
  `chrome.runtime.connectNative('com.dramastudio.companion')`.
  - The installer registers it for Chrome and Edge under
    `HKCU\Software\Google\Chrome\NativeMessagingHosts\` and the Edge
    equivalent.
  - `allowed_origins` lists only the Companion's extension ID.
  - Websites cannot reach a native host. That is why it is used instead of
    the loopback MCP port.
- **Host ↔ app.** The host relays messages over a per-user named pipe
  (`\\.\pipe\drama-studio-companion-<user>`) to the running app, which checks
  a per-install pairing secret.
  - If the app is not running, the host answers `app-not-running`, and the
    Companion offers to open Drama Studio.
- **Pairing.** The first connection shows "Allow this browser to send files
  to Drama Studio?" in the desktop app. Approving stores the pairing. Settings
  › Browser lists paired browsers and lets the user remove them.
- **Sizes.**
  - Chrome caps messages at 1 MB from the host and 64 MB from the extension.
  - Media goes extension → app in 8 MB chunks, with a job ID and a checksum.
  - The app writes into the open project's import folder, then runs the
    normal import, so the file appears in Assets with its prompt as metadata.
- **Keeping the link open.** An open native port keeps the MV3 service worker
  alive. The Companion connects when a Drama Studio job is running and
  disconnects when idle.

### Mode 1: Capture (first to build)

A **Send to Drama Studio** button on generated images and videos (adapter
selectors), and on the automator's finished queue items.

The Companion reads the media from the page's own response, then sends
`capture.import { site, prompt, model, mediaType, chunks… }`. The app replies
with the new asset's name.

### Mode 2: Prompt hand-off (the `#` idea, made safe)

From Generate, Short Film shots, Cast Locker or the prompt library: **Open in
Grok / Flow / ChatGPT / Gemini / Claude…**

1. The app creates a one-time hand-off with the prompt, the reference images
   and the target site, and gets back a random token valid for 5 minutes.
2. The app opens `https://<site>/…#ds=<token>` in the default browser.
3. The Companion's content script sees `#ds=` and asks the native host for
   that hand-off. It fills the prompt with the long-prompt helper's code and
   attaches the images through the site adapter. Then it clears the hash.
4. The user reviews and presses Generate. Capture then brings the result
   back.

Only the token is in the URL, never the prompt, so prompts stay out of
history and server logs. Prompts of any length work, and so do images, which
a URL can't carry.

### Mode 3: Assisted batch

Drama Studio sends a shot list (`batch.start { site, items[] }`). The
Companion runs the automator's queue on the user's open, signed-in tab, one
prompt at a time.

- It paces like a person and stops at once on any limit, CAPTCHA, warning or
  sign-in page (section 3, Automator 1).
- Each result is captured back with its shot ID. Generate's queue shows the
  progress.
- The user can stop the batch from either side.

### Messages (first version)

| Direction | Message | Purpose |
| --- | --- | --- |
| ext → app | `hello { extVersion, browser }` | Version check and pairing status |
| ext → app | `capture.import` (chunked) | Import a result with its prompt |
| ext → app | `handoff.fetch { token }` | Get a prompt hand-off |
| app → ext | `batch.start`, `batch.cancel` | Assisted batch |
| ext → app | `batch.progress`, `batch.stopped { reason }` | Progress and why it stopped |

The schemas live in a shared contracts package (the automator already has one,
in `packages/platform-contracts`). They are checked on both sides.

---

## 5. Prompt library (new Drama Studio feature)

A place to keep and reuse prompts, so the Companion has something worth
handing off.

- **What it holds:**
  - Ideas and loglines
  - Story and episode outlines
  - Shot prompts
  - Style and camera presets
  - Character sheets
  - Voice, music and sound prompts
  - Negative prompts
- **Templates with blanks:** `{character}`, `{location}`, `{mood}`. Blanks
  are filled from the project's Cast Locker and the shot list.
- **Organising:** categories, tags, favorites, search, recent.
- **Built-in starter set** in plain words, plus **imported packs**. Pack
  prompt templates are already kept on import. This replaces the tracker item
  "pack prompt templates inside Short Film / Director".
- **Used from:**
  - Generate
  - Short Film / Director
  - Idea Pad
  - The Assistant ("give me five horror loglines from my library")
  - **Open in…** (mode 2), which sends one to any AI site
- **Stored per user,** with an option to copy a prompt into the project so the
  project stays portable.
- **MCP / Assistant tools:** `list_prompts`, `use_prompt` (fill the blanks),
  `save_prompt`.
- **Help Center article** in plain words.

---

## 6. Order of work

1. Prompt library (desktop only, useful without any extension). **M**
2. Companion skeleton from the automator workspace; rebrand; remove the
   account gate (after the owner decides). **S–M**
3. Native host, pairing, `hello`, and Settings › Browser. **M**
4. Mode 2 hand-off with the `#ds=` token, built on the long-prompt helper,
   for Gemini, ChatGPT, Claude, Grok and Flow. **S**
5. Mode 1 Capture on Grok and Flow. **M**
6. Limit and CAPTCHA stop, then Mode 3 batch on Grok and Flow. **M**
7. More adapters: ChatGPT images, Higgsfield, InVideo. **S each**
8. Chrome Web Store and Edge listings, privacy page, Help Center articles.

## 7. Open questions for the owner

1. **Rights:** the automator came from "Grok Automation 2.6.3" and Chris.dev /
   Paks Tools, and the helper from Sellify. Can both ship as Drama Studio?
2. **Paks Tools platform:** drop it, with Drama Studio pairing replacing
   sign-in? Or keep it as a separate paid product?
3. **Publisher account** for the Chrome Web Store and Edge Add-ons.
4. **Batch mode:** ship it at all, or Capture and hand-off only? Batch carries
   the most risk under each site's terms.
