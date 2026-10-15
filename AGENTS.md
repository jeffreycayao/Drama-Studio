# Agent Notes

- The product/app is called Drama Studio™ (renamed from Velorn in October 2026). Use "Drama Studio™" on brand surfaces (window title, splash, welcome hero, wordmark) and plain "Drama Studio" in running text. Do not call it Velorn or ComfyStudio in user-facing text, MCP metadata, docs, or chat.
- `comfystudio` may still appear as a legacy package name, protocol/file-extension namespace, bridge identifier, repository URL, or backward-compatible MCP alias. Treat those as internal compatibility identifiers only.
- `Velorn`/`velorn` likewise remains in compatibility identifiers: the npm package name, the `%APPDATA%/Velorn` userData folder (pinned in `electron/main.js`), ComfyUI output filename prefixes, the `Velorn.Bridge` extension id, the RIFE "Velorn secure build" marker, env vars (`VELORN_*`) and the `com.comfystudio.app` app id. Do not rename these.
- The project is disconnected from the upstream Velorn repository. Its own repository is the private `jeffreycayao/Drama-Studio` on GitHub. Do not add links, endpoints, downloads or feedback routes that point at `VelornLabs/velorn`, `velorn.ai` or the upstream feedback worker. Public links live in `src/config/projectInfo.js` (Discord `https://discord.gg/5nAZVQ7K4`, website `http://jepoy.dev/`).
- Versioning is `major.minor.patch`, managed by `scripts/bump-version.cjs`: every `npm run build` bumps the patch (skipped on CI or with `DS_SKIP_VERSION_BUMP=1`); use `npm run version:minor|major` for bigger releases. Add user-facing notes under `## [Unreleased]` in `CHANGELOG.md`. Do not hand-edit the version in `package.json`.
- Visual identity: warm charcoal surfaces (`#27231B` family), cream text (`#F6F1E6`), one electric-lime accent (`#D5FA00`), olive (`#687323`) for quiet decoration. Text on solid lime is always charcoal. Use the `sf-*` theme tokens, not raw colors.
- Read `docs/AI_PROJECT_CONTEXT.md` before substantial implementation work.
- Read `docs/AI_CURRENT_HANDOFF.md` for the current branch, migration, and verification state.
- Read `docs/AI_RELEASE_HANDOFF.md` before commits, tags, releases, or GitHub Actions work.
- Velorn is a creator-facing desktop video editor. Preserve simple guided workflows; do not turn routine product surfaces into ComfyUI-style node configuration.
- Keep project files portable. Store project-owned media paths relative to the project when possible and preserve legacy project compatibility.
- Treat generation and editing as separate layers: editing, captions, and export must not require ComfyUI unless the specific feature is explicitly a ComfyUI workflow.
- Agent write actions should inspect first, preview when supported, and use Velorn's existing undo/checkpoint paths.
- Keep changes narrowly scoped and test risky behavior at the renderer, Electron IPC, and packaged-platform boundaries it touches.
