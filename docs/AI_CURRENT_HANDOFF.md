# Current AI Handoff

Last updated: 2026-10-16

## Idea Pad, script import, frame chaining, songwriter — local, uncommitted

Coverage of the five-stage studio list (existing / added / blocked):
`docs/WORKSPACE_COVERAGE_2026-10-16.md`.

- Idea Pad: top tab `idea-pad` (`IdeaPadWorkspace.jsx`, React Flow), data in
  `currentProject.ideaPad` via `projectStore.get/setIdeaPadData`
  (`src/types/ideaPad.js`). Saves are bound to the project handle they were
  loaded from. Not part of timeline undo.
- Shared one-shot LLM helper `src/services/storyAssistant.js` (Assistant
  backend from Settings › Agents); JSON replies via `src/utils/llmJson.mjs`.
- `src/utils/screenplayParser.mjs` (Fountain + FDX → model → Fountain);
  Short Film "Import script" and the Idea Pad → Short Film hand-off
  (`drama-short-film-import-screenplay` event + its localStorage draft).
- Frame chaining: Timeline clip menu "Continue from last frame (AI)…"
  (`src/utils/frameChaining.mjs`, reuses `captureTimelineFrameAt` and the
  Extend with AI path).
- Songwriter: Music popover "Write with AI" (`src/utils/songwriter.mjs`).
- Blocked (not faked): MiniMax Music / YuE / Stable Audio workflows, Sora,
  LivePortrait/MuseTalk timeline lip-sync.
- Tests: `npm run test:story-tools`.

## Hero conform, auto-ducking, SFX library + security audit — local, uncommitted

Design, Phase 0 cross-check, integration guide and verification:
`docs/CONFORM_MASTERING_SFX_DESIGN.md`. Audit scorecard:
`docs/AUDIT_SCORECARD_2026-10-16.md`. JavaScript + JSDoc (no TypeScript).

- Auto-ducking: `track.mixRole` ('dialogue' | 'bgm' | 'sfx'), RMS detector
  with hysteresis (`media:getAudioWaveform` gained opt-in `includeRms`),
  attack/hold/release envelopes written as ordinary `volumeEnvelope` points,
  so preview and export (`aeval` dynamic volume) need no changes. Entry
  points: Mixer "Auto-duck…", Audio inspector, MCP `auto_duck_music`.
- Conform: provenance in `asset.settings.generation` (stamped in
  `saveGenerationResult`), `clip.renderMode`, hero jobs through the existing
  prompt-batch bridge (`jobs[].conform`), swap via `applyHeroConform` (Smart
  Replace, one undo step). Hero renders regenerate the full draft length with
  the same seed (diffusion cannot render a sub-range of a seed).
- SFX: main-process `electron/sfxLibrary.cjs` + `sfxCatalog.cjs` (ids only
  over IPC, HTTPS + origin-locked, Range resume, SHA-256, size caps, offline
  pack). Renderer: Left panel "Sound effects" tab, Settings › Sound effects
  library, timeline drop of `application/x-drama-sfx`. No bucket exists yet;
  `npm run sfx:catalog` builds one.
- Security fixes: the MCP server now rejects browser `Origin`, non-loopback
  `Host` and non-JSON POSTs (it was drivable from any website); the generic
  settings IPC no longer exposes `chatApiKey.*`; the ComfyUI bridge accepts
  workflows only from the local ComfyUI origin.
- Tests: `test:auto-ducking`, `test:conform`, `test:sfx-library`,
  `test:security-hardening`. Not verified: real ComfyUI hero renders, a real
  R2/HF bucket, and the Electron app itself (UI checked in a browser harness).

## Cast & Wardrobe Locker — local, uncommitted

Design and Phase 0 cross-check: `docs/CAST_LOCKER_DESIGN.md`. JavaScript +
JSDoc (the maintainer chose not to add TypeScript), both binding modes.

- Registry: `currentProject.cast` via `projectStore.getCastData/setCastData`
  (FlowAI pattern; legacy projects normalize to empty). Schema and normalizers
  in `src/types/cast.js`. Anchors and outfit photos are project asset ids.
- Mode A (bundled workflows) runs in `GenerateWorkspace` `createQueuedJob`,
  before source-asset snapshots: `applyCastToJob` routes face / wardrobe /
  scene images into each workflow's slots and prepends a role-labelled prompt.
  Short Film keyframes bind automatically when a film character's name matches
  a cast member or alias.
- Mode B (custom graphs) runs in `runJob` just before `queuePrompt`: PuLID /
  InstantID / IP-Adapter FaceID `LoadImage` inputs get the uploaded anchor.
  Unit-tested only; not runnable on an 8 GB GPU without those custom nodes.
- UI: title-bar "Cast" button (shows the active lock), `CastLockerDrawer`
  (anchors with square crop, outfits, per-scene outfits, generation lock,
  clip tagging via `timelineStore.setClipCast`, one undo step).
- Run `npm run test:cast-locker`. Verified in a packaged build: anchor upload
  and crop, rename, outfit, lock indicator and project-file persistence. A
  real generation with a cast lock has not been run (needs ComfyUI or a cloud
  key).

## Setup Doctor and guided tours — local, uncommitted

- `electron/setupDoctor.js` (IPC `setupDoctor:nativeChecks`) is read-only: it
  runs bundled FFmpeg/FFprobe `-version`, write-tests the projects folder (one
  temp dot-file) and reads free space, resolves the RIFE runtime, summarizes
  Chromium GPU features, and probes hardware (`nvidia-smi`, then the Windows
  display-class registry `HardwareInformation.qwMemorySize`, Apple Silicon
  unified memory, then Chromium vendor ids).
- `src/utils/setupDoctorReport.js` is the pure report builder, including
  `assessLocalAi()`: conservative VRAM/RAM/vendor thresholds that decide
  whether a local LLM, local image and local video generation are good,
  limited, or better in the cloud, each with translatable reasons.
- `src/services/setupDoctor.js` gathers facts in parallel (each probe fails
  soft); `src/components/SetupDoctorPanel.jsx` renders it at the top of
  Getting Started; the welcome header shows a "Setup: N to fix" chip.
- Guided tours use driver.js 1.8.0 (MIT, pinned) in `src/services/guidedTour.js`,
  anchored on `data-tour` attributes. Each context (welcome, editor) is offered
  once (localStorage `drama-studio-tour:<context>:v1`); Getting Started →
  Quick Tour → "Start guided tour" replays it.
- Every new English string has a Japanese counterpart (`test:i18n` enforces
  key and placeholder parity). Run `npm run test:setup-doctor`.

## Electron 28 → 44 upgrade — local, uncommitted

The maintainer decided to stay on Electron (a Rust/Tauri migration was
evaluated and rejected) and to upgrade to the latest Electron. `electron` is
now `^44.7.2`; `electron-builder` stays on 26.x. Code changes:

- `File.path` (removed in Electron 32): preload exposes
  `electronAPI.getPathForFile(file)` via `webUtils`; `imageSequenceImport.js`
  uses it, with a `File.path` fallback for older runtimes and test doubles.
- `console-message` positional args (deprecated in 35): main-window and
  export-worker log mirrors read `event.level/message/lineNumber/sourceId`.
- Electron 42+ no longer downloads its binary in `postinstall`: the CI test
  workflows run `npx install-electron --no` after `npm ci`, before the Linux
  `chrome-sandbox` chown. Locally, `npx electron .` or `npx install-electron --no`.
- The `electron` package requires Node >= 22.12: CI and `Dockerfile.linux-build`
  moved from Node 20 to 22. The unsupported `--experimental-default-type=module`
  flag was removed from the test scripts (ESM syntax detection is the default
  in Node 22.12+).
- Electron 44 drops macOS 12, Windows ia32 and Linux armv7l. Release
  targets are x64/arm64 only, so no build config changed, but release notes
  must state macOS 13+ is now required.

Local Windows validation: 60 of 62 `test:*` suites pass. The two RIFE suites
fail on POSIX executable-permission assertions on Windows, which is unrelated
to Electron. A packaged smoke build needs the CI-built RIFE runtime, so the full
Win/mac/Linux packaged validation must come from GitHub Actions. The Linux
Detect Beats renderer crash reproduced on 28.3.3 has not been rechecked on 44.

## v0.3.37 release preparation — authorized

After confirming that the Linux test build no longer crashes during **Detect
Beats → Markers**, the maintainer approved keeping the existing beat-grid
algorithm unchanged and requested a new release of the three fixes below. They
explicitly authorized the CLA confirmation and the usual Windows installer and
portable, macOS Apple Silicon and Intel, and Linux AppImage and deb builds.

Use `codex/discord-hotfixes`, based on published v0.3.36 / `fdd8255`, through the
normal PR/CLA/main/tag/GitHub Actions process. Version metadata is `0.3.37`; release
copy is in `docs/RELEASE_NOTES_0.3.37.md`. Keep the GitHub release **draft and
unpublished** for maintainer review. Do not merge unrelated open PRs or copy
unreleased features from the normal checkout. The earlier local-only limits
below are historical; this paragraph records the current release authorization.

Local validation includes 32 focused timeline tests, 40 focused audio tests with
real native binaries and no skips, nine browser timeline groups, eight isolated
Electron groups, the Linux packaging/provenance gates, an actual built-app.asar
native analysis smoke, and the maintainer's Linux crash reproduction now passing.
The independent pre-release code review found no blocker. Windows/macOS runtime
verification is not inferred from Linux; check the new targeted CI matrix and
the release workflow before reporting platform builds/signatures complete.

## Discord timeline hotfixes — local, unreleased

Current work is isolated in `codex/discord-hotfixes`, based exactly on published
v0.3.36 / `fdd8255fb717db024688a2582022aa048dd16e84`. The managed checkout is
`/home/jaime/.codex/worktrees/discord-hotfixes/velorn`; the normal checkout and
unrelated local integration/mobile work are preserved. No commit, push, tag or
release is authorized by the current fix request.

- Deleting a selected empty gap now shifts every downstream track together,
  including independent audio. The maintainer explicitly chose to refuse the
  whole edit if other media occupies that interval, rather than cutting it.
  Protected/busy participants, stale selections, partial linked groups and
  unsafe transitions also refuse without mutation. The toolbar and Delete
  shortcut show a readable explanation. One atomic checkpoint preserves Undo;
  existing clip-delete/ripple-trim behavior and marker/In-Out/playhead policy
  are unchanged.
- Split enablement now subscribes to live playhead eligibility in its own small
  component; the full timeline remains unsubscribed from playback ticks.
  Toolbar Split and X resolve the current active-track target when invoked.
  Seeking after a cut no longer requires switching track headers.
- Run `npm run test:timeline-hotfixes` for focused planner/store/Split tests.
  Run `npm run check:timeline-hotfixes` against a separate loopback Vite server
  using `VELORN_TEST_URL`, `PLAYWRIGHT_MODULE_PATH` and optionally `CHROME_PATH`.
  This browser fixture uses synthetic in-memory stores, no native IPC or user
  projects, and blocks external network/provider traffic. Do not run the real
  desktop app or restart the maintainer's session as part of these checks.

Local validation: 261 focused and neighboring timeline tests pass; nine actual
Timeline browser regression groups pass with no page errors or provider/API
requests. The overlap-refusal warning was visually checked. Production renderer
build and `git diff --check` pass (existing bundle/import/Browserslist warnings).
Those first two fixes did not change native/Electron IPC code. The separately
authorized audio fix below does; packaged Windows/macOS validation has not been
performed.

The audio-analysis black-window report is separate. The maintainer reproduced
a display-process crash on Linux and provided `crash-diagnostics/latest-events.json`
for read-only investigation after these two fixes. It records a main-renderer
crash with exit code 11 on Electron 28.3.3; it contains no native stack. A prior
GPU compositor fallback warning in the app log does not establish causality.
At diagnosis time, `audioAnalysis.js` read/copied the whole source and used the renderer's
native `decodeAudioData` before applying range limits. The existing export
workaround and `docs/EDITING_POLISH_CHECKPOINTS.md` document earlier isolated
Electron decoder crashes even on valid small PCM WAVs: a strong lead, not proof
of this reproduction's cause. No user media or crash dumps were inspected during
that diagnosis.

Follow-up diagnosis (2026-10-12): the maintainer confirmed the trigger is the
audio-clip context menu's **Detect Beats → Markers** and authorized investigation.
A hidden, sandboxed, separate-profile Electron 28.3.3 host was run from
`/tmp/velorn-beats-diagnostic-wW4BCf`, never the production main process. It
used generated 12-second PCM only, blocked external requests, and played no
sound. The actual bundled `analyzeAudioSource` crashed after entering native
decode and before it resolved (24 kHz mono, 576,044-byte WAV). Decoder-only
44.1 kHz and unmodified bare native decoder 24 kHz probes also crashed; these
isolated events reported `reason: crashed`, exit code 139 (the supplied app
event reported 11). The existing DSP fed a manually constructed AudioBuffer
passed in Electron (120 BPM); the same source-analysis/WAV path passed in
Chrome 154 (120.1 BPM). This reproduces a decoder-stage crash independently of
the timeline, GPU compositor, marker insertion and large-source memory pressure.
It does not supply a native stack for the user's particular source or establish
the underlying decoder-library defect. No user media/projects were opened.

The maintainer subsequently authorized implementation. The local hotfix now
routes desktop `analyzeAudioSource` through `media:analyzeAudio`: FFprobe and
FFmpeg decode a bounded local source range, and a disposable native worker runs
the existing, mechanically extracted DSP. Only its summary crosses back to the
renderer. Electron fails closed if the bridge is missing or the job fails; it
never falls back to `decodeAudioData`. The browser-only fallback is separate and
bounded. Export's buffer-level DSP API remains compatible.

- One native job runs at a time, with source/output/time limits, bounded stderr,
  and child cleanup on worker failure, owner destruction/crash, or app quit.
  Analysis ranges are limited to 10 minutes; longer ranges return a clear error
  instead of silently truncating. Native audio is 24 kHz, retaining mono or the
  first two original channels as in the existing DSP. HTTP/provider inputs are
  not accepted. Portable project paths are preferred over stale absolute paths,
  including Windows-relative paths moved to Linux; Windows filesystem UNC
  support remains intact (resolver-tested without accessing network shares).
- Timeline beat markers preserve selected source range and speed/FPS mapping,
  and use the existing one-checkpoint Undo. If the project/timeline, clip timing
  or source changes while analysis runs, no stale markers are inserted.
  MCP audio analysis uses the same native service and portable source fields.
- Run `npm run test:audio-analysis` for service, DSP, marker, MCP and native
  regressions. Real-binary tests use installed FFmpeg/FFprobe or explicit
  `VELORN_TEST_FFMPEG_PATH` / `VELORN_TEST_FFPROBE_PATH`; check for skipped tests
  if dependencies were installed without binary download scripts.
- Run `npm run check:audio-analysis` against a separate loopback Vite server
  (`VELORN_TEST_URL`), or add `-- --serve`. The isolated host accepts
  `VELORN_TEST_ELECTRON_BINARY`, `VELORN_TEST_FFMPEG`, and `VELORN_TEST_FFPROBE`.
  It never launches the production main process or opens user projects: all
  audio is generated, network requests are blocked except fixture resources,
  the sandboxed window is hidden, and its temporary profile/media are cleaned.

Audio validation: 40 focused tests pass with real native binaries and no skips,
including generated WAV, MP3 and MP4/AAC with fractional selected ranges.
Eight isolated Electron 28.3.3 regression groups pass, covering generated
120 BPM audio, fractional trim accuracy, actual Timeline menu/markers/Undo,
stale results, native failures, timeout/busy recovery and live-child cleanup.
The worker/DSP also executes successfully from an `app.asar`-shaped fixture;
the package file list explicitly includes the extracted DSP. No Web Audio
decoder calls, external/provider requests or renderer errors were observed.
The nine prior Timeline browser groups still pass, along with 168 neighboring
timeline/audio tests. Production renderer build and diff checks pass with
existing warnings. This is not a full packaged-platform certification; Windows
and macOS runtime tests and release preparation remain separate follow-up work.
The running app, real projects and normal checkout have not been changed.

### Local Linux test build — maintainer testing next

The maintainer authorized a Linux test build on 2026-10-12, with Windows tester
distribution to follow after their Linux check. No commit/push/tag/release or
Windows distribution has occurred. An unpacked Electron build is available at
`/home/jaime/Downloads/Velorn-Linux-Hotfix-Test/app/linux-unpacked`, using test-only
packaging name/version overrides (`velorn-hotfix-test`, `0.3.36-hotfix.1`). Source
version metadata remains `0.3.36`. Launch via `Launch Velorn Test.sh` in the parent
folder, not the inner executable. The launcher was started for the maintainer.

This copy uses its own `profile`, XDG config/cache and temp directories. Its
settings deliberately use an unused ComfyUI port (`19888`), auto-start off and
stop-on-quit off; no installed settings or credentials were copied. A fresh
profile alone would allow the older launcher to adopt an existing ComfyUI on
8188. Expected offline history/connection warnings are harmless for these tests.
The existing root-owned Electron 28 sandbox helper is reused with
`CHROME_DEVEL_SANDBOX`, without disabling sandboxing or changing system security.
MCP still uses the legacy fixed port: the running normal app retained that port,
and the test copy logged a nonfatal bind conflict. Test via the visible UI only;
do not send MCP commands assuming they target this copy. Use a disposable or
copied project because normal project autosave remains active.

The real unpacked bundle passes native dependency/provenance gates and an
isolated smoke using its own `app.asar` worker/DSP and bundled FFmpeg/FFprobe
(120 BPM and fractional trim). RIFE was extracted from the official v0.3.36
Linux package and verified against this checkout's pins; no gate was bypassed.
`BUILD-INFO.txt` records the app.asar SHA-256 and checks. The app starts using the
isolated profile. The maintainer's manual Linux test and Windows runtime test
remain pending; Linux success does not establish Windows compatibility.

The following release notes are historical context, not current authorization.

## Issue #131 / v0.3.36 release preparation

The maintainer approved the tested hardware-assisted playback/proxy preparation, bounded background concurrency and clearer progress, then authorized committing, pushing and preparing the next release on 2026-09-26. The isolated sibling checkout `velorn-issue-131`, branch `codex/issue-131-import-cache`, is based on released v0.3.35 (`6d12833`). Version metadata targets v0.3.36. Use the normal PR/CLA/main/tag/build process and keep the release **draft and unpublished** for maintainer review. Other dirty/unique checkouts are untouched.

See `docs/ISSUE_131_MEDIA_PREPARATION.md` for contracts and tests and `docs/RELEASE_NOTES_0.3.36.md` for release copy. Actual Linux RTX 5090 NVENC and CPU fallback checks pass; Windows/macOS actual-device validation remains pending. Check the current PR/regression matrix/release workflow rather than treating this preparation note as proof of completed builds. Keep issue #131 open for reporter confirmation. Historical issue #130 preparation notes below are retained, but v0.3.35 has since been published.

## Issue #130 export scheduling hotfix

The maintainer approved finishing validation and shipping the existing local scheduling fix for issue #130. A focused `codex/issue-130-export-scheduling` branch is based on published v0.3.34 / upstream main `140d3b6`, deliberately excluding unrelated local commits and unfinished changes. Those checkouts remain preserved.

The hidden worker explicitly selects task-queue scheduling instead of display-refresh callbacks, including the pre-encoding progress wait. Foreground direct exports keep repaint opportunities. Encoding, frame sampling, GPU readback, project formats, and authored settings are unchanged. Per-export scheduler ports are disposed on success, failure, and cancellation.

Version metadata targets v0.3.35. Keep the release draft and unpublished for maintainer review. See `docs/RELEASE_NOTES_0.3.35.md`; check GitHub for current PR, CLA, regression-matrix, and release-build status before continuing. Do not treat this preparation note as proof that cross-platform builds passed.

Local validation: production renderer build passed; 131 focused scheduling/export/media tests passed; RIFE hardening passed 44 tests with one optional real-runtime skip; Linux native media dependency gate passed. The sandboxed, never-shown Electron 28.3.3 fixture passed with refresh callbacks deliberately suspended, correct pixel ordering, cancellation/recovery, and a fully decoded 144-frame native H.264 output. See `docs/ISSUE_130_EXPORT_SCHEDULING.md`. Record Windows/macOS/Linux CI outcomes in the PR before merging. Keep issue #130 open for confirmation against the draft build rather than closing it on preparation alone.

The older sections below retain the historical editing and migration context.

## Current local editing review

The active review checkout is `/home/jaime/Documents/coding_projects/general/velorn-editing-polish`, branch `codex/editing-workflow-polish`. The accumulated approved editing-polish work is committed in `8d6534a`, based on released v0.3.33 / main `fb7689b`; preserve it. On 2026-09-15 the maintainer authorized preparing v0.3.34 through the normal PR, main-merge, tag and GitHub Actions process, with the release kept **draft and unpublished** for review. Version metadata and `docs/RELEASE_NOTES_0.3.34.md` are prepared for that release. Check GitHub for current PR/build/asset status before continuing; preparation alone is not proof that builds have completed.

PRs #124 and #128 were reviewed separately and are not part of this release. Do not merge them or include the experimental agent-budget work as part of this authorization. The maintainer previously authorized the CLA confirmation for our own contribution; external contributors must confirm their own agreements. Do not publish the draft without separate approval.

See `docs/EDITING_POLISH_CHECKPOINTS.md` for accepted checkpoints and current verification. Checkpoint 6 adds music ducking with audition/editable points, reusable custom export presets, advisory export readiness, and bounded input/transport consistency. All four were authorized together and the maintainer has now approved the result. Test fixtures use synthetic media, not user projects. Windows/macOS packaged verification remains release work.

Release preparation checks on 2026-09-15: all 944 tests in the 90-file editing/audio/playback/export regression inventory pass; Electron main/preload and changed native-helper syntax checks pass; the Linux x64 native dependency gate passes. RIFE hardening reports 44 passed and one optional real-runtime smoke test skipped because no explicit runtime/model paths were supplied. Production renderer builds pass, with the existing Vite/Browserslist/chunk warnings. These local checks do not substitute for the cross-platform packaging/signing workflow or the maintainer's draft review.

The following sections retain the historical August migration record; their release/branch details are not the current editing-review state.

## Merged Migration

- Worktree: `C:\Users\papa\Documents\coding_projects\general\velorn-migration-cleanup`
- PR: `#99` - merged into `main` on 2026-08-12
- Merge commit: `c4be213`
- Latest release remains `v0.3.25`; the recovered changes are on `main` but have not been released yet.
- This worktree remains intentionally separate from the old dirty `main` checkout.

Recovered, tested, and merged changes:

1. `592cf30` - Add a Settings toggle that hides the Comfy.org credit balance and stops its polling while hidden.
2. `fb09ce6` - Refresh paused text/shape/caption rasters when timeline or asset state changes.
3. `bcea1de` - Recognize namespaced `model.prompt` inputs in imported workflows, with MiniMax H3 regression coverage.

The production renderer build passed after every feature. Electron main/preload syntax checks pass. All ten existing `package.json` test scripts plus the two recovered-feature suites pass: 82 tests total, 0 failures.

The maintainer also verified all three user-facing behaviors in the Electron app before PR #99 was merged.

## Preserved Windows Checkout

The original checkout remains untouched at:

`C:\Users\papa\Documents\coding_projects\general\comfyui_editing`

At migration start it was on local `main` at `6b450ce` (`v0.3.23`), three commits behind `origin/main`, with 20 modified tracked files and many untracked files. It contains useful fixes mixed with obsolete experiments, generated review media, drafts, and screenshots.

A safety inventory exists at:

`C:\Users\papa\Documents\coding_projects\general\velorn-migration-backup-2026-08-12`

It contains:

- `tracked-changes.patch`
- `git-status.txt`
- `untracked-files.txt`
- `recent-history.txt`

Do not reset, pull, delete, or repurpose the old checkout until the maintainer has verified the clean branch and explicitly approves cleanup.

## Deliberate Decisions

- The old ComfyUI-based RTX upscale implementation was not migrated. Standalone NVIDIA RTX 4K export already shipped upstream in v0.3.24.
- My Workflows MCP support was not recopied because it already shipped upstream in v0.3.25.
- Manual title-bar/window dragging and unload changes were reviewed but not migrated. They are platform-sensitive, mixed with unrelated work, and lack a clear verification record. They remain recoverable in the old checkout and backup patch.
- Generated timeline contact sheets, output media, mockups, marketing drafts, and old handoff notes were not brought into the clean branch.
- No dirty old worktree has been deleted.

Clean, fully superseded worktrees removed on 2026-08-12:

- `comfystudio-license-gplv3`
- `velorn-long-source-export`
- `velorn-my-workflows-mcp`
- `velorn-native-rtx-upscale`

Old worktrees retained because they contain uncommitted or unique work:

- `comfystudio-joao-16gb-preview` - modified project loading plus review screenshots and a long detached feature history.
- `comfystudio-pr49` - one modified Generate file on a detached PR test.
- `comfystudio-pr49-local-test` - staged and unstaged ASR/music-video test changes.
- `comfyui_pr50_merge_check` - staged custom-workflow/media changes, two untracked covers, and two commits not represented in `main`.
- `velorn-infinite-canvas` - uncommitted canvas UI, schema, store, and test work.

Do not delete those retained worktrees without a separate review and explicit maintainer approval.

## Remaining Work

1. On Ubuntu, clone `main` fresh; do not copy `node_modules` or the Windows `.codex` directory.
2. Run the Ubuntu startup commands below and verify Velorn opens.
3. Keep Windows available for Windows packaging, Azure signing behavior, and NVIDIA RTX export testing.
4. Review retained worktrees individually before any further deletion.

## Ubuntu First Session

After cloning the intended Git branch on Ubuntu:

```bash
npm ci
npm run build
npm run electron:dev
```

Start a new Codex task with:

> Read AGENTS.md, docs/AI_PROJECT_CONTEXT.md, docs/AI_CURRENT_HANDOFF.md, and docs/AI_RELEASE_HANDOFF.md. Inspect git status and recent history, then summarize the product, architecture, current branch state, and next safe step before changing files.

Local projects, ComfyUI models, credentials, signing secrets, generated media, and machine-specific settings are not repository context and must be migrated separately and deliberately.
