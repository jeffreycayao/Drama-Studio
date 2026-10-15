# Changelog

All notable changes to Drama Studio are listed here. Versions follow `major.minor.patch`.

Add notes under **Unreleased** as you work. When the version is bumped (every `npm run build`, or `npm run version:minor` / `version:major`), the notes move under the new version automatically. See [SETUP.md](SETUP.md#versioning).

## [Unreleased]

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
