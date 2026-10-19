<div align="center">

<img src="public/brand/drama-studio-mark-256.png" alt="Drama Studio logo" width="96" />

# Drama Studio™

**An AI video workstation: a real timeline editor for you, a built-in AI assistant, and 100+ MCP tools for your agents.**

![Version](https://img.shields.io/badge/version-0.1.31-D5FA00?labelColor=27231B)
![Platforms](https://img.shields.io/badge/Platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-444444)
[![Join our Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/5nAZVQ7K4)
[![Website](https://img.shields.io/badge/Website-jepoy.dev-687323)](http://jepoy.dev/)

English · [Español](docs/i18n/README.es.md) · [简体中文](docs/i18n/README.zh-CN.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Português (Brasil)](docs/i18n/README.pt-BR.md) · [Français](docs/i18n/README.fr.md)

</div>

<p align="center"><img src="docs/readme/agent-editing.gif" alt="One prompt: Claude builds the edit in Drama Studio via MCP" width="860"></p>
<p align="center"><i>One prompt. The agent generates media, builds the timeline, and mixes the audio — live, via MCP.</i></p>

Drama Studio is an open-source desktop video editor and AI video workstation. It brings planning, generation, asset management, timeline editing, captions, effects, and export into one project-based app.

Editing, captions, export, project management, and MCP editorial tools work without ComfyUI. All current generation features require a locally running ComfyUI instance.

Use built-in local and cloud workflows, bring your own ComfyUI API workflow JSON, or install the bundled Drama Studio Bridge so a graph open in ComfyUI can be sent back into Drama Studio.

<p align="center">
  <img src="docs/readme/editor-timeline.png" alt="Drama Studio editor with generated assets, preview, timeline tracks, and inspector" />
</p>

## What Drama Studio Is For

- Creating music videos from lyrics, timing, characters, keyframes, video shots, and timeline edits.
- Building UGC-style creator ads and small-business ads with editable shot plans.
- Running curated local and cloud image/video workflows from one Generate workspace.
- Running custom ComfyUI image, video, keyframe, and music-video workflows inside the app.
- Editing generated clips with tracks, transitions, effects, captions, proxy/cache tools, and export.
- Keeping generated media, prompts, workflow outputs, and timelines organized inside a project.

For generation, Drama Studio is not a replacement for ComfyUI. It is the production layer around ComfyUI: plan the work, send jobs to ComfyUI, collect the outputs, and finish the edit.

<p align="center">
  <img src="docs/readme/create-workflows.png" alt="Drama Studio Create workspace with UGC, business ad, music video, and short film creators" />
</p>

## Download

Packaged builds are published on the [Drama Studio releases page](https://github.com/jeffreycayao/Drama-Studio/releases). The repository is private, so downloads are available to people with access until public releases are set up.

Release assets include:

- `Windows Installer`
- `Windows Portable`
- `Mac (Apple Silicon)`
- `Mac (Intel)`
- `Linux AppImage`
- `Linux deb`

Ignore GitHub's auto-generated source-code archives unless you plan to build Drama Studio from source (see [SETUP.md](SETUP.md)).

## Main Features

### Generate

Generate runs built-in local workflows, cloud/partner workflows, and custom ComfyUI workflows.

- Local image, video, image-edit, audio, and utility workflows.
- Cloud workflows such as Nano Banana 2, GPT Image 2, Seedance, Kling, and other partner-node routes where available.
- Custom Image and Custom Video workflows for users who want Drama Studio to run their own ComfyUI API graphs.
- API JSON import for advanced users who prefer exporting workflows manually from ComfyUI.
- Drama Studio Bridge support so compatible graphs can be sent from ComfyUI back to the correct Drama Studio panel.
- Workflow setup checks for missing nodes, models, credentials, and configuration.
- A Featured / My Workflows / Templates browser with Local and Cloud filters. Imported community workflows appear in Featured next to the built-ins.

<p align="center">
  <img src="docs/readme/generate-featured.png" alt="Drama Studio Generate browser with Featured workflows, Local and Cloud filters, and the dependency checker" />
</p>

The Templates tab browses the official ComfyUI template catalog (500+ templates with size and popularity info) and launches any of them into the embedded ComfyUI tab.

<p align="center">
  <img src="docs/readme/generate-templates.png" alt="Drama Studio Templates browser showing the official ComfyUI template catalog with categories and filters" />
</p>

### Create

Create contains guided creator workflows built on Drama Studio's Director Mode engine.

- **Music Video Creation** - turns a song, lyric timing, characters, references, and a director script into keyframes, video shots, and an editable timeline.
- **UGC Creator** - builds creator-style social ads with hooks, dialogue, product demos, try-ons, testimonials, and editable shot-by-shot outputs.
- **Business Ad Creator** - builds offer-first ads for local businesses, ecommerce products, events, services, and small teams.
- **Short Film Creation** - experimental script-to-scene coverage workflow. This is still very beta and may have rough edges.

### Music Video Creation

The Music Video Creator supports:

- Song import and lyric timing.
- ASR transcription or pasted-lyrics alignment into SRT.
- People/cast setup, including existing character sheets.
- Per-shot keyframe prompts, reference images, prompt copy, prompt editing, image replacement, and shot reruns.
- Built-in keyframe routes such as Qwen Image Edit and Nano Banana 2.
- Custom keyframe workflows using Drama Studio endpoint nodes.
- Built-in video routes such as LTX 2.3 Music and WAN 2.2.
- Custom video workflows with optional injected keyframe image, prompt, seed, width, height, FPS, duration, and audio.
- Timeline assembly from generated shot assets.

### Timeline Editor

The editor includes:

- Project asset browser.
- Multi-track video/audio timeline.
- Clip trimming, moving, snapping, overlap replacement behavior, and transitions.
- Text, shape, title, solid-color, adjustment-layer, keyframe, and visual effect tools.
- Inspector controls.
- Proxy/cache tools for smoother playback.
- Export panel for final renders.

### Captions

Captions can be generated from edited timeline audio and styled in-app.

- **Subtitle files:** save captions as SRT or WebVTT for YouTube, Vimeo and web players, next to your export or on their own.
- **Translate captions** into 20+ languages with the same timing and style; one captions clip can hold several languages.
- Timeline-aware transcription.
- Caption style presets.
- Font, color, outline, background, shadow, and animation controls.
- Saved caption style presets for reuse.
- Live preview with play/scrub controls and safe-zone overlays.
- Export-ready caption renders.

### Export

The Export tab includes practical render presets, hardware-accelerated options where available, numbered PNG image sequence export, queue controls, and project-aware output settings.

<p align="center">
  <img src="docs/readme/export-settings.png" alt="Drama Studio export settings with presets, codec controls, and export queue" />
</p>

### Stock

The Stock tab uses Pexels so you can search and import photos or videos directly into the current project. A Pexels API key is optional and can be added in Settings.

<p align="center">
  <img src="docs/readme/stock-pexels.png" alt="Drama Studio Stock tab with Pexels photo and video search" />
</p>

### ComfyUI Integration

Drama Studio talks to a local ComfyUI server and can also help launch it.

- Default endpoint: `http://127.0.0.1:8188`
- Custom port support in Settings.
- Windows launcher support for a configured ComfyUI start script.
- macOS launcher support for a configured `ComfyUI.app`.
- Optional auto-start, stop-on-quit, and restart behavior.
- Embedded ComfyUI tab for opening and editing graphs.
- ComfyUI account login support inside the embedded ComfyUI tab.
- ComfyUI credit balance display when available.

Only localhost/loopback ComfyUI endpoints are supported in the desktop app.

### Voices

- **Text to Speech (Qwen3 TTS):** free local voices, or a voice cloned from a short clip, in 10 languages.
- **ElevenLabs Text to Speech** (cloud) for Short Film voices on PCs without a strong graphics card.

### Help and finding features

- **Help Center (F1):** plain-language guides with diagrams, searchable in everyday words, plus **What's new**.
- **Search every action (Ctrl+Shift+P):** find any feature, including ones in right-click menus.
- **Quick actions:** select a clip and the actions that fit it appear at the top of the Inspector: AI tools (continue a shot, lip-sync, Smart Replace, translate captions, detect beats), editing tools (mask, compound clip, paste attributes, match frame, move by offset) and label colours.
- **AI tools button:** the selected clip on the timeline has an **AI tools** button with the same AI actions.
- **Prompt library:** ready-made prompts, prompts from packs you import, and your own, with {blanks} you fill in each time. Open it from **Prompts** in the top bar, Ctrl+Shift+P, or **Library** above a prompt box.
- **Start without ComfyUI:** no strong graphics card? Edit, caption, translate and export right away; AI features offer to set ComfyUI up when you open them.

### AI Assistant

Click **Assistant** in the title bar to dock a chat panel beside the editor and ask for edits in plain language, for example "Tighten all pauses between dialogue on Track 1". Pick the model in `Settings > Agents (MCP) > Assistant AI`:

- **Local (free, private):** Ollama or LM Studio on this PC.
- **Cloud (any PC):** Claude, OpenAI or DeepSeek with your own API key. Keys stay on this computer and are only sent to the provider you chose.

Every change is shown as a preview first and only happens when you click **Apply**. Applied edits can be undone. Ask it how to use a feature and it answers from the Help Center.

### AI Agents (MCP)

Drama Studio includes a local MCP server with 100+ tools for Codex, Claude Code, Cursor-compatible tools, and other MCP clients.

- Endpoint: `http://127.0.0.1:19790/mcp`
- In-app setup: `Settings > Agents (MCP)` (one copy-paste command per client)
- Guide: [docs/MCP.md](docs/MCP.md)

Agents can inspect the open project, review timeline frames and visible shots, troubleshoot ComfyUI setup, preview safe timeline edits, queue approved generation work, and start delivery exports.

Agents can also bring in community ComfyUI workflows: hand one a workflow link or file, and it analyzes the graph, reports missing custom nodes and models, installs them after your approval, and runs the workflow on your timeline assets.

Most MCP write tools support a preview step, and many default to preview-first behavior. Normal timeline edits participate in Drama Studio's undo system. Imports, exports, generated files, project creation, and other filesystem changes are not universally undoable, so agents should get explicit approval before applying them. MCP is the recommended automation path for agent-assisted review, timeline operations, graphics polish, and generation workflows.

<p align="center">
  <img src="docs/readme/agents-mcp.png" alt="Drama Studio Agents (MCP) settings with the running local server, connect commands, and the full tool list" />
</p>

## Custom Workflows

Custom workflows are one of the main reasons Drama Studio exists.

**Import a pack someone shared:** the package button in the Assets panel, Generate › My Workflows › **Import pack…**, or drop the .zip on the app. It shows everything in the pack before anything is kept. Workflows go to My Workflows, images, audio and video to Assets, and LUTs to your LUT library. Code in a pack, such as browser extensions or scripts, is never run or installed.

Advanced users can:

1. Open a starter graph from Drama Studio.
2. Modify it in ComfyUI.
3. Keep the required Drama Studio endpoint nodes.
4. Send it back with the Drama Studio Bridge or import the API workflow JSON manually.
5. Run that graph from Drama Studio as part of a creator flow or from Generate.

Common Drama Studio endpoint node titles include:

- Drama Studio input image - `DRAMA_STUDIO_INPUT_IMAGE`
- Drama Studio prompt - `DRAMA_STUDIO_PROMPT`
- Drama Studio seed - `DRAMA_STUDIO_SEED`
- Drama Studio width - `DRAMA_STUDIO_WIDTH`
- Drama Studio height - `DRAMA_STUDIO_HEIGHT`
- Drama Studio FPS - `DRAMA_STUDIO_FPS`
- Drama Studio duration - `DRAMA_STUDIO_DURATION`
- Drama Studio audio - `DRAMA_STUDIO_AUDIO`
- Drama Studio output image - `DRAMA_STUDIO_OUTPUT_IMAGE`
- Drama Studio output video - `DRAMA_STUDIO_OUTPUT_VIDEO`

Exact `DRAMA_STUDIO_*` titles are preferred, but Drama Studio also recognizes readable titles such as `Drama Studio input image`. Older graphs that still use `COMFYSTUDIO_*` marker titles are supported for backward compatibility.

If an endpoint is present, Drama Studio can inject that value. If an endpoint is not present, the graph controls that setting itself.

<p align="center">
  <img src="docs/readme/comfyui-bridge.png" alt="Embedded ComfyUI graph with Drama Studio endpoint nodes and Send to Drama Studio button" />
</p>

## Requirements

Normal editing:

- No ComfyUI installation or Comfy account is required.
- Allow enough disk space for project assets, cache files, and exports.

Generation:

- A separately installed local ComfyUI running on the same machine is required for all current generation workflows.
- Local workflows may require compatible hardware, models, and custom nodes.
- Partner-node workflows require the appropriate Comfy.org credentials and credits.

Optional integrations:

- Pexels API key for the Stock tab.
- Ollama or LM Studio for a local AI assistant, or a Claude, OpenAI or DeepSeek API key for a cloud one.

Local workflow requirements vary by model. Some workflows can run on modest GPUs, while heavy video workflows may need 24 GB+ VRAM. Cloud workflows shift most of that requirement to the provider but may require credits.

## First Run

1. Install and launch Drama Studio.
2. Choose a projects folder.
3. Create or open a project.
4. Use `Drama Studio > Getting Started` from the bottom menu if you want the guided setup path.

To use generation, configure your local ComfyUI instance in `Settings > ComfyUI Connection`. This step is optional for editing, captions, export, project management, and MCP editorial tools. If ComfyUI is running on a non-default port, update the endpoint in Settings and run the connection test.

## ComfyUI Setup Notes

Drama Studio ships workflow JSON files, but workflows still need the correct ComfyUI environment.

Depending on the workflow, users may need:

- Custom nodes installed in ComfyUI.
- Model files in the expected folders.
- Cloud/partner credentials.
- Enough local VRAM for the selected model and resolution.

Drama Studio 0.2.1+ talks to local ComfyUI without any CORS setup. On older Drama Studio versions, launch ComfyUI with `--enable-cors-header` if the embedded tab is blank or API calls return 403.

Inside Generate, use the workflow setup and dependency tools when something is missing.

## Run From Source

See [SETUP.md](SETUP.md) for prerequisites, development, builds and repository setup. The short version:

```bash
npm ci
npm run electron:dev
```

## Versioning

Drama Studio uses `major.minor.patch` versions, starting at **0.1.1**. Every `npm run build` bumps the patch number automatically (skipped on CI). Use `npm run version:minor` or `npm run version:major` for bigger releases. Notes listed under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) are moved under the new version when it is bumped.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

<p align="center">
  <a href="ROADMAP.md">
    <img src="docs/roadmap-overview.svg" alt="Drama Studio roadmap overview" />
  </a>
</p>

## Community

- Discord: [discord.gg/5nAZVQ7K4](https://discord.gg/5nAZVQ7K4)
- Website: [jepoy.dev](http://jepoy.dev/)

## Contributing

Drama Studio is developed in a private repository. If you have access, see [SETUP.md](SETUP.md) and [CHANGELOG.md](CHANGELOG.md), and keep changes focused.

## License

Drama Studio is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`, see `package.json`). It began as a fork of the open-source Velorn project, whose copyright notices are retained as the license requires.
