# Feature audit: what Drama Studio has, and what is missing (2026-10-17)

Method: a read of the code, the bundled workflows (`public/workflows/`), the
MCP tool catalog and the earlier coverage notes
(`WORKSPACE_COVERAGE_2026-10-16.md`, `AUDIT_SCORECARD_2026-10-16.md`).
Nothing was run for this audit. "Missing" means no code path was found, not
that it was tested and failed.

Effort: **S** = days, **M** = one to two weeks, **L** = a month or more.

## 1. What already exists

| Area | In the app today |
| --- | --- |
| Story | Idea Pad (story graph + AI collaborator), screenplay import (Fountain, FDX, text), Short Film shot plans, AI songwriter |
| Cast consistency | Cast Locker (face and wardrobe references, PuLID / InstantID / IP-Adapter binding) |
| Image | Text to image (Z Image Turbo, Flux 2, LongCat, Ernie; cloud GPT Image 2, Grok, Nano Banana 2), image edit (Qwen, LongCat, GPT Image 2, Seedream), multiple angles |
| Video | Text to video (LTX 2.3, WAN 2.2; cloud Seedance 2.0 / Mini), image to video (LTX, WAN; cloud Kling O3, Vidu Q2, Grok), first/last frame, reference to video, continue from last frame, frame interpolation, Topaz and RTX upscaling, SAM3 masks with MatAnyone matting |
| Voice and lip-sync | ElevenLabs text to speech (cloud), LTX 2.3 ID-LoRA talking video (local), MiniMax H3 (cloud), sync.so lip-sync on existing footage (cloud) |
| Music | ACE-Step, YuE2, Stable Audio Open (local); MiniMax Music 3, Sonilo video-to-music (cloud); vocal extraction (Mel-Band RoFormer); beat markers |
| Sound effects | Streaming SFX library with lazy cache (bring your own catalog) |
| Editing | Multi-track timeline, trims and ripple, speed and speed ramps, reverse, transitions, keyframes, masks, track mattes, blend modes, GLSL effects, text and motion graphics, LUTs, color wheels, scopes, proxies |
| Audio mix | Mixer, EQ, gain and fades, auto-ducking under dialogue, loudness check before export |
| Captions | Transcription (Qwen ASR, local engine), word timing, kinetic caption styles |
| Delivery | MP4 (H.264/H.265, NVENC), WebM, ProRes, audio only, PNG sequence, GIF, social batch exports with center-crop framing, FCPXML and Premiere XML |
| Agents | Built-in Assistant (Ollama, LM Studio, Claude, OpenAI, DeepSeek), MCP server for Claude Code / Codex / Cursor, previews and undo for edits |
| Onboarding | Setup Doctor (PC check, local vs cloud advice), guided tours, Getting Started |

## 2. Missing features, ranked

### Tier 1: high value, mostly built from parts the app already has

**1. AI dubbing (translate a video into another language).** *Missing.* M.
Every step exists on its own. Nothing chains them:
transcribe (Qwen ASR) → translate the script (the Assistant model) → speak
it in the new language (ElevenLabs today) → fit each line to its original
timing → lip-sync (sync.so, or LTX ID-LoRA for generated shots) → separate
the original voice from music and effects (Mel-Band RoFormer) so the new
voice sits on the original background → mix (auto-ducking).
Build it as a guided **Dub this video** dialog: pick languages, review the
translated script line by line, generate, review, apply as new tracks (one
undo). Keep the original dialogue track muted, not deleted.
Needs: line timing fit (speed up / pad / re-translate shorter), voice per
speaker (speaker labels from transcription), cost preview for cloud voices.

**2. Voice cloning and local text to speech.** *Missing.* M.
Today's only voice engine is ElevenLabs (cloud, paid). Dubbing and Short
Film both need a free, local option and "keep the actor's own voice".
The Qwen3 TTS node pack that captions already install includes a TTS engine
node (`Qwen3TTSEngineNode`); check whether it covers voice cloning before
adding a new dependency. Also: ElevenLabs voice cloning through its partner
node, if Comfy.org exposes it.

**3. Subtitle files and caption translation.** *Done (0.1.15).*
Export › Subtitles and the captions clip menu save SRT / WebVTT (one file
per language if wanted, following the In/Out range). **Translate
Captions…** translates with the Assistant model into a language version on
the same clip (original kept, switchable). MCP: `export_subtitles`,
`translate_captions`, `get_caption_translation`, `set_caption_language`.
This is step one of dubbing.

**4. Audio-video sync by waveform.** *Missing.* M.
Footage shot with a separate audio recorder (or two cameras) has to be lined
up by hand. Add **Sync by audio**: select the clips, cross-correlate their
waveforms, move them into place, link them. Also the base for multicam.

**5. AI sound effects from video (foley).** *Missing.* M.
The SFX library only has pre-made sounds. Video-to-audio models (for example
MMAudio, HunyuanVideo-Foley) generate footsteps, doors and ambience that
match the picture. The Generate catalog already has a video-to-audio field
set (used by Sonilo), so the UI part is small. Needs a maintained ComfyUI
graph to bundle, checked like the music engines were.

### Tier 2: expected by editors, independent of AI

| # | Feature | Status | Effort | Note |
| --- | --- | --- | --- | --- |
| 6 | Auto-reframe (16:9 → 9:16 that follows the subject) | Partial: center crop only | M | SAM3 subject masks already exist and can drive the crop path |
| 7 | Text-based editing (delete words in the transcript to cut the video) | Missing | L | Word timing already exists; biggest modern editor feature |
| 8 | Filler-word and silence removal | Partial: `tighten_track_gaps` closes pauses | S–M | Add "um/uh" detection from word timing |
| 9 | Dialogue clean-up (noise, echo) | Partial: vocal extraction only | S–M | One-click "Clean voice" using the existing RoFormer graph plus EQ |
| 10 | Stabilization | Missing | M | FFmpeg `vidstab` two-pass, cached like proxies |
| 11 | Chroma key (green screen) | Missing | S | A GLSL effect next to the existing ones |
| 12 | Multicam editing | Missing | L | Needs #4 first |
| 13 | Shot detection on imported footage | Missing | S | FFmpeg scene scores to split long clips |
| 14 | Object removal / video inpainting | Missing | M | Masks exist; needs a bundled inpaint graph |
| 15 | Color match between shots | Missing | M | Scopes and LUTs exist |
| 16 | EDL / OpenTimelineIO export | Missing | S | FCPXML and Premiere XML cover most hand-offs |

### Tier 3: product and distribution

| # | Feature | Status | Effort | Note |
| --- | --- | --- | --- | --- |
| 17 | Auto-update | Missing (no updater) | M | Users of the portable exe never learn about new builds; signing first |
| 18 | Project cloud backup / sync between PCs | Missing | M–L | Projects are portable folders, so a "Back up to…" folder sync (OneDrive, Drive) is the cheap first step |
| 19 | Archive project (collect every linked file into the folder, then zip) | Missing | S | Generated and imported media is already copied in; linked-elsewhere files are not |
| 20 | Model downloads honor Comfy Desktop's shared models folder | Bug (known) | S | Downloads go to `<ComfyUI>\models` and are not seen by Comfy Desktop |
| 21 | Help center content in Japanese | Missing | S | The Help center added today is English only; the UI chrome is translated |
| 22 | Review links / client comments | Missing | L | Out of scope for a desktop app unless a cloud service is added |

## 3. "Syncing" in all its meanings

| Meaning | Status |
| --- | --- |
| Lip-sync (mouth matches the audio) | **Have it**: LTX ID-LoRA (local), MiniMax H3 and sync.so (cloud) |
| Video and audio stay together when editing | **Have it**: linked clips move and trim together |
| Cut to the beat | **Have it**: beat markers |
| Line up separately recorded audio / cameras | **Missing**: #4 above |
| Projects synced between computers | **Missing**: #18 above |

## 4. Suggested order

1. ~~Subtitle export + caption translation (#3)~~ done.
2. Local TTS / voice cloning (#2): unblocks free dubbing and Short Film voices.
3. Dubbing wizard (#1).
4. Sync by audio (#4), then AI foley (#5).
5. Auto-update (#17) before a wider public release.

## 5. Roadmap cross-check (ROADMAP.md)

`ROADMAP.md` is high level. Each concrete item was checked against the code.

| Phase | Roadmap item | In the code |
| --- | --- | --- |
| 1 | Cut through all tracks at the playhead | Yes: Shift+X, "Split all tracks" |
| 1 | Select from the playhead to the end | Yes: E (and Shift+E to the start) |
| 1 | Visual fade in/out on audio clips | Yes: fade handles on timeline clips |
| 1 | Capture a still from the preview into assets | Yes: Preview › Capture Still |
| 2 | Move by exact timecode, extend duration by an amount | Yes: Move By (Ctrl+Shift+M), Duration By |
| 2 | Timelines in the Assets panel, keymap presets, custom hotkeys | Yes: SEQ cards; Premiere / Resolve / Final Cut presets |
| 2 | Jump between clip edges and markers, NVENC discoverability | Yes: arrow-key jumps; NVENC status in Export |
| 3 | More built-in workflows, local and cloud | Ongoing: 45+ bundled (LTX 2.3, WAN 2.2, Flux 2, Kling, Seedance, Vidu, GPT Image 2, ACE-Step, YuE2...) |
| 3 | Workflow grouping by use case | **Partial**: filters are by type (image, video, image to video...) and local/cloud; no grouping by goal ("product ad", "talking head", "music video shot") |
| 3 | Setup guidance for models, nodes, dependencies | Yes: Workflow Setup, Setup Doctor. **Gap**: downloads ignore Comfy Desktop's shared models folder (#20) |
| 4 | Music-driven generation, sequencing to a finished timeline | Yes: Music Video Creation with Assemble Timeline, beat markers, lip-sync shots |
| 4 | Rhythm, pacing and structure tools | **Partial**: beat markers; no "cut on beats" / pacing assistant in the editor UI (the Assistant can do it on request) |
| 5 | Smarter sequence building, AI-assisted edit prep | **Partial**: Assemble Timeline in the guided creators; Assistant/MCP edits. No "rough cut from script" pass for footage you shot |
| 5 | More advanced shot planning | Yes: Short Film shot plans, Idea Pad, Director coverage |
| 5 | Project templates for repeatable workflows | **Missing**: no "save project as template" / "new from template" (only ComfyUI workflow templates) |

Open items carried in `docs/BACKLOG.md` (not on the roadmap page; code
checked where noted):

- Music Video: one-time vocal extraction. *Still open*: the RoFormer still
  runs inside every performance shot when the song is a mixed track
  (`GenerateWorkspace.jsx`, `useVocalsOnly` per shot).
- Music Video: dedicated storyboard pass using each shot's
  `referenceImagePrompt`, and lyric-to-shot forced alignment. Listed as not
  shipped; not re-verified here.
- MCP: a storyboard planner pass that turns a brief into prompts, waits for
  the results and assembles a review cut (backlog "Next MCP additions" #7).
- MCP: launcher port alignment repair (backlog #1).

## 6. Not covered

- No feature here was run. Lip-sync, MiniMax and cloud TTS were validated
  earlier but not executed (credits declined), per the 2026-10-16 coverage doc.
- Model choices for foley, inpainting and voice cloning need the same
  live-ComfyUI check the music engines got before bundling.
