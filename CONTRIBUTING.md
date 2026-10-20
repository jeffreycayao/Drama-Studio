# Contributing to Drama Studio

Thanks for helping. Drama Studio is a desktop video editor for creators. These rules keep it safe and simple for them, and keep reviews predictable for you.

## The rules

1. **Every change goes through a pull request.** Nobody pushes directly to `main`, maintainers included. Open a pull request from a branch (in your fork, or in this repository if you have write access).
2. **A human maintainer must approve the pull request before it is merged.** An approval from a bot, an AI reviewer or the author does not count. A maintainer may ask for changes, split a pull request, or decline it.
3. **Say whether AI helped write the code.** If an AI tool (Claude, Codex, Copilot, Cursor, ChatGPT or any other) wrote or changed any of the code, tests or docs in the pull request, tick the AI box in the pull request template and say which parts and which tool. This is not a mark against the change; it tells the reviewer where to look harder.
4. **AI-assisted code must pass two reviews before merge:**
   - a **security review**: no secrets, no new network endpoints or remote code, safe file paths, IPC and preload stay narrow, untrusted input (workflow JSON, packs, catalogs, browser messages, MCP calls) is validated, and nothing weakens the app's sandboxing or Content Security Policy;
   - a **logic/correctness review**: the change does what it says, edge cases are handled, nothing else breaks, and the tests actually test the change.

   The maintainer who approves records both reviews in the pull request (the template has checkboxes). Automated review tools can help, but a human signs off.
5. **Tests and builds must pass.** Run the tests for the areas you touched and make sure `npm run build` works (see [Tests](#tests)). CI checks on the pull request must be green.
6. **You must have the right to contribute the code.** Only submit work you wrote yourself, or code under a license compatible with GPL-3.0-only with its notice kept. Do not paste code from closed-source products, other browser extensions or websites. Contributions are accepted under the project's license, GPL-3.0-only (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).

## Set up

You need Node.js 22 or newer and Git. The browser extension needs Node.js 24 and npm 11.

```bash
git clone https://github.com/<you>/Drama-Studio.git
cd Drama-Studio
npm ci
npm run electron:dev
```

ComfyUI is only needed for generation features. Editing, captions and export work without it. More detail is in [SETUP.md](SETUP.md) and the [README](README.md#build-from-source).

For the Companion browser extension:

```bash
cd extensions/companion
npm ci
npm run dev
```

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach before you write it.
2. Create a branch from `main` with a short descriptive name, for example `fix/caption-timing-drift` or `feature/fade-presets`.
3. Keep the pull request focused on one change. Unrelated clean-ups go in their own pull request.
4. Add a short user-facing note under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) when the change is something users will notice. Write it for creators, in plain words.
5. Update docs when behaviour, setup or onboarding changes.
6. Open the pull request and fill in the template completely.

### Versions

Do **not** change the version in `package.json` by hand. `npm run build` bumps the patch automatically. In a pull request, build with `DS_SKIP_VERSION_BUMP=1` so the version does not change, or leave the version changes out of your commits. Maintainers bump versions at release time with `scripts/bump-version.cjs` (`npm run version:minor`, `npm run version:major`).

## Coding style

Match the code around you. [AGENTS.md](AGENTS.md) has the project conventions; the important ones:

- **Naming.** The product is "Drama Studio" in running text and "Drama Studio™" on brand surfaces (window title, splash, welcome hero, wordmark). Do not use the upstream project's name in user-facing text, docs or MCP metadata. `comfystudio` survives only as an internal compatibility identifier (package name, protocol, file-extension namespace, legacy aliases). Keep existing legacy aliases; do not add new ones.
- **Design.** Use the `sf-*` theme tokens, not raw colors. Text on solid lime is always charcoal.
- **Product.** Keep guided, simple workflows for creators. Do not turn routine screens into node-graph configuration.
- **Generation and editing stay separate.** Editing, captions and export must not need ComfyUI. Any new ComfyUI-backed entry point must use the `ensureComfyFor(feature)` guard (`src/stores/comfySetupStore.js`).
- **Portable projects.** Store project-owned media paths relative to the project where possible, and keep older projects loading.
- **Agent and MCP write actions** inspect first, preview when they can, and use the existing undo/checkpoint paths.
- **Links.** Public links live in `src/config/projectInfo.js`. Do not add endpoints, downloads or feedback routes that point at the upstream project.
- **Security.** Never commit secrets, API keys, `.env` files, certificates or key files. Keys entered by users stay on their machine (Electron `safeStorage`). Renderer code gets no new Node access; add narrow IPC instead.
- **Formatting.** The app follows the existing style of each file (two-space indent, no semicolons in most renderer files). The Companion uses Prettier and ESLint: run `npm run check` in `extensions/companion`.

## Commit messages

- One logical change per commit.
- A short summary line in the imperative or as a plain description of the result (about 72 characters or less), for example `Captions: keep word timing after a ripple trim`. A prefix naming the area is welcome.
- A blank line, then a body that explains **why**, when it is not obvious.
- Reference issues as `Fixes #123` where it applies.
- If an AI tool co-wrote the commit, add a `Co-Authored-By:` trailer naming it.

## Tests

The app's tests are focused Node test scripts. `npm run` lists them. Run the ones for the area you changed, for example:

```bash
npm run test:chat-panel
npm run test:timeline-hotfixes
npm run test:export-scheduler
npm run test:versioning
npm run check:versions
DS_SKIP_VERSION_BUMP=1 npm run build
```

Renderer tests sit next to their source as `*.test.mjs`; main-process and cross-cutting tests are in `tests/`. Add or update tests for the behaviour you change. Bug fixes should come with a test that fails without the fix.

Changes in Electron IPC, preload, file handling or packaging should also be tried in the running app (`npm run electron:dev`), and for packaging changes in a packaged build (`npm run exe:latest` on Windows).

For the Companion, run `npm run check` (and `npm run verify` for build or manifest changes) in `extensions/companion`.

The two RIFE suites (`test:rife-interpolation`, `test:rife-hardening`) are known to fail on Windows checkouts.

## Reporting bugs and asking for features

Open a GitHub issue with steps to reproduce, what you expected, what happened, your OS and the Drama Studio version (shown in the app's bottom bar). Leave out personal media and API keys. Questions and ideas are also welcome on [Discord](https://discord.gg/5nAZVQ7K4).

## Security issues

Do not open a public issue for a security problem. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

Be kind and constructive. Review the code, not the person. Harassment or abuse of any kind is not tolerated, and maintainers may remove comments, close pull requests or block accounts that cross that line.
