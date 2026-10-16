# Hero Conform, Auto-Ducking and SFX Library: Phase 0 cross-check

Status: Phase 0 written 2026-10-16 against the current checkout (Drama Studio 0.1.1,
Electron 44, React renderer in JavaScript, Zustand stores, Node test scripts).
Implementation followed this document; §8 records what was verified. The
bug and security audit that followed is in `docs/AUDIT_SCORECARD_2026-10-16.md`.

The request numbers the features 2, 3 and 4 (there is no Feature 1). It names the
app "Drama Studio" and asks for TypeScript files. The product is Drama Studio, and the
renderer has no TypeScript toolchain, so this work follows the Cast Locker
precedent (`docs/CAST_LOCKER_DESIGN.md`): **JavaScript + JSDoc**, pure `.mjs`
cores with Node tests, thin services, existing store actions. Adding TypeScript
for six files would mean a new compiler step, mixed-language imports and a
type-check gate that nothing else in the repo uses. Requested paths map like this:

| Requested | Implemented as | Why |
| --- | --- | --- |
| `src/services/projectConformer.ts` | `src/utils/projectConform.mjs` (pure planner) + `src/services/projectConformer.js` (queue/swap orchestration) | Pure planning is unit-testable without React or ComfyUI. |
| `src/services/audioMastering.ts` | `src/utils/audioMastering.mjs` (pure detector + automation) + `src/services/audioMastering.js` (waveform I/O) | Same split as the existing `audioDucking` util/service pair. |
| `src/types/sfx.ts` | `src/types/sfx.js` (JSDoc + normalizer + fuzzy search) and `electron/sfxCatalog.cjs` (trust-boundary validation) | Main must validate URLs/hashes itself; it cannot import renderer ESM. |
| `src/services/sfxManager.ts` | `electron/sfxLibrary.cjs` (downloads, cache, pack) + `src/services/sfxManager.js` (renderer bridge) | Network and disk belong in main; the renderer only asks. |
| `src/components/audio/SFXBrowser.tsx` | `src/components/audio/SFXBrowser.jsx` | JSX like every other component. |

## 1. What already exists

| Area | Existing code | Consequence for this work |
| --- | --- | --- |
| Music ducking | `src/utils/audioDucking.mjs` (level detector, `buildDuckingEnvelope`), `src/services/audioDucking.mjs` (sequential waveform I/O), `AudioDuckingInspector.jsx` (one music clip vs one dialogue track, audition, apply) | Feature 3 **extends** this. It reuses `getDuckingSources`, `resolveDuckingSource`, `duckingWaveformSamples` and the audition store. The old dialog stays. |
| Volume automation | `clip.volumeEnvelope` `{ version, offsetSeconds, points[{id,time,db}] }`, max 128 points, -60..+12 dB; `updateAudioVolumeEnvelope` store action; `AudioVolumeEnvelope.jsx` draws editable points on the timeline clip | Ducking output is an ordinary envelope, so it is visible, editable, saved, undoable and already understood by preview and export. |
| Preview | `audioVolumeAutomation.mjs` schedules the envelope on a dedicated `GainNode` with `exponentialRampToValueAtTime` on the audio clock | No new preview code: ducking is heard exactly as drawn. |
| Export | `export:mixAudio` (main) → `electron/audioVolumeEnvelope.mjs` → `aeval='val(ch)*(pow(10,(dB sum)/20))'` per clip, after trim/tempo, before `adelay` | Ducking already reaches FFmpeg as a **dynamic volume** filter. No new filtergraph is needed (see §3.3). |
| Waveforms | `media:getAudioWaveform` IPC: FFmpeg decode to f32le, per-bucket **peak** only, cached by path/mtime | RMS needs an opt-in extension (§3.2). |
| Source swap | `buildSmartReplacePlan` (`smartReplace.mjs`) + `previewSmartReplace`/`applySmartReplace` | Feature 2's "swap without changing edit points, transitions or audio alignment" is **exactly** Smart Replace: it keeps `startTime`, `duration`, trims, speed (materializes `sourceTimeScale` when FPS changes), validates transition handles, and leaves linked audio untouched. |
| Generation queue | `GenerateWorkspace.jsx` (20k lines). The MCP bridge `comfystudio-mcp-queue-prompt-generation-batch` queues up to 24 jobs `{ workflowId, prompt, negativePrompt, seed, resolution, duration, fps, assetFieldIds }`; `comfystudio-mcp-get-generation-queue-status` reports `resultAssetIds` | The conformer queues hero jobs through this existing bridge, so dependency checks, ComfyUI connection checks, uploads, `runJob` and asset import stay single-sourced. |
| Generated assets | `saveGenerationResult` stores `prompt`, `settings.seed/duration/fps/resolution/inputAssetId`, but **not** the workflow id, negative prompt or extra asset fields | Provenance is incomplete today. A `settings.generation` record is added at import time (§2.2). Older assets can only be conformed if the user picks a workflow. |
| Online browser precedent | `StockPanel.jsx` + `pexelsStock.js` (search → download → `importAsset` → `addAsset`) | SFX follows the same "copy into the project" rule, so projects stay portable. |
| Timeline drops | `Timeline.handleDrop` reads `assetId` / `application/x-comfystudio-asset-ids`, then `addClip` | SFX adds one more payload type. `DataTransfer` is only readable synchronously, so the payload is read **before** the first `await`. |
| MCP / chat | `electron/mcpServer.js` definitions, `src/services/mcpActions.js` handlers; `chatAgent.js` lists MCP tools | New tools: `auto_duck_music` and `conform_draft_clips`, both `previewOnly` by default, so the chat panel gets Apply/Cancel for free. |

## 2. Feature 2: dual-pass render (draft proxies → hero render)

### 2.1 Cross-check against the spec

| Spec item | Finding | Decision |
| --- | --- | --- |
| "Clips keep `renderMode`, workflow, prompt, seed, trims" | Trims already live on the clip (`trimStart`, `trimEnd`, `speed`, `sourceTimeScale`). Prompt/seed live on the **asset** that was generated, and many clips can share one asset. Copying prompt/seed onto every clip would desynchronize on split/duplicate. | Provenance lives on the asset (`asset.settings.generation`). The clip keeps only `renderMode` (`'draft' \| 'hero'`) and, after a swap, `conform: { draftAssetId, heroAssetId, conformedAt }`. `getClipRenderMode(clip, asset)` resolves the effective mode. |
| "Compute the exact visible range, ignore trimmed handles" | Diffusion video cannot render "seconds 2.1–4.3 of seed 1234": frame count is part of the latent shape, so a shorter request is a **different** video, and image-to-video always starts at the keyframe. Rendering only the visible range would not match the draft. | The planner computes the exact visible source range per clip, **plus** transition handles (same math as Smart Replace), and uses it to (a) skip drafts no visible clip uses, (b) dedupe: one hero job per draft asset even when several clips use it, (c) check that the hero will cover every clip after the swap, (d) show the cost. Hero jobs regenerate the **full draft duration** with the stored seed, so the visible range lands on the same moment. Range-limited rendering only makes sense for a future video-to-video refine/upscale strategy; the plan has a `strategy` field for it. |
| "Higher resolution, full steps, upscalers" | Bundled workflows bake steps into their graphs (the fast local ones use 4-step Lightning LoRAs). There is no per-job `steps` input. Upscaling exists as separate tools (RTX export upscale, Topaz cloud). | Hero settings: **hero workflow** (defaults to the draft workflow; the user can pick a full-step or custom workflow with the same input shape), **resolution scale** (1×, 1.5×, 2×, snapped to multiples of 16, capped at 3840 px on the long edge). Upscaling stays a separate, explicit step. |
| "Queue high-fidelity ComfyUI jobs" | Generation spends GPU time or cloud credits. | Queueing needs an explicit confirmation listing every job, workflow and resolution. MCP `conform_draft_clips` is `previewOnly` unless `previewOnly: false`. |
| "Swap hero renders onto the timeline without changing edit points, transitions or audio alignment (undoable)" | Smart Replace already guarantees this for one clip, with one undo step per clip. | New store action `applyHeroConform({ swaps })`: builds a Smart Replace plan for every swap, applies **all or nothing** in **one** history checkpoint, sets `renderMode: 'hero'` and `conform`. Linked audio companions are not touched (Smart Replace semantics), so dialogue/music alignment cannot drift. |

### 2.2 Data flow

```
Generate (GenerateWorkspace.saveGenerationResult)
  └─ asset.settings.generation = { version:1, workflowId, workflowLabel, prompt, negativePrompt,
                                   seed, resolution{w,h}, duration, fps, assetFieldIds, inputAssetId,
                                   renderMode: 'draft'|'hero', conformOf?: draftAssetId }
Timeline clip ── clip.renderMode ('draft' default for generated media, toggled in the Inspector)
Conform dialog (renderer)
  ├─ planProjectConform(timeline, assets, heroSettings)        ← pure, unit-tested
  │     per draft asset: visible ranges (+handles), clipIds, hero job, blockers, hero asset if ready
  ├─ user confirms GPU/credit spend
  ├─ projectConformer.queueHeroRenders → 'comfystudio-mcp-queue-prompt-generation-batch'
  │     (opens Generate tab if needed; ≤24 jobs per batch; job carries conform.draftAssetId)
  ├─ GenerateWorkspace runJob → ComfyUI :8188 (GPU) → saveGenerationResult
  │     new asset: settings.generation.renderMode='hero', conformOf=draftAssetId
  └─ "Swap" → timelineStore.applyHeroConform({ swaps })   ← one undo step
        each swap = buildSmartReplacePlan(clip, heroAsset) on the CURRENT timeline
Export ── unchanged: clips now reference the hero asset; draft remains in the project bin.
```

The hero asset itself records which draft it belongs to, so the "ready to swap"
state survives an app restart, a closed dialog or a lost queue. Nothing about
in-flight jobs needs to be persisted.

### 2.3 Conflicts and races

- **Edits during a long hero render.** The swap re-plans against the live
  timeline at apply time and targets *every* clip that still references the
  draft asset (including pieces split after queueing). A clip whose transition
  handles no longer fit in the hero source is refused with Smart Replace's
  message and the whole apply is refused (no partial conform).
- **Clip busy.** Smart Replace refuses clips with a running render cache or
  Optical Flow job; the dialog reports them.
- **Project switch.** The Generate queue imports into the *origin* project
  (`job.originProject`). The conform dialog only plans against the open
  project's assets, so a hero rendered for another project never swaps here.
- **Duplicate queueing.** A draft with a hero asset already imported, or with a
  queued/running conform job in the Generate queue, is reported as such and not
  queued again unless the user asks for a re-render.
- **Missing inputs.** Image-to-video drafts need their keyframe asset
  (`inputAssetId`) to still exist; extra fields (`assetFieldIds`) are replayed.
  Cast-locker bindings and timeline-frame inputs are not replayable and are
  reported as blockers.

### 2.4 Performance

The planner is O(clips + transitions) and runs on demand. VRAM: hero jobs go
through the same serial Generate queue, so nothing runs concurrently with
other generations. Higher resolution raises VRAM roughly with pixel count; the
dialog shows the target size and warns above 1.5× for local workflows. Disk:
each hero asset is a new file in `assets/`; drafts are kept for revert.

## 3. Feature 3: dynamic mastering and auto-ducking

### 3.1 Cross-check against the spec

| Spec item | Finding | Decision |
| --- | --- | --- |
| Designate tracks Dialogue / BGM | `track.role` exists but means "restricts what clips can live here" (captions). Reusing it would change drop rules. | New `track.mixRole: 'dialogue' \| 'bgm' \| 'sfx'` via `setTrackMixRole` (one undo step). Persisted with the timeline, visible in the dialog. |
| RMS/peak sidechain detection | The detector uses per-20 ms **peak** only. Peak triggers on clicks and breaths; RMS follows speech energy. | `media:getAudioWaveform` gains an opt-in `includeRms` (separate cache key; default callers unchanged). Detector modes `rms` (default) and `peak`, with **hysteresis** (open at threshold, close 6 dB lower) and a minimum speech length, so short consonant gaps do not flutter. Browser-only sources fall back to peak. |
| Attenuation -14 dB, attack 60 ms, hold/decay 500 ms | The existing builder has symmetric fades and a fixed 200 ms hold. | Separate `attackMs` (ramp down, finished **at** speech onset, since offline analysis can look ahead), `holdMs` (stay down after speech ends) and `releaseMs` (ramp back up). Defaults: -14 dB, 60 ms, 500 ms, 300 ms. |
| Visible volume keyframes on the BGM track | Envelope points are already drawn and editable on the timeline clip. | Output is an ordinary `volumeEnvelope`. |
| Re-running | The existing dialog stacks attenuation on each pass. | `clip.autoDucking = { version, baseEnvelope, appliedEnvelope, settings }`. If the envelope is still exactly what auto-duck applied, a re-run **replaces** the previous pass and "Remove auto-ducking" restores the base. If the user edited points afterwards, their edit becomes the new base and the dialog says so. |
| 128-point limit | A long BGM clip with many lines needs 4 points per dip and can exceed the cap. Raising the cap is not free (§3.4). | When the plan would exceed the cap, the planner merges the closest dips (extending the duck across short gaps, never shortening one) until it fits, and reports how many were merged. |
| Export via `sidechaincompress` or dynamic volume | `sidechaincompress` would make export differ from preview (Web Audio has no equivalent), would be invisible on the timeline, could not be edited per point, and would duck on SFX/music bleed. | Export uses the **existing dynamic-volume path**: the baked envelope becomes `aeval` gain in `export:mixAudio`. Preview, export and the drawn curve are the same function (`getAudioVolumeEnvelopeDb`). A test evaluates the generated FFmpeg expression against the planner. |

### 3.2 Data flow

```
Auto-duck dialog
  ├─ setTrackMixRole(trackId, 'dialogue'|'bgm')                ← history
  ├─ audioMastering.analyzeAutoDucking(state, assets, settings)
  │     sources: every audible clip on dialogue tracks overlapping each BGM clip
  │     (getDuckingSources per dialogue track: compound projection, mute/solo, reverse)
  │     → sequential media:getAudioWaveform(path, { includeRms }) in main (FFmpeg)
  │     → detectSpeechActivity (RMS + hysteresis, clip gain/fades/envelope/track volume)
  │     → buildAutoDuckingEnvelope (attack/hold/release, merge-to-fit, knee preservation)
  ├─ "Listen ducked" uses the existing audition store (useAudioDuckingPreview)
  └─ Apply → timelineStore.applyAutoDucking({ updates })      ← one undo step for all BGM clips
Preview: GainNode envelope schedule (unchanged)
Export (hidden worker → export:mixAudio): aeval dynamic volume (unchanged)
```

### 3.3 Races

Analysis is read-only. Results carry the exact clip objects they were computed
from; `applyAutoDucking` refuses if any BGM clip object changed (moved,
trimmed, re-enveloped) since analysis, the same identity check
`updateAudioVolumeEnvelope` uses. Waveform decodes run one at a time and reuse
the existing in-flight guard, so repeated clicks cannot stack FFmpeg processes.

### 3.4 Performance

Analysis decodes each unique dialogue source once at 8 kHz (≈32 KB/s of PCM)
in main, off the UI thread; RMS adds one multiply-add per sample. The renderer
receives at most 32,768 buckets per source. The planner is O(buckets).
Export cost of `aeval` is O(points) per sample, which is why the 128-point cap
stays and dips are merged rather than raising it.

## 4. Feature 4: SFX library and cloud asset manager

### 4.1 Cross-check against the spec

| Spec item | Finding | Decision |
| --- | --- | --- |
| `sfx-catalog.json` ~1.5 MB with id, name, category, subCategory, tags, duration, fileSize, remoteUrl, localPath | Fine as a schema. `localPath` cannot be trusted from a downloaded file (path traversal). | Catalog `version: 1`, `baseUrl`, `entries[]` with the requested fields plus `sha256` and optional `format`/`license`. `localPath` is treated as a **relative hint** and re-derived from `id` + extension inside the cache folder. |
| Zero-egress hosting (R2 / Hugging Face), not Google Drive | Drive throttles, rewrites URLs and has no reliable Range support. | Any HTTPS origin that serves `Accept-Ranges: bytes`. The catalog URL is a setting; downloads are allowed only from the catalog's own origin (`baseUrl` may set a base path on that origin, never a new origin). No bucket is hard-coded (the project has none yet); `scripts/build-sfx-catalog.mjs` builds a catalog with SHA-256 from a local folder for publishing. |
| Range-request streaming for instant preview | Chromium `<audio>` already issues Range requests and starts playing after the first chunk; there is no CSP blocking remote media. Proxying through IPC would add latency. | Preview plays the remote HTTPS URL directly (or the cached file when present). No download for preview. |
| On-drag download that resolves before drop finalizes | `dragstart` → `sfx:resolve(id)` starts at once (most SFX are under 1 MB, so it usually finishes before the drop). The drop reads the payload synchronously, then awaits the same in-flight promise (deduped per id in main), copies the file into the project (`importAsset`), adds the asset and calls `addClip`. | The drop shows "Downloading…" until it lands; a failed download or a changed project discards the drop. |
| Settings batch downloader (~5 GB) with pause/resume, progress, SHA-256 | — | Main-process pack downloader: 3 concurrent files, `.part` files resumed with `Range: bytes=N-` (restart if the server ignores Range), streaming SHA-256, atomic rename, throttled progress events (≤4/s), pause = abort keeping `.part`, cancel = abort and delete `.part`. Free-space check before starting. |
| Fuzzy search, category filters, waveform preview, drag-and-drop | Catalog is ~10k entries: in-memory search is fast enough. | Token-prefix + subsequence scoring over name/tags/category, debounced, top 200 results. Waveform preview draws the cached file via the existing waveform IPC once downloaded; before that a progress bar shows playback. |

### 4.2 Data flow

```
Settings > SFX Library: catalog URL (setting 'sfxLibrary'), cache size, offline pack controls
SFX tab (Left panel) ─ sfxManager.getCatalog() ─ IPC sfx:getCatalog ─ main: cached JSON or HTTPS fetch
                                                  validate (electron/sfxCatalog.cjs) → userData/sfx/catalog.json
  search/filter in renderer (src/types/sfx.js)
  preview: <audio src=remoteUrl | file url>    (Chromium Range streaming)
  dragstart: payload application/x-drama-sfx {id} + sfx:resolve(id) (main: download → sha256 → rename)
Timeline drop: read payload sync → await resolve → importAsset(project, cachePath, 'audio')
               → addAsset({ source: 'sfx-library', sfx: { id, catalogVersion } }) → addClip  ← history
Offline pack: sfx:pack:start|pause|resume|cancel|status, events sfx:pack:progress
Cache: %APPDATA%/Drama Studio/sfx-cache/<category>/<id>.<ext>  (project gets its own copy)
```

### 4.3 Security

- Only `https:` URLs to public hosts (plus loopback when tests opt in), and
  only on the catalog's own origin; a `baseUrl` on another origin is ignored.
  Loopback, private, link-local, CGNAT and IPv4-mapped IPv6 literals and
  `localhost`/`.local` names are refused for the catalog, entries and
  redirects. Redirects are followed at most 3 times and re-checked.
- Entry ids are restricted to `[A-Za-z0-9._-]{1,128}`; file names are derived,
  never taken from the catalog. Every cache path is checked to stay inside the
  cache folder.
- Files are size-capped (catalog `fileSize` + 1 %, hard limit 200 MB) and
  verified with SHA-256 when the catalog provides one. A mismatch deletes the
  file.
- Catalog JSON is capped at 32 MB and validated entry by entry; bad entries are
  dropped and counted, not fatal.

### 4.4 Races and performance

- One in-flight download per id; drag, preview-cache and pack share it.
- Pack downloads yield to on-demand resolves (they use a separate slot), so a
  drag never waits behind the 5 GB queue.
- Main-process streaming writes keep memory flat; progress events are
  throttled so the renderer is not flooded.
- The renderer holds the catalog once (≈10k small objects); search is
  debounced (120 ms) and returns at most 200 rows, rendered in a simple
  windowed list.

## 5. File layout

```
docs/CONFORM_MASTERING_SFX_DESIGN.md        this document (+ integration guide §6)
electron/sfxCatalog.cjs                     trust-boundary catalog/URL/path validation
electron/sfxLibrary.cjs                     cache, resolve, range-resume downloads, offline pack, IPC
electron/main.js                            registers sfx IPC; waveform IPC gains includeRms
electron/preload.js                         electronAPI.sfx.*
scripts/build-sfx-catalog.mjs               build a catalog (SHA-256, size, duration) from a folder
src/types/sfx.js                            JSDoc schema, normalizer, fuzzy search
src/services/sfxManager.js                  renderer bridge + drop resolver
src/components/audio/SFXBrowser.jsx         search, filters, preview, drag source
src/components/audio/SfxLibrarySettings.jsx Settings section: catalog URL, pack downloader
src/utils/audioMastering.mjs                mix roles, RMS detector, attack/hold/release envelope
src/services/audioMastering.js              waveform I/O for auto-ducking
src/components/AutoDuckingDialog.jsx        roles, settings, analyze, audition, apply/remove
src/utils/projectConform.mjs                provenance, visible ranges, conform planning
src/services/projectConformer.js            queue hero jobs, find hero assets, swap
src/components/ConformDialog.jsx            draft list, hero settings, approve, swap
src/stores/timelineStore.js                 setTrackMixRole, applyAutoDucking, setClipRenderMode, applyHeroConform
src/components/GenerateWorkspace.jsx        stamp settings.generation; carry job.conform
tests + src/**/*.test.mjs                   test:auto-ducking, test:conform, test:sfx-library
```

## 6. Integration guide

### 6.1 Main ↔ renderer IPC

| Channel | Direction | Payload → result | Notes |
| --- | --- | --- | --- |
| `media:getAudioWaveform` | renderer → main | `(path, { sampleCount, sampleRate, includeRms? })` → `{ peaks, channelPeaks, duration, rms? }` | `includeRms` is opt-in and cached separately. |
| `sfx:getCatalog` | renderer → main | `{ refresh? }` → `{ configured, entries, dropped, warning }` | Reads setting `sfxLibrary.catalogUrl`; validated in `electron/sfxCatalog.cjs`. |
| `sfx:resolve` | renderer → main | `id` → `{ path, cached }` | Downloads if needed; one transfer per id. |
| `sfx:status` | renderer → main | `ids[≤500]` → `{ status: { id: 'cached' \| 'remote' \| 'downloading' \| 'unknown' } }` | |
| `sfx:previewSource` | renderer → main | `id` → `{ cached, url }` | `comfystudio://` for cached files, else the HTTPS URL (streamed by Chromium). |
| `sfx:pack:start\|pause\|resume\|cancel\|status` | renderer → main | → `{ pack }` | Progress also pushed on `sfx:pack:progress` (≤4/s). |
| `sfx:cache:info\|clear` | renderer → main | → `{ files, bytes }` | Clear refuses while downloads run. |

Preload exposes these as `window.electronAPI.sfx.*`; the renderer only ever
passes ids and flags. Never add an IPC that takes a URL or a destination path
from the renderer for SFX.

### 6.2 Hooking into timeline state

All writes go through `timelineStore` actions (history, dirty tracking,
autosave and MCP snapshots stay correct):

| Action | Purpose | History |
| --- | --- | --- |
| `setTrackMixRole(trackId, 'dialogue' \| 'bgm' \| 'sfx' \| null)` | Track roles | one step |
| `applyAutoDucking({ updates: [{ clipId, expectedClip, envelope, autoDucking \| null }] })` | Apply or remove ducking on many clips; refuses if any `expectedClip` changed | one step |
| `setClipRenderMode(clipIds, 'draft' \| 'hero' \| null)` | Mark picture clips | one step |
| `applyHeroConform({ swaps: [{ clipId, draftAssetId, asset }] })` | Smart Replace every swap, all or nothing | one step |
| `addClip(...)` (existing) | SFX drop | one step |

Read-only planners are pure and reusable from the chat agent or MCP:
`analyzeAutoDucking` (service), `planAutoDuckingTargets`,
`detectSpeechActivity`, `buildAutoDuckingEnvelope` (utils);
`planCurrentConform` (service), `planProjectConform`, `buildHeroSwaps`
(utils). MCP tools: `set_track_mix_role`, `auto_duck_music`,
`conform_draft_clips` (all `previewOnly` by default; `conform_draft_clips`
queues renders only with `mode: "queue"` and `previewOnly: false`).

### 6.3 Generation hand-off

`GenerateWorkspace.saveGenerationResult` stamps `asset.settings.generation`
(see §2.2). The prompt-batch bridge accepts `jobs[].conform.draftAssetId` and
reports `conformDraftAssetId` in queue status. To add another generation path
to the conform system, stamp the same record when importing its output.

### 6.4 Publishing an SFX pack

1. Arrange files as `<Category>/<SubCategory>/<name>.wav` (optional
   `<name>.tags.txt` with comma-separated tags).
2. `npm run sfx:catalog -- <folder> --base-url https://<bucket>.r2.dev/sfx/ --out <folder>/sfx-catalog.json`
3. Upload the folder unchanged to R2 (public bucket or custom domain) or a
   Hugging Face dataset, so each `remoteUrl` resolves under `--base-url`.
   Hugging Face serves large files from a CDN redirect; that is allowed only
   because every entry carries a SHA-256.
4. Paste the catalog URL in Settings › Sound effects library.

## 7. Out of scope (follow-ups)

- Video-to-video refine/upscale hero strategy that renders only the visible range.
- Per-workflow "hero variant" registry (e.g. Lightning → full-step pairs).
- EQ/insert-aware detection (detection reads the dry dialogue levels).
- Publishing a real SFX bucket and catalog.
</content>
</invoke>

## 8. Verification (2026-10-16)

Verified:

- `npm run test:auto-ducking` (48), `test:conform` (17), `test:sfx-library`
  (19), `test:security-hardening` (4). Coverage: detector, attack/hold/release
  timing, merge-to-fit, replace-not-stack, the generated FFmpeg `aeval`
  expression against the planner sample by sample, one-step store applies and
  refusals, conform planning/blockers/queue batching/swap preserving edit
  points, catalog validation, Range resume, servers that ignore Range or
  answer the wrong range, SHA-256 mismatch, redirect gate, pack
  pause/resume/cancel, and a builder → catalog → download round-trip on
  generated WAVs.
- Every other `test:*` suite passes except the two RIFE suites, which already
  fail on Windows checkouts.
- `DS_SKIP_VERSION_BUMP=1 npm run build` passes (version unchanged, existing
  chunk-size warnings).
- UI pass in a browser harness (real components and stores, mocked desktop
  bridge, synthetic data): SFX search and settings, auto-duck end to end,
  conform plan → confirmation → hero swap. No console errors.

Not verified:

- No real ComfyUI hero render was queued (needs ComfyUI or cloud credits).
- No real R2 / Hugging Face bucket: downloads were tested against a loopback
  HTTP server.
- The Electron app was not launched (to avoid touching the live profile and
  the MCP port): native drag-and-drop from the SFX tab onto the timeline, the
  Mixer/Inspector entry points and the packaged IPC wiring were checked by
  build and code review only.
