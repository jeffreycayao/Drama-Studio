# Plan: AI without a strong GPU or a Comfy.org key (2026-10-17)

**Goal.** Many creators have neither a 12–16 GB NVIDIA card nor the wish to buy
Comfy.org credits. They already pay for (or get free tiers of) consumer AI
apps such as Google Flow, Grok, ChatGPT, Higgsfield, InVideo or Dola. Drama
Studio should let them use those, plus cheaper pay-as-you-go APIs, and still
land every result in the project ready to edit.

**Also in scope:** loading the workflow and tool packs creators share (the zip
files passed around in creator groups), and long videos built from chained
shots (the "240 s Seedance" tools).

Prices below come from third-party trackers and change often. They are for
comparison only; check each provider's page before quoting them to users.

---

## 1. Three ways to reach a cloud model

| Route | What the user needs | Cost | Reliability | Terms risk |
| --- | --- | --- | --- | --- |
| **A. Comfy.org partner nodes** (today) | ComfyUI + Comfy.org key | Credits | High | None |
| **B. Direct API, bring your own key** (new) | A key from fal.ai, Replicate, Higgsfield, BytePlus, Google, OpenAI or xAI | Pay per second / image, often below partner-node prices | High | None (official APIs) |
| **C. Browser bridge** (new) | Their own logged-in browser + the Drama Studio Companion extension | Their existing subscription or free tier | Medium: sites change | Depends on the mode, see section 3 |

Recommendation: build **B first** (cleanest, cheapest per result, no account
risk), then **C in its safe modes**. Keep A as is.

### Approximate prices (October 2026, verify before use)

| Model | Via | Price |
| --- | --- | --- |
| Veo 3.1 Lite / Fast / Standard | Gemini API | about $0.05 / $0.10 / $0.40 per second (720p) |
| Seedance 2.5 | BytePlus ModelArk | token-billed; about $0.10/s 480p, $0.23/s 720p |
| Seedance 2.0 | fal.ai | about $0.30/s 720p |
| Kling 2.5 / 2.6 / 3.0 | Higgsfield API | about $0.042 / $0.07 / $0.084 per second |
| Grok Imagine video | xAI API | about $0.05/s 480p, $0.07/s 720p |

A 10-second 720p shot is roughly **$0.40–$4** depending on the model. That
gives the "why cloud" explanation in Setup Doctor real numbers.

---

## 2. Route B: direct providers (bring your own key)

**What the user sees.** Settings › **Cloud providers** has one card per
provider: paste a key, **Test**, see the balance where the API exposes it.
Generate gains workflows marked **Direct** next to **Local** and **Cloud**:
the same prompt, image and length fields, a price estimate, and the same
"confirm before spending" step.

**How it works.**
- **Main process:** a `providerGateway` modelled on `electron/llmGateway.js`. Keys stay in main, requests and polling run there, and output files download straight into the project.
- **Adapters:** one small module per provider: `submit`, `poll`, `cancel`, `estimateCost`, `listModels`. Start with fal.ai and Replicate (one key opens dozens of models), then Gemini API (Veo, Nano Banana), OpenAI (GPT Image), xAI (Grok Imagine), Higgsfield and BytePlus (Seedance).
- **Results:** use the existing import path: Assets › Generated › Videos/Images › model name, plus a provenance sidecar (provider, model, prompt, seed, cost, request id).
- **Queue:** jobs appear in the existing generation monitor chip and Queue panel. MCP `queue_prompt_generation_batch` gains `route: "direct"`, behind the same approval rule.

**Decided 2026-10-17 and built (0.1.18):** the setup screen has **Continue without ComfyUI** ("cloud only"). Editing, captions, translation, subtitle files and export work without ComfyUI; ComfyUI features ask for it when opened (`ensureComfyFor` in `src/stores/comfySetupStore.js`) and can open the setup screen over the running app. Direct providers and the browser bridge plug into this mode when they ship.

**Effort:** M per provider after the gateway (gateway about 1 week; each adapter 2–3 days with tests).

---

## 3. Route C: the browser bridge (Chrome extension)

**Architecture.**
- **Drama Studio Companion:** a Manifest V3 Chrome/Edge extension, published by us.
- **Channel:** it talks to the desktop app through **Chrome Native Messaging** (a native host registered when the app is installed), not through the loopback MCP port. Websites cannot reach a native host, and the MCP server already refuses browser origins on purpose.
- **Credentials:** the extension never sees or stores passwords or cookies. It works inside pages the user has already opened and signed into.
- **Site adapters:** one declarative file per site with URL patterns, the selectors for the prompt box, the generate button and the result media, plus a health check. When a site changes, only that file is updated, and a broken adapter says so instead of clicking blindly.

### Modes

| Mode | What happens | Terms risk | Ship? |
| --- | --- | --- | --- |
| **1. Capture** | A **Send to Drama Studio** button appears on generated images and videos (Flow, Grok, ChatGPT, Higgsfield, InVideo, Dola, Midjourney web...). One click imports the file with its prompt into the open project. Optional: auto-import files the user downloads from those sites. | Very low: the user generates by hand; we only move their own file | **Yes, first** |
| **2. Prompt hand-off** | From Drama Studio (Generate, Short Film shot list, Cast Locker), **Open in Flow / Grok / ChatGPT** opens the site with the prompt filled in and the reference image attached. The user presses Generate; the result comes back through Capture. | Low: a person starts every generation | **Yes** |
| **3. Assisted batch** | A shot list runs one prompt at a time: fill, submit, wait, capture, next. Paced like a person, stops at once on a CAPTCHA, a usage-limit message, a warning or an error, and shows the user why. Off by default, opt-in per site, with a clear warning. | **Medium to high:** most consumer apps' terms forbid automated use and can suspend the account | Later, only per site after reading that site's terms; Google steers automated and commercial use to Vertex AI / Gemini API (route B) |
| **4. Unattended farms** | Bypassing CAPTCHAs, free-tier or length limits, rotating accounts, removing watermarks | Violates terms; abuse | **No, never** |

Several tools passed around creator groups are mode 4. One Chrome Web Store
listing is literally called "Dola Ai Bypass 30s Automation", and others ask
for license keys to unlock limits. Drama Studio should not bundle, run or
recommend those. It can offer the legitimate parts of what they do: chaining
shots (section 5) and batch capture (modes 1–3).

**Effort:**
- Mode 1: M (extension + native host + 4 site adapters)
- Mode 2: S on top of mode 1
- Mode 3: M per site, plus ongoing upkeep as sites change

---

## 4. Loading shared workflow and tool packs

Today Generate imports one ComfyUI API-format JSON at a time. Creators trade
zip files instead. Their contents vary: ComfyUI workflows, prompt templates,
or, often, Chrome extension source code.

**Plan: an "Import pack…" action** (Generate › My Workflows, and drag-and-drop a `.zip` anywhere).

1. Unzip in the main process into a temporary folder, with limits: size, file count, no paths outside the folder, no symlinks.
2. Classify every file and show a review screen **before** anything is kept:
   - **ComfyUI workflows** (API or UI format): listed with their nodes and models; missing ones go through the existing dependency check and Workflow Setup.
   - **Prompt templates / shot lists** (`.txt`, `.md`, `.json`, `.csv`): offered as Short Film / Director templates.
   - **Media** (reference images, LUTs, audio): imported to Assets.
   - **Code** (a Chrome extension `manifest.json`, `.js`, `.py`, `.exe`, `.bat`, installers): **never run or installed.** The review explains what it is ("This is a Chrome extension. Drama Studio does not run extensions from packs.") and, for a known pattern such as "chains Seedance clips into a long video", points to the built-in equivalent.
3. Keep the accepted items under My Workflows › *pack name*, with the pack's readme and source noted.

**A Drama Studio pack format (`.dspack`)** for creators who want to share with
our users: a zip with a `manifest.json` (name, author, version, license,
contents), workflows with their bindings, prompt templates and covers.
Declarative only, never code. This lets the community trade "Seedance 240 s
long shot" recipes safely.

**Effort:** M (importer + review screen + tests with hostile zips).

---

## 5. Long videos from chained shots ("240 s" tools)

What those tools do: generate a 15–30 s clip, take its last frame (or use the
provider's extend API), continue, and repeat until the length is reached.

**Plan: a Long Shot builder** in Generate:
- **Inputs:** total length, segment length, a prompt per segment or one prompt with an "evolve" note, and the cast lock.
- **Each segment** uses the existing **Continue from last frame**, or the provider's extend endpoint when there is one (Seedance 2.5 Video Extend, Veo extend).
- **Routes:** works on all of them: local, Comfy.org, direct API (route B) or browser hand-off (route C, modes 2–3).
- **Output:** segments are placed back to back on a new timeline with optional short crossfades, then grouped as one compound clip. Any segment can be re-made on its own with **Smart Replace**.
- **Before starting:** a cost estimate covering every segment.

**Effort:** M.

---

## 6. Order of work

1. **Pack importer** (section 4): quick win, and it answers the "how do I load these zips?" question safely.
2. **Provider gateway + fal.ai and Gemini API adapters** (section 2), plus the "Cloud only" setup choice (needs the owner's decision).
3. **Companion extension, Capture + Prompt hand-off** (section 3, modes 1–2) for Flow, Grok, ChatGPT and Higgsfield.
4. **Long Shot builder** (section 5), using whichever routes exist by then.
5. Remaining adapters (xAI, OpenAI, Higgsfield, BytePlus); assisted batch (mode 3) per site, only after a terms check.

## 7. Open questions for the owner

- ~~Allow a "Cloud only, no GPU" setup that skips the required ComfyUI install?~~ Yes (2026-10-17), built.
- Which providers matter most to your users (the Philippines creator market: Flow via Google AI Pro, Grok, Dola, Higgsfield)?
- Publish the Companion extension on the Chrome Web Store (review, privacy policy), or ship it as an unpacked developer install first?
- Do you want to inspect one of the shared zips together, so the importer handles their real layout?

## Sources (prices and terms, October 2026)

- Higgsfield API: <https://higgsfield.ai/blog/higgsfield-api>
- Veo 3.1 API pricing tracker: <https://benchlm.ai/md/media-pricing/veo.md>
- Seedance 2.5 pricing: <https://blog.laozhang.ai/en/posts/seedance-2-pricing-free-vs-paid-guide.md>
- Grok Imagine video pricing: <https://wavespeed.ai/blog/cost-and-billing/grok-imagine-video-pricing/>
- fal.ai video APIs: <https://fal.ai/learn/tools/best-image-to-video-apis-2026>
- Google on commercial Veo use (Vertex AI): <https://cloud.google.com/events/veo-3-offer-cannes>
- Chrome Web Store, "Dola Ai Bypass 30s Automation": <https://chromewebstore.google.com/detail/dola-ai-bypass-30s-automa/icjmigjkcibkjclkbmpgihhnalnecppa>
- Seedance automation extension (Dreamina/Jimeng): <https://chromewebstore.google.com/detail/seedance-automation-auto/cniciedfdaehibebgdeeiobndignobnb>
- Seedance 2.5 video extend API: <https://evolink.ai/docs/en/api-manual/video-series/seedance2.5/seedance-2.5-video-extend>
