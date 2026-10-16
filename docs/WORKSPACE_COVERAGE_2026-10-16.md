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
| 4 Audio Lab | MiniMax Music API, YuE / FL-SongGen, Stable Audio / MusicGen underscore | Blocked | Needs their ComfyUI nodes and workflow graphs (and an API key for MiniMax) to bundle and test. |
| 4 Audio Lab | Cloud SFX browser (streaming, lazy cache, R2 / Hugging Face) | Added earlier today | Left panel › Sound effects; Settings › Sound effects library. Works with MP3 packs. |
| 5 Timeline | Multi-track editing, drag-and-drop | Existing | Editor. |
| 5 Timeline | Dialogue auto-ducking | Added earlier today | Mixer › Auto-duck…; baked as editable volume points rather than a live sidechain, so preview, export and the drawn curve always match. |
| 5 Timeline | Timeline lip-sync (LivePortrait / MuseTalk on existing footage) | Blocked | Needs those custom nodes, models and a headless graph. Lip-synced generation already exists (LTX 2.3 ID-LoRA, MiniMax H3, music-video shots). |
| 5 Timeline | Kinetic captions, FCPXML / Premiere XML | Existing | Captions workspace; Export (FCPXML import too). |

## Verification

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
