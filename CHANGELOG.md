# Changelog

All notable changes to Drama Studio are listed here. Versions follow `major.minor.patch`.

Add notes under **Unreleased** as you work. When the version is bumped (every `npm run build`, or `npm run version:minor` / `version:major`), the notes move under the new version automatically. See [SETUP.md](SETUP.md#versioning).

## [Unreleased]

### Added
- **Connect an AI agent in one paste.** Settings → Agents (MCP) has a setup prompt for Claude Code and for Codex: paste it into the agent's chat and it connects itself to Drama Studio, checks the connection and explains what it can do. A plain-language summary of agent capabilities replaces the old tool list (all tools are still one click away).

### Changed
- **Finished the rename to Drama Studio.** The MCP server is now registered as `drama-studio`, custom workflow marker titles are `DRAMA_STUDIO_*`, and ComfyUI outputs are saved as `drama_studio_*`. Workflows tagged with older marker titles and earlier MCP tool names keep working.
- **Settings move automatically.** On first launch the app moves its settings folder to `%APPDATA%\Drama Studio` (or the macOS/Linux equivalent) and carries over saved preferences such as language and panel layout. If the move is not possible, it keeps using the old folder.
- Environment variables for advanced setups now start with `DRAMA_STUDIO_` (for example `DRAMA_STUDIO_FFMPEG_PATH`, `DRAMA_STUDIO_MCP_ALLOWED_ORIGINS`).

## [0.1.10] - 2026-10-16

### Added
- **Version badge** in the editor footer and on the Welcome screen, in the same style as the README badge. It shows the version of the build you are running (hover for the Electron, Chromium and Node versions); development runs show `-dev`.

## [0.1.8] - 2026-10-16

### Added
- **Plain-language hints for technical choices.** The New Project and New Timeline windows say what each size is good for (YouTube, Shorts/TikTok/Reels, Instagram posts, 4K, cinematic) and what each frame rate is for (film look, online video, smooth motion, PAL regions). Export settings explain the chosen format, codec, quality, encoder speed, keyframes and audio options; Generate explains resolution, frame rate, duration, seed and smoothing; captions explain the transcription models; auto-ducking explains each slider; the Inspector has info tips on Blend Mode, Track Matte and Speed.

### Fixed
- **Easier-to-read text.** A disabled "Create Project" (and every other disabled lime or blue button) no longer shows dark text on a dark button. Dimension lines under the size presets, the Inspector's smallest labels, Settings help lines and caption cue labels are larger and brighter. Grey or lime text inside a lime button now turns dark like the rest of the label, and the primary export button uses dark text on lime.
- **Sound-effects pack in Program Files installs.** When Drama Studio is installed for all users (in Program Files), the sound pack now goes to your user folder instead of failing to unpack in the read-only install folder. Portable builds and per-user installs keep it next to the app as before.

## [0.1.7] - 2026-10-16

### Added
- **ComfyUI setup on first launch.** Drama Studio finds ComfyUI wherever it is installed: a running ComfyUI, Comfy Desktop installs, the older ComfyUI Desktop app, or a ComfyUI folder anywhere on your drives (any folder name). If ComfyUI is not installed, a setup screen stays up until you install it (Download ComfyUI), locate its folder, or connect to a ComfyUI running in Docker or on another port. You only do this once.

### Security
- **Locked-down app runtime.** Installed builds can no longer be started as a plain Node.js runtime, ignore `NODE_OPTIONS` and `--inspect`, refuse a modified or unpacked app package, and encrypt their cookie store.
- **No DevTools in installed builds.** F12 and Ctrl+Shift+I only open DevTools in development; support can still enable them with `DS_ALLOW_DEVTOOLS=1`.
- **Content Security Policy.** The interface only runs Drama Studio's own scripts: injected scripts, inline handlers and `eval` are blocked. Project media, ComfyUI, stock sources and YouTube embeds work as before.
- **Sandboxed windows.** The main window, export worker and splash screen run in the Chromium sandbox explicitly.
- **No remote debugging in installed builds.** Drama Studio refuses to start with `--remote-debugging-port` or `--remote-debugging-pipe`, which would let another program control the app; support can still allow them with `DS_ALLOW_DEVTOOLS=1`.

## [0.1.5] - 2026-10-16

### Changed
- **One setup button on the Welcome screen.** The separate "Open guide" button is gone; the setup chip always shows ("Setup guide" until the setup check has run) and opens the same guide.
- **Discover is empty for now.** The bundled sample videos were removed; new Discover content will be published later.
- **Licenses in one folder.** The installed app keeps every license under `licenses/` (Electron, Chromium, FFmpeg and a generated third-party notices file) instead of loose files next to Drama Studio.exe.
- **Smaller install.** Libraries that are already bundled into the interface are no longer copied a second time into the app package, and no source maps ship.

## [0.1.4] - 2026-10-16

### Changed
- **Smaller download.** The app no longer ships about 100 MB of unused promo and test videos, source maps or a second copy of the workflow cover images. Sound-effect packs and AI models are never part of the installer: they download after install (Sound effects tab, workflow setup). Builds now fail if a pack, archive, model file, key file or any file over 25 MB slips into the package.

## [0.1.3] - 2026-10-16

### Added
- **Sound-effects pack from Cloudflare R2.** Settings › Sound effects library can now download a sound pack zip from your private R2 bucket (import the keys from a key file or type them; they are stored encrypted on this computer). The pack unpacks next to Drama Studio (beside the portable exe, or in the install folder) or any folder you choose, and then works offline. The Sound effects tab installs it with one click, with progress, pause and resume.
- **Sound effects tab:** sort by name, length or folder, **group by folder** with collapsible folders, search also matches each sound's description, and every sound is reachable with **Show more**. Drag a sound onto an audio track as before.
- **Idea Pad: import .fountain scripts** (button or drag-and-drop on the canvas): characters become character cards, scenes become linked scene cards that keep their dialogue for export, and each character is linked to the scenes they speak in.
- **Idea Pad: AI prompt.** Copy a ready-made prompt for ChatGPT, Claude or Gemini that writes a Fountain screenplay from your Idea Pad; save the reply as a .fountain file and drop it back on the canvas.
- **Idea Pad: character figures and help.** Character cards show a figure (woman, man, child, elder, group, creature or person) you pick in the inspector; every card type has an icon and a hover explanation.
- **More free stock sources.** The Stock tab adds **Unsplash** and **Pixabay** (free API keys) and **Openverse**, **Wikimedia Commons** and **NASA**, which need no key. The author and license of every imported photo or video are saved on the asset.
- **Drag files from your desktop into the Editor.** Drop videos, audio or images on a timeline track to import and place them at the drop point, on a folder in the Assets panel to import into that folder, or anywhere else in the Editor to add them to the bin. Also accepts .m4v, .m4a, .aac and .flac.
- **Auto-save interval.** Settings › Storage › Auto-save every 15 seconds, 30 seconds, 1 minute or 2 minutes (it only saves when something changed). The project is also saved when Drama Studio is minimized.
- **15 new transitions:** Iris Open, Iris Close, Diamond, Clock Wipe, Box Grow, Barn Door (both directions), Blinds (both directions), two diagonal wipes and four Slide Over directions. They render the same in preview and export.
- **14 one-click color filters** in the Inspector (Black & White, Noir, Sepia, Vintage, Warm, Cool, Teal & Orange, Vivid, Faded, Cinematic, Golden Hour, Moonlight, Pastel, Cyberpunk) with an intensity slider. They work on video, image, text and shape clips and on adjustment layers.
- MCP / Assistant: `add_transition` and `update_transition` accept every transition type (34).

### Fixed
- The Idea Pad top tab showed `topTabs.idea-pad` instead of its name.
- Files dragged from the desktop onto a folder tile in the Assets panel were silently ignored.

## [0.1.2] - 2026-10-16

### Added
- **Auto-duck music under dialogue.** Mark audio tracks as Dialogue or Music (BGM) in the Mixer or the Audio inspector, then **Auto-duck…** writes editable volume points on every music clip so it dips while people speak. Reduction, attack, hold, release and the speech threshold are adjustable (defaults -14 dB, 60 ms, 500 ms, 300 ms). Detection reads dialogue loudness (RMS) locally; nothing is uploaded and no AI or credits are used. Listen before applying; applying is one Undo step and running it again replaces the previous pass. Export uses exactly the same curve.
- **Draft → hero conform.** Generated clips are drafts until you swap them. **Inspector › Render pass › Conform…** lists the drafts on the timeline and re-renders each one with the same prompt and seed at a higher resolution, optionally with a different (full-quality) workflow. Queueing asks for confirmation first because it uses your GPU or cloud credits. **Swap** puts the finished hero renders on the timeline in one Undo step without moving any cut, trim, transition or audio.
- **Sound effects library.** A new **Sound effects** tab searches a sound catalog (fuzzy search, categories), plays previews instantly by streaming, and lets you drag a sound straight onto an audio track: it downloads while you drag and is copied into the project. Connect a catalog in **Settings › Sound effects library**, where you can also download the whole pack for offline use with pause, resume and integrity checks.
- **Idea Pad.** A new top tab for pre-production: plot characters, relationships, story arcs, episodes, beats and scenes as linked cards. The AI collaborator suggests plot twists, deepens a character's conflict or expands a beat into a scene outline (using your Assistant model). Export the linked story as a Fountain screenplay, or send it straight to Short Film. Saved with the project.
- **Import scripts.** Short Film's screenplay step imports Fountain (`.fountain`), Final Draft (`.fdx`) and plain-text scripts, including scene headings, characters, parentheticals and dual dialogue.
- **Frame chaining.** Right-click a clip › **Continue from last frame (AI)…** opens Generate with the clip's exact last frame as the next shot's first frame, so lighting and pose carry across the cut.
- **AI songwriter.** The Music popover's **Write with AI** writes a title, style tags, BPM, key and `[verse]`/`[chorus]` lyrics from a one-line scene description.
- **More music engines.** The Music popover has an **Engine** choice: ACE-Step (as before), **YuE2** songs from your lyrics (local; the YuE2 weights are licensed for non-commercial use only), **Stable Audio Open** instrumental underscore beds up to 47 seconds (local), and **MiniMax Music 3** on Comfy Cloud (beta). The cloud engine spends Comfy.org credits billed by GPU time, so the popover asks you to confirm each run before it is queued. Missing models download from the popover; these engines need ComfyUI 0.41 or later.
- **Lip-sync existing footage.** Right-click a video clip › **Lip-sync to dialogue (sync.so)…** re-syncs the mouth to a dialogue clip on the timeline. It sends only the seconds the edit uses, shows the estimated cost first (about $0.19 per second, paid in Comfy.org credits), and swaps the result in with Smart Replace as one Undo step, keeping trims, transitions and linked audio. The clip must play at normal speed. Requires a Comfy.org API key.
- MCP / Assistant tools: `set_track_mix_role`, `auto_duck_music` and `conform_draft_clips` (all preview first).
- `npm run sfx:catalog` builds a catalog (with SHA-256 checksums) from a folder of sounds for publishing to Cloudflare R2 or Hugging Face.
- `npm run exe:latest` builds a local, unsigned Windows portable exe for testing, deletes older builds in `release/` and launches the new one. Releases still go through GitHub Actions.

### Fixed
- Music popover takes now get a fresh random seed each time. Before, every take used seed 0, so generating again with the same settings gave the same music.
- Model downloads from workflow setup now go to Comfy Desktop's shared models folder (the one set in Comfy Desktop's settings) instead of the ComfyUI install folder, and models already in that folder are found. Settings › Workflow setup shows where downloads go, and the free-space check measures that drive.

### Security
- The local MCP server (`127.0.0.1:19790`) now refuses requests from web pages (any browser `Origin`), requests with a non-local `Host`, and non-JSON posts. Before, a website open in your browser could send it commands. Command-line MCP clients (Claude Code, Codex, Cursor) are unaffected.
- Assistant API keys can no longer be read or overwritten through the general settings channel; only the Assistant settings can set them.
- Workflows sent from ComfyUI are accepted only from the local ComfyUI you are connected to.

## [0.1.1] - 2026-10-16

First Drama Studio version, disconnected from the upstream Drama Studio project. The version numbering restarts here; earlier `docs/RELEASE_NOTES_0.x` files are upstream history.

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
