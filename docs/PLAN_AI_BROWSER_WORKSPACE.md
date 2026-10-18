# Plan: AI sites in the browser as a Drama Studio route (2026-10-17)

Internal planning document. Not user-facing. It builds on
[PLAN_BROWSER_EXTENSIONS.md](PLAN_BROWSER_EXTENSIONS.md) (modes 1–3) and on
what is already built:

- The Companion extension (`extensions/companion`).
- The desktop link: native messaging host, pairing, Settings › Browser
  (`electron/companionLink/`).
- Text hand-off: prompt library › **Open in…**, via a one-time `#ds=` token.

## The idea in one line

AI sites the user is already signed into (Grok Imagine, Google Flow, ChatGPT
images, Gemini, …) become a third way to generate:

- **On this PC** (ComfyUI)
- **Cloud** (Comfy.org / own API keys)
- **Your browser** (an AI site, through the Companion)

Same simple forms, same queue, same "results land in the project". There is
no node editor: a "workflow" for a site is a small **recipe** file that names
steps the site adapter already knows.

## Where it shows up for the user

| Surface | What the user does | What happens |
| --- | --- | --- |
| **Generate** | Picks a card such as "Grok Imagine (your browser)", writes the prompt or picks one from the prompt library, adds a reference image, then **Send to Grok** | A browser job is created. The site opens with prompt, reference and aspect filled in. The user presses Generate on the site. The result comes back into the project |
| **Short Film / Director** | Sets a shot list's "Generate with" to **Your browser › Grok** | Each shot becomes a job, sent one at a time (assisted batch), each stopping on any limit |
| **Prompt library** | **Open in…** a chat site (already built) | Text-only hand-off |
| **On the AI site itself** | **Send to Drama Studio** on any generated image or video (Capture) | Imported into the open project with its prompt |
| **Browser jobs panel** (next to the generation queue) | Watches progress | Each job shows its state and why it stopped, plus Open tab, Retry and Remove |
| **AI Assistant / agents** | "Make the six shots of scene 2 with Grok" | Previews the jobs (prompts, refs, site); sends them only after **Apply** |

## How a job flows

```mermaid
sequenceDiagram
  participant U as User
  participant DS as Drama Studio (desktop)
  participant H as Native host (started by Chrome)
  participant X as Companion (extension)
  participant S as AI site tab (user signed in)
  U->>DS: Send to Grok (prompt + reference + 16:9)
  DS->>DS: create job (queued), keep refs in project
  DS->>S: open site URL with #ds=<one-time token>
  X->>H: connectNative / hello
  H->>DS: relay over the paired, authenticated pipe
  X->>DS: job.fetch(token)
  DS-->>X: job (prompt, params, reference ids)
  X->>DS: asset.fetch(id) (chunks ≤ 1 MB)
  X->>S: adapter fills prompt, attaches image, sets aspect
  Note over X,S: hand-off: the user presses Generate; batch: adapter submits, paced
  S-->>X: result appears (image/video URL in the page)
  X->>X: guard: CAPTCHA / limit / moderation / sign-in → stop job with reason
  X->>DS: capture.begin / capture.chunk (≤ 8 MB) / capture.end (sha-256)
  DS->>DS: verify, write into the project, import as asset with prompt metadata
  DS-->>U: job done; result in Assets (and in the shot, if from Short Film)
```

### Messages (protocol v2, extends v1)

| Direction | Message | Notes |
| --- | --- | --- |
| ext → app | `hello` | Version and browser label (v1, done) |
| ext → app | `handoff.fetch {token}` | Text hand-off (v1, done) |
| ext → app | `job.fetch {token}` | Returns `{ jobId, siteId, recipeId, prompt, params, references: [{id, mime, bytes}] }`; one-time, 5 minutes |
| ext → app | `asset.fetch {jobId, refId, offset}` | Reference bytes in ≤ 1 MB pieces (Chrome's limit host → extension) |
| ext → app | `job.update {jobId, state, reason?}` | `filling`, `waiting-user`, `generating`, `stopped` (with reason), `failed` |
| ext → app | `capture.begin/chunk/end` | `{jobId?, siteId, prompt, mime, size, sha256}`, then 8 MB chunks, then end |
| app → ext | `job.offer {token}` | Batch only: the desktop pushes the next job while a batch session holds the port open |
| app → ext | `job.cancel {jobId}` | Stop now |

Rules that stay as in v1:
- Only paired browsers, only the Companion's extension ID, and only while
  Drama Studio is open.
- Every message is validated on both sides.
- Tokens are one-time and short-lived. Prompts never go in URLs.
- Size limits apply on both sides, and checksums are verified before import.

## Recipes ("workflow designs" without nodes)

A recipe says **what** to do on a site. It never says **how**: no selectors
and no code. Each site adapter ships inside the extension, is reviewed, and
has a health check.

```json
{
  "id": "grok-imagine-i2v",
  "title": "Grok Imagine: image to video",
  "site": "grok",
  "kind": "video",
  "inputs": { "prompt": "required", "reference": "image, optional", "aspect": ["16:9", "9:16", "1:1"] },
  "steps": ["open", "fill-prompt", "attach-reference", "set-aspect", "submit:user", "capture:video"],
  "promptTemplate": "starter:shot-action",
  "output": { "folder": "AI Sites/Grok", "naming": "{shot}_{take}" }
}
```

- **Shipped recipes:** Grok Imagine (text→video, image→video, text→image),
  Google Flow (text→video, frames→video), ChatGPT images, Gemini images.
- **Packs can carry recipes:** a `.dspack` may list recipe JSON files. The
  importer checks them against the schema, and they show up as Generate cards.
  Steps not in the adapter's allowlist make the import refuse the recipe. Code
  in a pack is still never run.
- **`submit:user` vs `submit:auto`:** auto is allowed only in an assisted batch
  the user started, only on sites where the owner turned batch on, and paced
  per site.

## Desktop side

- `src/stores/browserJobsStore.js`: jobs, persisted per project in
  `.dramastudio/browser-jobs.json` so a restart shows what is in flight.
- `src/services/browserJobs.js`: create, cancel, retry, import result. Uses
  the normal asset import, and the Short Film shot binding when the job came
  from a shot.
- `electron/companionLink/`:
  - job store (like `handoffs.cjs`, plus `asset.fetch` and
    `capture.*` handlers)
  - writes captures to a temp file, checks the sha-256, then moves the file
    into the project
- Generate catalog: browser recipes appear as cards with a "Your browser"
  badge, under the existing route filter.
- Settings › Browser:
  - paired browsers (done)
  - per site: allow batch (off by default), and pacing
  - "Stop all browser jobs"
- MCP / Assistant tools:
  - `list_browser_sites`
  - `send_to_browser` (previewOnly first)
  - `get_browser_jobs`
  - `cancel_browser_job`
- Help Center: "Use AI sites you're signed into", in plain words: what is sent,
  that the user's own account and that site's rules apply, and how to stop.

## Companion side

- `src/sites/<site>/adapter.ts`, one per site: selectors, `fillPrompt`,
  `attachReference`, `setAspect`, `submit`, `findResult`, `healthCheck`. The
  Grok adapter exists; Flow is next.
- `src/jobs/runner.ts`:
  - runs recipe steps through the adapter
  - pacing and one job at a time per tab
  - guard checks before and after every step (CAPTCHA, usage limit,
    moderation, sign-in), which stop the job and report the reason
- Capture button: on images and videos the adapter recognises, plus a context
  menu item.

## Order of work

1. **Protocol v2 + job store + capture import** (desktop and extension), with
   contract tests on both sides. **M**
2. **Done 2026-10-18 (Companion 0.5.0):** on Grok Imagine a job fills the
   prompt, attaches the references (0.3.0), then sets the shape in Grok's own
   menu and checks it took (`aspectMenu` in `src/sites/ai-sites.ts`); results
   the adapter recognises (`resultMedia`) get an on-page **Send to Drama
   Studio** button that reuses the capture path. Live check on Grok still to
   do. Original scope: **Grok adapter steps for recipes** (fill, attach,
   aspect, find result) + **Capture** on Grok. **M**
3. **Done 2026-10-18 (Companion 0.3.0):** Generate › **AI Sites** dialog with all twelve
   sites from `extensions/companion/src/sites/ai-sites.ts`, reference upload
   through the site's own file input, and Capture on every site. Live checks per
   site still to do. Original scope: **Generate "Your browser" cards + Browser jobs panel** (hand-off mode:
   the user presses Generate). **M**
4. **Google Flow adapter.** **M**
5. **Short Film assisted batch** (`job.offer`, pacing, stop on limits).
   Needs the owner's batch decision. **M**
6. **Recipes in packs** (schema, importer, cards). **S**
7. **Assistant / MCP tools.** **S**
8. ChatGPT images, Gemini images and more adapters. **S each**

## Engineering process

- **Branches:**
  - One branch per step.
  - Merge in an integration worktree, never in the checkout another session
    is editing.
  - Run the full test suite and a build.
  - Push the branch; tags only with the owner's OK.
- **Contract tests:**
  - The message schemas are shared (`extensions/companion/src/protocol` and
    `electron/companionLink/protocol.cjs`).
  - Each side tests the other's examples, so a mismatch fails CI before it
    reaches users.
- **No real sites in CI:**
  - Adapters are tested against saved fixture pages.
  - End-to-end runs use Chrome for Testing with the unpacked extension, a
    local fixture site and a packaged Drama Studio test copy.
- **Live checks** happen at low volume on the owner's own accounts, after each
  adapter change. The health check reports selector drift to the user instead
  of failing silently.
- **Security review** of every change to `electron/companionLink/`: what can
  connect, what it may ask for, size limits, and paths written.
- **User-facing text** never describes internals. The Help Center explains
  what is sent and where it goes.

## Open owner decisions

1. Batch mode on which sites (Grok, Flow), and the pacing.
2. Rights to ship the Automator-derived code (see the extensions plan §7).
3. Chrome Web Store publisher account and a fixed extension ID. A fixed ID
   lets the installer register the host without pasting the ID.
