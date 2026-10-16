# Drama Studio Setup

How to set up, run, build and version Drama Studio from source.

## Prerequisites

- **Node.js 22 or newer** and npm (CI uses Node 22).
- **Git** and, for the repository steps, the [GitHub CLI](https://cli.github.com/) (`gh`).
- Windows 10/11, macOS or Linux.
- Optional, for generation: a local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) install (default `http://127.0.0.1:8188`).
- Optional, for the AI assistant: [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/) for local models, or a Claude, OpenAI or DeepSeek API key.

## Install

```bash
npm ci
```

## Run in development

```bash
npm run electron:dev
```

This starts Vite on `127.0.0.1:5173` and then Electron. Electron's dev mode tries ports 5173 to 5176 in order. If another project is already using one of those ports, Electron can load the wrong app, so stop that project first.

`npm run dev` runs the renderer in a browser only. Many features need the desktop APIs, so use Electron for normal work.

## Build

```bash
npm run build                 # renderer build into dist/ (bumps the patch version first)
npm run electron:build:win    # Windows installer + portable into release/
npm run electron:build:mac
npm run electron:build:linux
npm run electron:pack         # unpacked app for a quick smoke test
```

Official release builds run in GitHub Actions (`.github/workflows/release.yml`). See `docs/RELEASE_PROCESS.md`, `docs/CI_SECRETS.md` and `docs/AI_RELEASE_HANDOFF.md`.

## Versioning

Versions use `major.minor.patch` and started at **0.1.1**.

| Command | Effect |
| --- | --- |
| `npm run build` | Bumps the patch automatically, e.g. 0.1.1 to 0.1.2 |
| `npm run version:patch` | Bumps the patch without building |
| `npm run version:minor` | 0.1.9 to 0.2.0 |
| `npm run version:major` | 0.9.3 to 1.0.0 |
| `npm run version:set -- 0.1.1` | Sets an exact version |

- The automatic bump is skipped on CI (`CI` is set) or when `DS_SKIP_VERSION_BUMP=1`, so release tags and artifacts keep the version you committed.
- A bump updates `package.json`, `package-lock.json` and the version badge in the READMEs.
- If `CHANGELOG.md` has notes under `## [Unreleased]`, the bump moves them under a new `## [x.y.z] - date` heading. Write your notes there as you work.
- The version is shown in the app's bottom bar.

## Tests

The tests are focused Node test scripts, one per area. List them with `npm run` and run the ones for the area you changed, for example:

```bash
npm run test:chat-panel
npm run test:versioning
npm run test:timeline-hotfixes
```

The two RIFE suites (`test:rife-interpolation`, `test:rife-hardening`) are known to fail on Windows checkouts.

## AI assistant

1. Open a project and click **Assistant** in the title bar.
2. Open `Settings > Agents (MCP) > Assistant AI` and pick a backend:
   - **Ollama**: install it, run `ollama pull qwen2.5:7b` (or another tool-capable model) and keep the default address `http://localhost:11434/v1`.
   - **LM Studio**: start the local server (port 1234) and load a model with a context length of 8192 or more.
   - **Claude / OpenAI / DeepSeek**: paste your API key. Keys are saved in local settings only and sent only to that provider.
3. Click **Test connection**, choose a model, and start chatting.

External MCP clients (Claude Code, Codex, Cursor) can connect to `http://127.0.0.1:19790/mcp`. See [docs/MCP.md](docs/MCP.md).

## Repository

The project lives in a private GitHub repository, **Drama Studio** (`jeffreycayao/Drama-Studio`). It is disconnected from the upstream Drama Studio repository.

First-time setup from this folder:

```bash
git init -b main
git add .
git commit -m "Drama Studio 0.1.1"
gh repo create jeffreycayao/Drama-Studio --private --source . --remote origin --push
```

Check `git status` before the first commit: `node_modules/`, `dist/` and `release/` are ignored, but large media under `public/` and `docs/readme/` are included.

## Links

- Discord: https://discord.gg/5nAZVQ7K4
- Website: http://jepoy.dev/
