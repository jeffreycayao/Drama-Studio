# Drama Studio workspace: coverage check (2026-10-16)

The requested five-stage studio (Idea Pad → Script & Cast → Shot Board →
Music & Audio Lab → Timeline Cut), checked item by item against the code.
"Existing" items were kept unchanged. "Added" items were built in this pass.
"Blocked" items need third-party ComfyUI graphs, models or APIs that could
not be verified here, so nothing was faked.

| Stage | Item | Status | Where |
| --- | --- | --- | --- |
| 1 Idea Pad | Visual graph canvas: characters, relationships, arcs, episodes, beats, scenes | **Added** | Title bar › **Idea Pad** (`IdeaPadWorkspace.jsx`, React Flow already in the app). Saved in the project file as `ideaPad`. |
| 1 Idea Pad | AI collaborator: plot twists, deeper character conflict, beat → scene outline | **Added** | Card panel › AI collaborator. Uses the Assistant model from Settings › Agents; answers become linked cards (`utils/ideaPad.mjs`). |
| 1 Idea Pad | One-click export of connected cards to a scene script | **Added** | Copy script / Save .fountain / **Send to Short Film** ("leads to" links set the order). |
| 2 Script & Cast | Screenplay parser for `.fountain`, `.fdx`, plain text | **Added** | Short Film › Screenplay › **Import script** (`utils/screenplayParser.mjs`: title page, INT./EXT. headings, scene numbers, characters, extensions, parentheticals, dual dialogue, transitions, notes and boneyard). |
| 2 Script & Cast | Identity & Wardrobe Locker (PuLID / InstantID, outfit decoupling) | Existing | Cast Locker (`docs/CAST_LOCKER_DESIGN.md`). |
| 3 Shot Board | Shot lister (angles, framing, lighting) | Existing | Short Film shot plan and Director-mode coverage parsing. |
| 3 Shot Board | Frame chaining (last frame → first frame) | **Added** | Timeline clip menu › **Continue from last frame (AI)…** captures the exact last visible frame and opens Generate with it as the input (extends the existing Extend with AI path). |
| 3 Shot Board | Hybrid engine: local ComfyUI (Wan 2.2, LTX) and cloud (Kling, Seedance) | Existing | Generate catalog (also Vidu, Grok, MiniMax H3). |
| 3 Shot Board | Sora cloud endpoint | Blocked | No verified ComfyUI partner-node workflow for Sora is available to bundle. |
| 4 Audio Lab | Automated songwriter: title, genre/BPM tags, sectioned lyrics | **Added** | Music popover › **Write with AI** fills tags, BPM, key and `[verse]`/`[chorus]` lyrics for ACE-Step (`utils/songwriter.mjs`). |
| 4 Audio Lab | Local song generation | Existing | ACE-Step 1.5 (Music popover, Flow AI music node), Sonilo video-to-music (cloud). |
| 4 Audio Lab | MiniMax Music API | **Added** (validated on live ComfyUI, not run: credits declined) | Music popover › Engine › MiniMax Music 3 (cloud, beta). Comfy Cloud partner node `ComfyCloudMiniMaxMusic3TextToAudioNode` (`api_minimax_music3_t2a.json`). Asks to confirm each paid run. |
| 4 Audio Lab | YuE song generation | **Added** (ran for real) | Music popover › Engine › YuE2. Core ComfyUI 0.41 nodes, official "Text to Music (YuE2)" blueprint (`music_yue2_t2m.json`). Weights CC BY-NC 4.0. FL-SongGen not added (no ComfyUI node found). |
| 4 Audio Lab | Stable Audio / MusicGen underscore | **Added** Stable Audio Open (ran for real) | Music popover › Engine › Stable Audio Open, ≤47 s beds. Official ComfyUI template (`audio_stable_audio_open_underscore.json`). MusicGen not added (no core or maintained headless graph found). |
| 4 Audio Lab | Cloud SFX browser (streaming, lazy cache, R2 / Hugging Face) | Added earlier today | Left panel › Sound effects; Settings › Sound effects library. Works with MP3 packs. |
| 5 Timeline | Multi-track editing, drag-and-drop | Existing | Editor. |
| 5 Timeline | Dialogue auto-ducking | Added earlier today | Mixer › Auto-duck…; baked as editable volume points rather than a live sidechain, so preview, export and the drawn curve always match. |
| 5 Timeline | Timeline lip-sync on existing footage | **Added** with sync.so (validated on live ComfyUI, not run: credits declined) | Clip menu › Lip-sync to dialogue (sync.so)… Core partner node `SyncLipSyncNode`, official template (`api_sync_so_lip_sync.json`); swap through Smart Replace (one undo). LivePortrait / MuseTalk stay out: custom nodes with no maintained headless video+audio graph to verify. |
| 5 Timeline | Kinetic captions, FCPXML / Premiere XML | Existing | Captions workspace; Export (FCPXML import too). |

## Verification

### Music engines and lip-sync (later the same day)

First pass (static): node ids, inputs and options were read from the ComfyUI
0.41.1 source (commit 45bf90d) and its official templates/blueprints. The
"no PyTorch" finding was wrong: Comfy Desktop runs ComfyUI from
`ComfyUI\.venv`, which has torch 2.12.1+cu130.

Real runs (Comfy Desktop, ComfyUI 0.41.1, RTX 3060 8 GB, models from the
shared models folder Comfy Desktop maps in):

| Graph | Bundled graph via /prompt | In the Electron app (`npm run electron:dev`) |
| --- | --- | --- |
| YuE2 (`music_yue2_t2m.json`) | Ran: 30 s cap, 364 s on the GPU, 30.02 s 48 kHz stereo MP3 | Ran from the Music popover: imported to Generated Music (30 s), added to the timeline |
| Stable Audio Open (`audio_stable_audio_open_underscore.json`) | Ran: 47.6 s, 186 s (2 min of it first model load), 44.1 kHz stereo MP3 | Ran from the Music popover (30 s): imported |
| MiniMax Music 3, Comfy Cloud (`api_minimax_music3_t2a.json`) | Validated only (seed forced invalid, no key): every other input accepted | **Not run: the user declined** (no Comfy.org key added). Popover shows "needs a Comfy.org API key", Generate disabled |
| sync.so lip-sync (`api_sync_so_lip_sync.json`) | Validated only, with the app's own FFmpeg cut + padded WAV uploaded: only the forced seed error | **Not run: the user declined.** Clip menu › dialog plans 8.71 s / $1.66; "Spend" without a key stops before any upload or queue |

- Live `/object_info` matched the graphs; the fixture is now generated from it
  (`SaveVideo.codec` is a nested dynamic combo in 0.41.1, `CLIPLoader.device`
  is optional, `SaveAudioMP3` is deprecated).
- Fixed from the runs: YuE2 Generate stayed disabled, and its lyrics were
  dropped, while the popover's hidden Instrumental flag was still on (it
  defaults to on); every popover take used seed 0; the Stable Audio graph now
  saves with `SaveAudioAdvanced` instead of the deprecated `SaveAudioMP3`
  (validated; that save node ran for real in the YuE2 runs).
- Smart Replace in the app: a stand-in take (the FFmpeg-cut segment) swapped
  into the clip through the dialog's preview/apply calls, keeping start,
  length and trims; one Undo restored the original, Redo re-applied it.
- `npm run test:music-engines-lipsync`: 21 tests.
- Not verified: MiniMax Music 3 and sync.so execution (declined), the
  Stable Audio run since the save-node change, and the app's model download
  flow. That flow writes to `<ComfyUI>\models` and ignores Comfy Desktop's
  shared models folder, so the models were downloaded by hand (SHA-256
  checked).

### Story tools

- `npm run test:story-tools` (16 tests): Fountain/FDX parsing and round trip,
  songwriter parsing (fences, bad BPM/keys, refusals), Idea Pad ordering,
  export, AI reply application, last-frame timing.
- UI pass in a browser harness with the real components and stores and a
  mocked LLM: card creation without overlap, twists and beat expansion as
  linked cards, export to Short Film (valid Fountain), songwriter filling the
  Music popover. No console errors.
- Not verified: the live Electron app, a real LLM backend, the Short Film
  import button with a real file dialog, and frame chaining against real
  footage (it reuses the existing capture path).
