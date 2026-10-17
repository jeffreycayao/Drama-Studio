# Plan: browser extension and the desktop link (2026-10-17)

Internal planning document. Not user-facing.

Two extensions were brought into this repository under `extensions/` and have
been merged into one: **Drama Studio™ Companion**
([`extensions/companion/`](../extensions/companion/README.md)). This document
records what the Companion does, what changed from the originals, what is
still open, and how the desktop app and the extension talk to each other. It
builds on section 3 of [PLAN_CLOUD_ALTERNATIVES.md](PLAN_CLOUD_ALTERNATIVES.md)
(the browser bridge and its four modes).

| Folder | What it is | Stack | State |
| --- | --- | --- | --- |
| `extensions/companion/` | Drama Studio Companion | WXT + Vue 3 + strict TypeScript MV3, standalone npm project with its own lockfile | `0.1.0`, builds and passes `npm run ci`; not released |

Where it came from (now deleted from the tree; git history has them):

| Old folder | Came from | What happened to it |
| --- | --- | --- |
| `extensions/ds-chrome-automator/` | `01.1 Drama Studio - Extentions/01. DS CHROME AUTOMATOR` (a WXT/Vue rebuild of the signed "Grok Automation 2.6.3", branded Paks Tools / Grok Automator™) | Its `apps/grok-automator` became the Companion (moved with `git mv`, so history follows). The account dashboard, platform API, shared contracts, brand package, Vercel release scripts and build plans were deleted. |
| `extensions/ds-long-prompt-helper/` | `01.1 Drama Studio - Extentions/02. DS LONG PROMPT HELPER` (branded Sellify™ AI Connector) | Ported to TypeScript as the Companion's prompt-fill module. The remote storage-helper script, bookmarklet, store-listing notes and hosted privacy/terms/support pages were deleted. |

The originals in `01.1 Drama Studio - Extentions` are untouched.

---

## 1. Grok batches: what the Companion does

A side panel on `grok.com/imagine` that queues many prompts in the person's
own signed-in tab and collects the results.

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
- **Queue:** status per group and prompt, progress, cancel, and a clear
  "Batch stopped" message with the reason. A queue is tied to the tab it
  started in.
- **Downloads:** results saved through `chrome.downloads`.
- **Settings and activity:** default mode, model, aspect and sequence,
  retries after a timeout, download quality, a capped activity log, a local
  diagnostic report to paste into the Drama Studio Discord.
- **No account.** The Paks Tools sign-in, plans and server-authorized Run
  gate were removed (owner decision, 2026-10-17). Run is allowed whenever the
  tab is healthy. Pairing with the desktop app (section 4) is the planned
  replacement for anything that needs trust.

Not there yet: **Google Flow** and the other adapters (section 3).

## 2. Prompt fill: what the Companion does

Fills a prompt into the chat box of Gemini, ChatGPT, Claude, Perplexity,
Manus and Grok.

- **`#ds=<token>`** from Drama Studio: the content script asks the background
  worker, which asks the desktop app over native messaging for the one-time
  hand-off, checks it was made for this site, and fills it. Only the token is
  in the URL.
- **`#prompt=` / `#q=`** (and `?prompt=` / `?q=`) from any link: a "Prompt
  from a link: Fill / Dismiss" bar shows the start of the text and its length.
  Nothing is typed until the person presses Fill (a closed shadow root that
  accepts trusted clicks only). Perplexity's own `?q=` is left to Perplexity.
- The Companion's parameters are removed from the address bar at once, so a
  reload does not fill again and the text leaves the visible URL.
- **Filling:** textareas through the native value setter (React notices it),
  `contenteditable` boxes through the editing pipeline, falling back to text
  nodes and `<br>`; the prompt is never parsed as HTML.
- **It never presses Send.**
- The old `chrome.storage` "pending prompt" path was dropped: web pages could
  never write it, and the hand-off replaces it.

## 3. Changes needed before shipping

### Done (2026-10-17)

- **Rebranded** everywhere: manifest, side panel, consent bar, icons (from
  `branding/`), store text draft, docs. Drama Studio identity: `sf-*` tokens
  copied from the desktop app's `src/index.css` into
  `src/brand/tokens.css`, the desktop fonts (Inter, Sora, JetBrains Mono,
  bundled locally), lime accent with charcoal text, olive for decoration. The
  side-panel stylesheet has no raw colours left. A test and the build verifier
  fail on any old product name (Paks Tools, Grok Automator™, Sellify,
  Chris.dev, PAKS LLC) outside third-party licence files.
- **Merged into one extension** (WXT + Vue, using the automator's tooling).
  One listing, one permission review, one link to the desktop app.
- **Stop on limits.** Before every prompt, after every failed prompt and every
  1.5 s while a batch runs, the Grok tab is checked for a CAPTCHA (Cloudflare,
  reCAPTCHA, hCaptcha, Arkose, "verify you are human"), a usage-limit message,
  a moderation message or a sign-in page. Any of them stops the whole queue,
  with no retry, cancels the batch's pending downloads (an upscale is a new
  generation) and shows the reason. Limit wording is read only from alerts,
  dialogs and toasts, never from the prompt box. Retries remain only for
  timeouts and network errors.
- **Account gate removed** (owner decision). The two issues the security
  review found in `faceless-platform-api` (v1 protocol downgrade, global
  rate-limit lockout) no longer apply: the API was deleted with the platform.
- **Site adapter.** Grok's selectors moved from a hashed JSON snapshot (sent
  over a pointless background round-trip) into one declarative adapter,
  `src/sites/grok.ts`, with a health check and the stop signals. A changed
  site shows "This site changed … an update is pending" and the batch does not
  start. Prompt-fill selectors are a second adapter list,
  `src/sites/prompt-sites.ts`.
- **"Bypasses CloudFront/WAF" wording removed.**
- **Links ask first;** the **remote bookmarklet** (`sellify.ph/storage-helper.js`)
  is gone.
- **Ported to WXT with tests** for each site's input box.
- **Strict checks kept as the Companion's gate:** `npm run ci` = format,
  types, lint, unit tests, tooling tests, source scan, build, build verifier
  (name, icons, tokens, fonts, exact permissions, exact-host top-frame content
  scripts, CSP, no old names, no secrets or remote code), output scan, ZIP and
  ZIP verifier. The browser smoke test no longer presses Run (without the
  sign-in gate it would start a real batch).
- **Simplified:** with the gate gone, the durable "blocked / released /
  claimed" run staging (IndexedDB stages, commit/release/recovery protocol)
  was removed; the side panel queues a batch in one message. The 20-locale
  scaffold for an untranslated catalog, the version badge and the PAKS legal
  banner were removed too.

### Still open

1. **Owner question: rights.** Confirm that we may ship code derived from the
   signed "Grok Automation 2.6.3" rebuild and the Sellify helper under Drama
   Studio.
2. **More adapters:** Google Flow, ChatGPT images, Higgsfield, InVideo, one by
   one, each with a health check and stop signals.
3. **Live check of the stop signals.** The CAPTCHA, limit, moderation and
   sign-in patterns are written from the common providers and Grok's known
   wording and are unit-tested, but have not been seen against live Grok. Do
   a low-volume check on an owner-controlled account and tune
   `src/sites/grok.ts`. In particular, Grok's "Content moderated" overlay may
   sit on a result card rather than in an alert.
4. **Send results to Drama Studio** rather than only to the Downloads folder
   (section 4, Capture).
5. **CI:** add a GitHub Actions job that runs `npm ci && npm run ci` in
   `extensions/companion/` (see `docs/AI_RELEASE_HANDOFF.md`).
6. **Store listing:** final store text, privacy page from
   `extensions/companion/PRIVACY.md`, screenshots, publisher account.
7. Stay inside the sites' rules (modes 1–3 only). See section 3 of the cloud
   plan. No unattended farms, no limit bypassing, no account rotation, no
   watermark removal.

---

## 4. Wiring the desktop app to the extension

**Status:** the Companion side is in place. `src/desktop/contracts.ts` holds
the wire format (Zod), `src/desktop/native-client.ts` is the client (one
request per port, 5 s timeout, `host-missing` / `app-not-running` /
`not-paired` / `handoff-expired` / `handoff-wrong-site` errors in plain
words), the background worker routes `#ds=` hand-offs and the side panel's
link check to it, and Settings has a **Drama Studio desktop** card that asks
for the optional `nativeMessaging` permission. The native host, pairing and
Settings › Browser in the desktop app (`electron/`) are **not built**; until
they are, the Companion reports "This copy of Drama Studio does not include
the browser link yet."

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
  - `allowed_origins` lists only the Companion's extension ID. The ID is
    fixed once the store listing exists (or by adding a manifest `key`); the
    build verifier currently refuses a `key` until that decision is made.
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
  disconnects when idle. (The stub opens one port per request.)

### Mode 1: Capture (first to build)

A **Send to Drama Studio** button on generated images and videos (adapter
selectors), and on the finished queue items.

The Companion reads the media from the page's own response, then sends
`capture.import { site, prompt, model, mediaType, chunks… }`. The app replies
with the new asset's name. *Not built.*

### Mode 2: Prompt hand-off (the `#` idea, made safe)

From Generate, Short Film shots, Cast Locker or the prompt library: **Open in
Grok / Flow / ChatGPT / Gemini / Claude…**

1. The app creates a one-time hand-off with the prompt, the reference images
   and the target site, and gets back a random token valid for 5 minutes.
2. The app opens `https://<site>/…#ds=<token>` in the default browser.
3. The Companion's content script sees `#ds=` and asks the native host for
   that hand-off. It fills the prompt with the prompt-fill module and
   attaches the images through the site adapter. Then it clears the hash.
   *(Built on the Companion side, except images.)*
4. The user reviews and presses Generate. Capture then brings the result
   back.

Only the token is in the URL, never the prompt, so prompts stay out of
history and server logs. Prompts of any length work, and so do images, which
a URL can't carry. Token format: 16–128 characters of `[A-Za-z0-9_-]`.

### Mode 3: Assisted batch

Drama Studio sends a shot list (`batch.start { site, items[] }`). The
Companion runs its queue on the user's open, signed-in tab, one prompt at a
time.

- It paces like a person and stops at once on any limit, CAPTCHA, warning or
  sign-in page (section 3, done).
- Each result is captured back with its shot ID. Generate's queue shows the
  progress.
- The user can stop the batch from either side.

### Messages (first version)

| Direction | Message | Purpose | Companion side |
| --- | --- | --- | --- |
| ext → app | `hello { protocol, extVersion, browser }` → `hello.reply { appVersion, paired }` | Version check and pairing status | Built |
| ext → app | `handoff.fetch { protocol, token }` → `handoff.reply { prompt, site }` | Get a prompt hand-off | Built |
| ext → app | `capture.import` (chunked) | Import a result with its prompt | Not yet |
| app → ext | `batch.start`, `batch.cancel` | Assisted batch | Not yet |
| ext → app | `batch.progress`, `batch.stopped { reason }` | Progress and why it stopped | Schemas only |
| app → ext | `error { code }` | Any failure, as a `DesktopErrorCode` | Built |

Every message carries `id` (request/reply pairing) and `protocol: 1`. The
schemas live in `extensions/companion/src/desktop/contracts.ts`; the desktop
host must validate the same shapes.

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
2. ~~Companion skeleton from the automator workspace; rebrand; remove the
   account gate.~~ **Done 2026-10-17.**
3. Native host, pairing, `hello`, and Settings › Browser (desktop side). **M**
   The Companion side of `hello` is done.
4. Mode 2 hand-off with the `#ds=` token for Gemini, ChatGPT, Claude, Grok and
   Flow. **S** Companion side done for text; images and Flow pending.
5. Mode 1 Capture on Grok and Flow. **M**
6. ~~Limit and CAPTCHA stop~~ (done; needs a live check), then Mode 3 batch on
   Grok and Flow. **M**
7. More adapters: Google Flow, ChatGPT images, Higgsfield, InVideo. **S each**
8. Chrome Web Store and Edge listings, privacy page, Help Center articles,
   CI job.

## 7. Open questions for the owner

1. **Rights:** the Companion is derived from "Grok Automation 2.6.3" via
   Chris.dev / Paks Tools, and from the Sellify helper. Can it ship as Drama
   Studio?
2. ~~**Paks Tools platform:** drop it or keep it?~~ **Dropped** (2026-10-17):
   dashboard, API, Google sign-in, Stripe plans and the Run gate deleted;
   pairing with the desktop app replaces sign-in.
3. **Publisher account** for the Chrome Web Store and Edge Add-ons, and the
   fixed extension ID the native host will allow.
4. **Batch mode:** ship it at all, or Capture and hand-off only? Batch carries
   the most risk under each site's terms.
