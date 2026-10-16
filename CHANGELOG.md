# Changelog

All notable changes to Drama Studio are listed here. Versions follow `major.minor.patch`.

Add notes under **Unreleased** as you work. When the version is bumped (every `npm run build`, or `npm run version:minor` / `version:major`), the notes move under the new version automatically. See [SETUP.md](SETUP.md#versioning).

## [Unreleased]

### Added
- **Auto-duck music under dialogue.** Mark audio tracks as Dialogue or Music (BGM) in the Mixer or the Audio inspector, then **Auto-duck…** writes editable volume points on every music clip so it dips while people speak. Reduction, attack, hold, release and the speech threshold are adjustable (defaults -14 dB, 60 ms, 500 ms, 300 ms). Detection reads dialogue loudness (RMS) locally; nothing is uploaded and no AI or credits are used. Listen before applying; applying is one Undo step and running it again replaces the previous pass. Export uses exactly the same curve.
- **Draft → hero conform.** Generated clips are drafts until you swap them. **Inspector › Render pass › Conform…** lists the drafts on the timeline and re-renders each one with the same prompt and seed at a higher resolution, optionally with a different (full-quality) workflow. Queueing asks for confirmation first because it uses your GPU or cloud credits. **Swap** puts the finished hero renders on the timeline in one Undo step without moving any cut, trim, transition or audio.
- **Sound effects library.** A new **Sound effects** tab searches a sound catalog (fuzzy search, categories), plays previews instantly by streaming, and lets you drag a sound straight onto an audio track: it downloads while you drag and is copied into the project. Connect a catalog in **Settings › Sound effects library**, where you can also download the whole pack for offline use with pause, resume and integrity checks.
- **Idea Pad.** A new top tab for pre-production: plot characters, relationships, story arcs, episodes, beats and scenes as linked cards. The AI collaborator suggests plot twists, deepens a character's conflict or expands a beat into a scene outline (using your Assistant model). Export the linked story as a Fountain screenplay, or send it straight to Short Film. Saved with the project.
- **Import scripts.** Short Film's screenplay step imports Fountain (`.fountain`), Final Draft (`.fdx`) and plain-text scripts, including scene headings, characters, parentheticals and dual dialogue.
- **Frame chaining.** Right-click a clip › **Continue from last frame (AI)…** opens Generate with the clip's exact last frame as the next shot's first frame, so lighting and pose carry across the cut.
- **AI songwriter.** The Music popover's **Write with AI** writes a title, style tags, BPM, key and `[verse]`/`[chorus]` lyrics from a one-line scene description.
- MCP / Assistant tools: `set_track_mix_role`, `auto_duck_music` and `conform_draft_clips` (all preview first).
- `npm run sfx:catalog` builds a catalog (with SHA-256 checksums) from a folder of sounds for publishing to Cloudflare R2 or Hugging Face.

### Security
- The local MCP server (`127.0.0.1:19790`) now refuses requests from web pages (any browser `Origin`), requests with a non-local `Host`, and non-JSON posts. Before, a website open in your browser could send it commands. Command-line MCP clients (Claude Code, Codex, Cursor) are unaffected.
- Assistant API keys can no longer be read or overwritten through the general settings channel; only the Assistant settings can set them.
- Workflows sent from ComfyUI are accepted only from the local ComfyUI you are connected to.

## [0.1.1] - 2026-10-16

First Drama Studio version, disconnected from the upstream Velorn project. The version numbering restarts here; earlier `docs/RELEASE_NOTES_0.x` files are upstream history.

### Added
- AI assistant chat panel that docks beside the editor, opened from **Assistant** in the title bar. Works with Ollama, LM Studio, Claude, OpenAI and DeepSeek; choose the backend in `Settings > Agents (MCP) > Assistant AI` and test the connection there.
- Assistant edits run through the existing tool layer: every change is previewed first, applied only when you click **Apply**, and can be undone.
- `tighten_track_gaps` tool: shortens the pauses between clips on one track (for example dialogue) in a single undo step.
- Drama Studio logo and wordmark at the top left of the window.
- Bottom bar footer with copyright (current year), app version, a link to join the Discord server and a link to jepoy.dev.
- Automatic versioning: the patch number increases on every build; `version:minor`, `version:major` and `version:set` scripts for bigger changes.
- `SETUP.md` and this changelog.

### Changed
- Workspace tabs moved from the center of the title bar to the left, next to the logo.
- Active workspace tab text on the lime accent is now charcoal.
- Repository, issues and homepage now point at the Drama Studio repository and jepoy.dev.
- The Discover catalog, the macOS Whisper download and the Discord links point at Drama Studio's own repository and server.

### Removed
- In-app feedback no longer posts to the upstream project's feedback service. It asks users to share feedback on Discord until Drama Studio has its own endpoint.
- Upstream funding link (`.github/FUNDING.yml`) and upstream social links.
