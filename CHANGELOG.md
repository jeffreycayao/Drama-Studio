# Changelog

All notable changes to Drama Studio are listed here. Versions follow `major.minor.patch`.

Add notes under **Unreleased** as you work. When the version is bumped (every `npm run build`, or `npm run version:minor` / `version:major`), the notes move under the new version automatically. See [SETUP.md](SETUP.md#versioning).

## [Unreleased]

### Added
- **Grok Imagine in your browser:** a job sent from Generate › AI Sites now also sets Grok's shape (16:9, 9:16, 1:1…) after the prompt and your reference files. If Grok can't take that shape, the Companion says so and you pick it yourself. You still press Generate on Grok. Needs Drama Studio Companion 0.5.0.
- **Send to Drama Studio button on Grok Imagine:** point at a picture or video Grok made and press the button in its corner; it lands in your project under AI Sites, the same as the right-click menu. Needs Drama Studio Companion 0.5.0.

### Fixed
- **Suno:** lyrics keep their line breaks, the style box is found reliably, and a simple song switches Suno to its Simple tab first. Checked on Suno's live create page. Needs Drama Studio Companion 0.4.1.

## [0.1.30] - 2026-10-18

### Added
- **Songs on Suno.** In Generate › AI Sites, pick **Suno** under Music. **Simple** sends a song description; **Custom** sends the style of music, the lyrics and a title, and Drama Studio Companion fills each of Suno's boxes. Tick **Instrumental** for a song without vocals. You press Create on Suno, then right-click its player › **Send to Drama Studio** (or download it and drag it in). The Music popover in the timeline has **Make it on Suno instead**, which sends the style and lyrics you wrote there, including ones from the AI songwriter. Needs Drama Studio Companion 0.4.0.
- Songs (MP3, WAV, M4A) can now be sent back from the browser, not only pictures and videos.

## [0.1.29] - 2026-10-18

### Added
- **AI Sites: make images and videos on the sites you already use.** In Generate, click **AI Sites** (or press Ctrl+Shift+P and type "AI site"). Pick Google Flow, Grok Imagine, Kling AI, Runway, Hailuo AI, Luma Dream Machine, Pika, ChatGPT, Gemini, Midjourney, Ideogram or Leonardo, write the prompt (or take one from the prompt library), and tick up to eight pictures or clips as references. The site opens in your own browser with the prompt typed in and the references added; you press Generate there, then right-click the result › **Send to Drama Studio** to bring it into the project under AI Sites. It uses your own account on each site and needs no ComfyUI, so it is also offered when ComfyUI is not set up. Needs Drama Studio Companion 0.3.0.
- **Open in…** in the prompt library also lists the new sites.

## [0.1.28] - 2026-10-17

### Added
- **Bring pictures and videos back from Grok.** With Drama Studio Companion 0.2.0, right-click a picture or video on Grok and pick **Send to Drama Studio**. It is added to the open project under **AI Sites › Grok** in the Assets panel, with the prompt it was made from, and a short message says when it has arrived. If no project is open, it is added when you open one.

### Security
- Drama Studio checks that every file sent from the browser arrived whole before keeping it, and only accepts pictures and videos from a browser you allowed.

### Fixed
- Files Drama Studio adds to a project for you, such as from a pack or from the browser, show their preview straight away instead of after reopening the project.

## [0.1.27] - 2026-10-17

### Added
- **Motion Studio: let AI edit a whole video.** A new workspace at the top of the window. Pick a recipe (Talking head, Documentary montage, Music video or Social short), tick the clips, images, voice and music to use, and answer a few questions. The AI writes a scene plan for you to approve, then builds the edit: shots in order, titles, music that dips under the voice, transitions and captions, on a **new timeline** you keep editing. Your current timeline is never changed. No AI model set up? **Quick assemble** builds a first cut without one. The Review step points out problems such as too many still images or music that ends early, and **Make it tighter** or **Make it calmer** makes a new version.

## [0.1.26] - 2026-10-17

### Changed
- **The timeline now works in layers, like CapCut.** Adding text, a title, a shape or an adjustment layer at the playhead puts it on its own layer above your video, reusing a free layer or making a new one. It never cuts the video under it any more.
- **Dropping or dragging a clip onto a spot that is taken** puts it on a free layer next to that track instead of cutting the clip underneath. Hold **Ctrl** (Cmd on a Mac) while you drop or let go to overwrite the old way.
- **Layers the app made for you disappear when they become empty.** Tracks you added yourself stay.
- **Split (X) cuts the selected clip** (with its linked sound) and nothing on other layers. With nothing selected it cuts the clip on the active track. Shift+X still cuts every track.
- **The AI Assistant and connected agents** follow the same rules when they add text, shapes, adjustment layers or media, or move clips. Asking for overwrite still works.

### Added
- **Magnetic main track** (off until you turn it on): **Main track** in the timeline toolbar. Deleting or moving clips on the bottom video track closes the gaps, and clips dropped there are inserted.
- Help Center: **Layers: how clips stack, move and drop**.

## [0.1.25] - 2026-10-17

### Added
- **Send a prompt straight to an AI site.** In the prompt library, **Open in…** opens ChatGPT, Gemini, Claude, Grok, Perplexity or Manus in your browser with the prompt already filled in by Drama Studio Companion, ready for you to check and send. The prompt never goes into the web address, and each send works once, for a few minutes. Windows for now.
- **Settings › Browser.** The first time Drama Studio Companion connects, Drama Studio asks "Allow this browser to send files to Drama Studio?". Allowed browsers are listed in Settings › Browser, where you can remove them.
- **Use pack shot lists, scripts and prompts in Short Film Creation.** In the Script step, **From an imported pack…** lists the templates kept by Import pack. Pick one to preview it: a shot list (.csv or .tsv, with columns such as shot, prompt, description or duration) becomes the Shot Plan, a .fountain script becomes the screenplay, and a .txt or .md prompt becomes the screenplay or the premise. Nothing you typed is replaced until you click Use, and **Undo** puts it back.

### Security
- The browser link only answers the Companion's own extension, only while Drama Studio is open, and only after you allow the browser.

## [0.1.24] - 2026-10-17

### Added
- **Learn AI Content Generation** button at the top of the app, in gold: opens a course on making AI content in your browser (a partner link).

### Fixed
- **Generate › Text to Speech (Qwen3 TTS)** card now opens Text to Speech. It used to open Music Generation.

## [0.1.22] - 2026-10-17

### Added
- **Prompt library.** Keep and reuse prompts: ready-made ideas, loglines, outlines, shots, styles, characters, voices, music, sound effects and things to avoid; prompts from packs you import; and your own. Words in curly brackets, like {character}, are blanks you fill in each time, with names from your Cast Locker suggested. Open it from the Drama Studio menu › **Prompt library**, Ctrl+Shift+P, or **Library** above the prompt boxes in Generate and Idea Pad. Star favorites, see recently used prompts, and copy any prompt to use in ChatGPT, Gemini or Claude.
- **The AI Assistant can use your prompt library.** Ask it for prompts from the library, or to save one (it asks before saving).

## [0.1.21] - 2026-10-17

### Added
- **Import packs that creators share.** Generate › My Workflows › **Import pack…** (or drop a .zip on the app, or search "pack" with Ctrl+Shift+P) opens a review of everything in the zip before anything is kept: ComfyUI workflows with a check of the nodes and models your ComfyUI has, prompt templates and shot lists, reference images, audio, video and LUTs. Tick what you want: workflows go to My Workflows › *pack name*, media to Assets, LUTs to the LUT library, and templates are kept with the pack's read-me. **Code in a pack is never run or installed**: Chrome extensions, scripts, programs and installers are listed with a plain explanation (and, for long-video tools, where Drama Studio does the same thing built in). Hostile zips are refused: files that point outside the pack, zip bombs, and packs with too many files.
- **`.dspack` format** for creators who want to share with Drama Studio users: a zip with a manifest that gives the pack a name, author, version, license, titles and cover images. Declarative only. See docs/DSPACK_FORMAT.md.

## [0.1.20] - 2026-10-17

### Added
- **Ask the Assistant how to do things.** The Assistant (and connected AI agents) now answer how-to questions from the Help Center, so answers match the guide.
- **Free local voices and voice cloning.** New **Text to Speech (Qwen3 TTS)** in Generate › Audio speaks a line on your own GPU, no account or credits needed. Pick one of nine preset voices (with an optional delivery note such as "whispering"), or **Clone a voice** from a 3 to 30 second clip in your assets, optionally with what the clip says for a closer match. Ten languages. The audio lands in Assets › Generated › Audio. Short Film Creation can use it too: in the Voices step pick **Qwen3 TTS** and set a preset or a clone clip per character. It runs on the TTS-Audio-Suite node pack that captions already use; the voice model (Apache-2.0) downloads on the first run.

### Security
- Downloads of stock media and sound effects refuse more kinds of private network addresses.
- Subtitle files saved by AI agents always stay inside the project's renders folder.

## [0.1.18] - 2026-10-17

### Added
- **Start without ComfyUI.** No strong graphics card? The first-launch setup screen now has **Continue without ComfyUI**. Editing, captions, caption translation, subtitle files and export work right away. Features that need ComfyUI (Generate, the ComfyUI tab, music, lip-sync, masks, Topaz upscale) explain why and offer **Set up ComfyUI**, which opens setup over your project without closing it. Setup Doctor shows this as optional instead of a problem.

## [0.1.17] - 2026-10-17

### Added
- **Search every action (Ctrl+Shift+P).** One search box for everything Drama Studio can do, including actions that normally hide in right-click menus (Translate Captions, Lip-sync, Continue from last frame, Detect Beats, Smart Replace, Capture Still, Auto-duck, Generate Music) plus every workspace, panel and settings page. Each result says where the action normally lives; actions that need a selection explain what to select. Matching Help articles show up too. Open it from **Search** at the top right or the Drama Studio menu.
- **Quick actions in the Inspector.** Select a clip and the actions that fit it appear at the top of the Inspector: Translate and Save .srt for captions, Continue shot, Lip-sync and Smart Replace for video, Detect beats for music.
- **More in the Drama Studio menu:** Search actions, Help Center, What's new, Check my setup and Guided tour.
- **What's new** in the Help Center lists the latest features and where to find them.

## [0.1.16] - 2026-10-16

### Fixed
- The in-app Assistant can now save subtitle files and translate captions when asked ("translate the captions into Spanish"). Clicking **Apply** on a translation preview uses the translation it already made instead of translating again.
- Translate Captions suggests Spanish first instead of English.

## [0.1.15] - 2026-10-16

### Added
- **Subtitle files.** Save your captions as **SRT** or **WebVTT** for YouTube, Vimeo, social apps and web players. In Export › **Subtitles**, pick a format and the file is saved next to the video with the same name (it follows the In/Out range). Or right-click the captions clip › **Save Subtitles (.srt)…**, or use **Save subtitles only…** in Export.
- **Translate captions.** Right-click the captions clip › **Translate Captions…**, pick a language (20 built in, or type any other), check every line next to the original, edit what you like, and apply. Timing and style stay the same, the original is kept, and one captions clip can hold several languages you switch between. Uses your Assistant model (free with Ollama or LM Studio). Export can save one subtitle file per language.
- **Agents can do it too.** New MCP tools: `export_subtitles`, `translate_captions`, `get_caption_translation` and `set_caption_language` (preview first, one undo step per change).

## [0.1.14] - 2026-10-16

### Fixed
- The welcome screen line "Projects and media are saved to" ran its words together; the spacing is back.
- Empty preview and scene placeholders use the theme's clapperboard icon instead of an emoji.

## [0.1.13] - 2026-10-16

### Added
- **Help Center.** Click **Help** at the top right (or press **F1**) for a searchable, plain-language guide: where files are saved, local vs cloud AI, text to image, image to video, text to video, music, voices, lip-sync, sound effects, editing, captions, export, the AI Assistant and fixes for common problems. Articles include step-by-step instructions and diagrams, and some have buttons that open the right setting or start the tour. Search understands everyday wording such as "is it saved locally" or "sfx". The guide is in English for now.

### Changed
- **A more polished look.** Cleaner type, slimmer scrollbars, one consistent focus highlight on text fields, deeper dialog shadows with a soft blur behind them, a subtle finish on lime buttons, and rounded workspace tabs. Colors and themes are unchanged.
- **Brand fonts are built in.** Inter, Sora and JetBrains Mono now ship with the app, so the interface looks right offline and no longer contacts Google Fonts on start.

### Fixed
- The keyboard focus ring on buttons and sliders (shown when you move around with Tab) was never drawn. It now appears.

## [0.1.12] - 2026-10-16

### Added
- **Connect an AI agent in one paste.** Settings → Agents (MCP) has a setup prompt for Claude Code and for Codex: paste it into the agent's chat and it connects itself to Drama Studio, checks the connection and explains what it can do. A plain-language summary of agent capabilities replaces the old tool list (all tools are still one click away).

### Changed
- **Finished the rename to Drama Studio.** The MCP server is now registered as `drama-studio`, custom workflow marker titles are `DRAMA_STUDIO_*`, and ComfyUI outputs are saved as `drama_studio_*`. Workflows tagged with older marker titles and earlier MCP tool names keep working.
- **Settings move automatically.** On first launch the app moves its settings folder to `%APPDATA%\Drama Studio` (or the macOS/Linux equivalent) and carries over saved preferences such as language and panel layout. If the move is not possible, it keeps using the old folder.
- Environment variables for advanced setups now start with `DRAMA_STUDIO_` (for example `DRAMA_STUDIO_FFMPEG_PATH`, `DRAMA_STUDIO_MCP_ALLOWED_ORIGINS`).

### Security
- **Stock and sound-effect downloads stay on the public internet.** Before connecting, Drama Studio now checks every address a download's web address points to, on every redirect. A public-looking address that leads to your own computer or local network (for example ComfyUI or the agent server) is refused.
- **Your Unsplash key only goes to Unsplash.** The key is sent only to `api.unsplash.com` over https. NASA downloads only read file lists from NASA's own servers.
- **ComfyUI setup asks before it trusts a folder.** On first launch, a ComfyUI folder found on your drives is shown with its full path, and Drama Studio uses it only after you click **Use this folder**. The launcher script next to it (for example `run_nvidia_gpu.bat`) is shown too, and is only saved when you pick it, choose another file, or skip. A ComfyUI that is already running is still connected to automatically.

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
