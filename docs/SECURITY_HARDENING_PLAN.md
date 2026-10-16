# Security Hardening Plan (deploy builds)

Drafted 2026-10-16. Goal: make shipped Drama Studio builds hard to tamper
with, hard to lift code or secrets from, and safe for users, without breaking
the guided workflows, portable projects or the RIFE/FFmpeg runtime gates.

## Honest limits first

Drama Studio is an Electron app: the renderer is JavaScript running in
Chromium and the main process is JavaScript running in Node. **Nothing that
ships to a user's machine can be made impossible to reverse-engineer.** A
determined person can always dump memory, attach a debugger, or patch the
binary. What we can do:

1. Make casual inspection useless (no readable source, no source maps, no
   `asar extract` → readable code).
2. Make tampering detectable and stop tampered builds from running.
3. Make sure there is **nothing worth stealing** inside the package: no
   secrets, no keys, no paid assets. Anything valuable lives on a server and
   is checked there.

Point 3 matters most. Obfuscation slows people down; server-side checks stop
them.

## Current state (audit of the working tree)

| Area | State | Where |
| --- | --- | --- |
| Context isolation, no node integration | On for all windows | `electron/main.js` (`createWindow`, popups, export worker) |
| Renderer sandbox | Only popup windows use `sandbox: true`; the main window and export worker do not | `electron/main.js` |
| `webSecurity` | Off for the export worker (needs `file://` media) | `electron/main.js` export worker |
| DevTools | F12 / Ctrl+Shift+I toggle DevTools **in production too** | `electron/main.js` `before-input-event` |
| Electron fuses | Not set (RunAsNode, NODE_OPTIONS, `--inspect` all still allowed) | none |
| ASAR integrity | Not enabled | none |
| Source maps | Excluded from the package (`!**/*.map`), and the content gate refuses them | `package.json` `build.files`, `scripts/package-content-gate.cjs` |
| Minification | Vite minifies the renderer; main-process files ship as readable source | `vite.config.*`, `electron/` |
| Code signing | Azure Trusted Signing in CI releases; local `exe:latest` builds are unsigned | `.github/workflows`, `docs/AI_RELEASE_HANDOFF.md` |
| Content Security Policy | None in `index.html` | `index.html` |
| Secrets at rest | R2 secret stored with `safeStorage` (DPAPI), shielded from the generic settings IPC | `electron/main.js` (`isMainOnlySettingKey`) |
| Secrets in the package | Gate refuses `R2_*keys*.txt`; no keys are bundled | `scripts/package-content-gate.cjs` |
| Heavy content | SFX packs, models and archives download after install; gate enforces it | `scripts/package-content-gate.cjs` |

## Plan

Ordered by value per effort. Phases 1 and 2 are low risk and can ship in
the next release.

### Phase 1: lock the runtime (low effort, high value)

1. **Electron fuses.** electron-builder 26 flips fuses at package time
   through `build.electronFuses`:
   - `runAsNode: false`: blocks `ELECTRON_RUN_AS_NODE`, so the exe can't be
     used as a plain Node interpreter to load our code.
   - `enableNodeOptionsEnvironmentVariable: false`: blocks `NODE_OPTIONS`
     injection (`--require evil.js`).
   - `enableNodeCliInspectArguments: false`: blocks `--inspect` and
     `--remote-debugging-port`, so nobody can attach a debugger to the main
     process.
   - `enableEmbeddedAsarIntegrityValidation: true` and
     `onlyLoadAppFromAsar: true`: the exe refuses a modified `app.asar` or a
     loose `app/` folder next to it.
   - `enableCookieEncryption: true`.
   - `grantFileProtocolExtraPrivileges: false`, but only after confirming
     the `file://` loads (main window, export worker, media) still work.
     Otherwise leave it on.
   - **Check:** the RIFE and native helper gates (`scripts/runtime-package-gate.cjs`)
     and the MCP bridge still pass. Our own dev runs over CDP use the dev
     Electron binary, so they are not affected.
2. **DevTools off in production.** Register the F12 / Ctrl+Shift+I toggle
   only when `isDev`. Also set `devTools: !app.isPackaged` in each window's
   `webPreferences`, and close DevTools if they open
   (`webContents.on('devtools-opened')`). Keep an opt-in for support,
   e.g. `DS_ALLOW_DEVTOOLS=1` read only in unpacked builds.
3. **Content Security Policy** for the renderer: `default-src 'self'`,
   `script-src 'self'`, with `img-src`/`media-src` allowing `file:`,
   `blob:`, `data:` and the stock and Discover hosts, and `connect-src`
   allowing ComfyUI (`http://127.0.0.1:*`), R2 and the cloud provider hosts.
   Ship it as a `<meta>` tag first, in report-only style while testing. Then
   enforce it through `session.defaultSession.webRequest.onHeadersReceived`.
4. **Sandbox the main window.** `electron/preload.js` only requires
   `electron` (`contextBridge`, `ipcRenderer`, `webUtils`), so
   `sandbox: true` should work. Test drag-drop (`webUtils.getPathForFile`),
   file dialogs and the MCP bridge. The export worker keeps
   `webSecurity: false` for now, but gets `sandbox: true` too.
5. **Sign every build users get**, including test builds handed to people
   (Azure Trusted Signing already exists in CI). Unsigned builds stay
   local-only.

### Phase 2: make the shipped code unreadable (medium effort)

6. **Bundle and minify the main process.** Today `electron/*.js|cjs|mjs`
   ship as readable source inside `app.asar`. Bundling them with esbuild
   into one minified `main.bundle.cjs`, plus `preload.bundle.cjs`, removes
   comments and names and shrinks the asar. Native and binary paths
   (ffmpeg-static, ffprobe-static, RIFE) stay external.
7. **V8 bytecode for the main process** (strongest practical step). Compile
   the bundled main and preload to `.jsc` with
   [bytenode](https://github.com/bytenode/bytenode), or with electron-vite's
   bytecode plugin, at package time. A small loader `main.cjs` requires the
   `.jsc`. This removes JavaScript source from the main process entirely.
   - **Caveats:** the bytecode must be compiled by the *same Electron
     version and arch* (run the compile step with the packaged Electron
     binary). `Function.prototype.toString` returns nothing useful, which a
     few libraries rely on. Test `js-yaml`, `yauzl` and the MCP server.
8. **Renderer obfuscation** (optional): run
   [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator)
   on the Vite output, with moderate settings: string-array encoding and
   identifier renaming, but no control-flow flattening, which costs 1.5 to
   3× in runtime speed and would hurt timeline playback. The renderer can't
   use V8 bytecode, so this is its ceiling. Apply it to app code chunks
   only, not vendor chunks.
9. **Strip debug surfaces from production**: the CDP and debug flags, the
   `?export=worker` query handling stays but is checked against a per-run
   token, and verbose IPC logging is turned off.

### Phase 3: nothing valuable in the package (server side)

10. **No storage keys in the client.** The R2 read-only keys currently come
    from the user's key file. For public builds, replace them with a small
    **Cloudflare Worker** that returns short-lived presigned URLs
    (`GET /sfx/manifest`, `GET /sfx/pack/:id`), so the app never holds R2
    credentials. Rate-limit it per install id. `electron/r2Client.cjs` keeps
    working for the owner/dev path.
11. **Licensing / entitlement checks on the server**, if Drama Studio gets
    paid tiers: sign in or enter a license key, the server returns a signed
    entitlement token (Ed25519), and the app verifies the signature offline
    with an embedded *public* key. Premium content (packs, workflows) is
    served only against a valid token, so cracking the client unlocks
    nothing that isn't on the user's disk already.
12. **Signed content manifests.** Discover catalog, workflow catalog and SFX
    manifest are fetched remotely. Sign them (Ed25519) and verify them in
    the main process before use, so a hijacked host or MITM can't push
    workflows or links. This also needs a public home for the Discover
    catalog: today `src/services/discoverCatalog.mjs` points at the private
    GitHub repo.
13. **Update integrity.** If auto-update is added, use electron-updater with
    signed releases only and verify the publisher signature, never plain
    HTTP feeds.

### Phase 4: tamper detection and response (optional)

14. **Runtime self-checks**: at start-up, verify the exe's Authenticode
    signer (Windows) matches ours. With ASAR integrity on, this mostly
    catches repacked exes. On mismatch, show a "This copy of Drama Studio
    was modified" notice and disable cloud and premium features, without
    crashing or deleting anything.
15. **Crash/tamper telemetry** (opt-in only, with a privacy note): report
    integrity failures so cracked builds in the wild are visible.

## What not to do

- Don't hide secrets in obfuscated code or "encrypted" config. Anything the
  app can decrypt, an attacker can too.
- Don't use aggressive anti-debugging loops or VM-detection tricks. They
  break on real users' machines (antivirus, remote desktops) and generate
  support tickets.
- Don't block offline use: editing, captions and export must keep working
  without a server (see `AGENTS.md`).

## Suggested rollout

| Step | Change | Risk | Verify with |
| --- | --- | --- | --- |
| 1 | Fuses (except `grantFileProtocolExtraPrivileges`) + DevTools off in prod | Low | `npm run exe:latest`; open project, import, play, export; `npx @electron/fuses read --app "release/win-unpacked/Drama Studio.exe"` |
| 2 | CSP in report-only, then enforced | Medium | Console clean in packaged build across Generate, Stock, SFX, Discover, ComfyUI |
| 3 | Main window + export worker `sandbox: true` | Medium | Drag-drop, dialogs, export, MCP |
| 4 | esbuild bundle + bytenode for main/preload | Medium | Full smoke + `test:*` suites against the packaged build |
| 5 | Renderer obfuscation (app chunks) | Low–Medium | Playback FPS and export speed unchanged |
| 6 | Presign Worker for SFX, signed manifests | Medium | Fresh-install SFX download with no keys configured |
| 7 | Entitlement server (only if paid tiers) | High | Separate design doc |

Steps 1 to 3 together are about one working session. Steps 4 to 6 are about
one each.
