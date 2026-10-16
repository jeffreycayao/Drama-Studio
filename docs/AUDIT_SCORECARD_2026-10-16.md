# Bug and security audit scorecard (2026-10-16)

Scope: the three features added today (hero conform, auto-ducking, SFX
library), every boundary they touch, and the app-wide Electron trust boundary
(window settings, navigation, custom protocol, IPC that handles secrets, the
loopback MCP server, the embedded ComfyUI bridge, process spawning).
Method: code reading plus targeted tests. No penetration testing against a
running packaged build.

Severity: **High** = exploitable from outside the app with real impact.
**Medium** = exploitable with a precondition, or a bug that silently produces
wrong output. **Low** = hardening or a narrow edge case. **Info** = accepted
by design, documented.

## Scorecard

| ID | Area | Finding | Severity | Status |
| --- | --- | --- | --- | --- |
| S1 | MCP server (`electron/mcpServer.js`) | Any website open in the user's browser can drive the loopback MCP server: POST bodies are parsed as JSON-RPC whatever their `Content-Type`, and `Origin`/`Host` are not checked. A no-CORS `text/plain` POST is a "simple request" (no preflight), so a page can call tools that edit the timeline, queue generation (spending cloud credits), change the ComfyUI connection or export. DNS rebinding works the same way. | High | Fixed |
| S2 | ComfyUI bridge (`GenerateWorkspace.jsx`) | The `message` listener that imports workflows sent by the ComfyUI bridge does not check `event.origin`, so any frame or popup can replace the user's custom Generate / Director workflows. | Medium | Fixed |
| S3 | Settings IPC (`settings:get/set/delete`) | Assistant API keys are meant to be readable only in main, but the generic `settings:get` returns them (and the whole settings file, keys included) to the renderer, and `settings:set` can overwrite them without the key-format checks of `llm:setApiKey`. | Medium (defense in depth) | Fixed |
| S4 | SFX downloads (new) | A `206 Partial Content` response was appended without checking that `Content-Range` starts at the requested offset. A misbehaving server or proxy could corrupt a resumed file when the catalog has no SHA-256. | Low | Fixed |
| S5 | `comfystudio://` protocol | Serves any absolute path; the inline comment claims a restriction that does not exist. The scheme is not registered as privileged (no Fetch/CORS support), so other origins can display but not read files. Restricting it to project folders would break assets linked from elsewhere. | Low | Comment corrected; restriction left as a follow-up |
| S6 | Window settings | Context isolation on and Node integration off for every window; external navigation and `window.open` hand off to the OS browser; `shell:openExternal` allows only http(s)/mailto. Dev mode and the hidden export worker run with `webSecurity: false` to load local media. | Info | Accepted (documented) |
| S7 | Renderer filesystem IPC | `fs:*` handlers accept any path from the renderer. Normal for a desktop editor whose renderer is first-party code with no HTML injection sinks (`dangerouslySetInnerHTML`/`innerHTML` are not used). | Info | Accepted |
| S8 | Process spawning | All FFmpeg/FFprobe/helper calls use argument arrays. The only shell invocations are the user-configured ComfyUI launcher scripts. | Info | No issue |
| S9 | SFX catalog (new) | Catalog is untrusted input. Verified: ids restricted to `[A-Za-z0-9._-]`, paths derived from ids and checked to stay in the cache, HTTPS only, downloads limited to the catalog's origin (off-origin CDN redirects only when a SHA-256 pins the bytes), size caps, streaming SHA-256, catalog size cap. | Info | No issue (tests cover each rule) |
| S10 | SFX catalog (new, found by the automated post-commit review) | A downloaded catalog could declare any HTTPS `baseUrl`, which widened the download allowlist, so a hostile catalog could make the app fetch other hosts, including private-network IP literals. | Medium | Fixed: `baseUrl` limited to the catalog's own origin; loopback, private, link-local and CGNAT IP literals and `.local`/`localhost` names refused for catalog, entries and redirects. Hostnames that only *resolve* to private IPs are not caught (would need DNS pinning). |
| B1 | Auto-duck dialog (new) | A proposal stayed applicable after the **dialogue** clips or track levels changed, so a moved line could be ducked at its old time. Only changed music clips invalidated it. | Medium | Fixed |
| B2 | SFX drag prefetch (new) | A finished prefetch was reused for 5 minutes. After **Clear cache** the next drop tried to copy a deleted file and failed. | Low | Fixed |
| B3 | SFX preview (new) | Clicking a second sound while the first preview source was still loading could start the earlier sound under the wrong row. | Low | Fixed |
| B4 | `applyAutoDucking` (new) | The stored `autoDucking.settings` copied any object into the project file. | Low | Fixed (known keys only) |
| B5 | SFX timeline drop (new) | The drop used the frame rate captured when the drag started; a frame-rate change during the download would place the clip on the old grid. | Low | Fixed |
| B6 | Music ducking dialog (existing) | **Apply volume points** declares `text-white` on the lime accent. Not visible: a global rule in `src/index.css` already renders text on `bg-sf-accent` in charcoal. | Info | Class cleaned up for consistency |
| B7 | SFX search (new, found in the UI pass) | Two-letter abbreviations never matched ("dr slm" found nothing for "Wooden Door Slam"): subsequence matching only ran for tokens of 3+ letters over the whole name. | Low | Fixed (word-anchored abbreviations) |

Totals: 1 High, 4 Medium, 7 Low, 5 Info. All High and Medium items fixed.

## Fix notes

- **S1:** the server now refuses (403) any request carrying a browser `Origin`
  header (MCP clients such as Claude Code, Codex and Cursor do not send one),
  refuses a `Host` that is not `127.0.0.1`, `localhost` or `[::1]` on its own
  port (DNS rebinding), and requires `Content-Type: application/json` on POST
  (which forces a CORS preflight that the server does not grant). Origins can
  be allowed explicitly with `VELORN_MCP_ALLOWED_ORIGINS` (comma-separated)
  for a future browser-based client.
- **S2:** bridge messages are accepted only from the configured ComfyUI origin
  (`localhost` and `127.0.0.1` are treated as the same host).
- **S3:** the generic settings handlers refuse `chatApiKey.*` keys and strip
  them from the all-settings response. Keys are still written with
  `llm:setApiKey` and read only by the main process.
- **S4:** a `206` whose `Content-Range` start differs from the requested
  offset restarts the file from zero.
- **B1:** proposals carry a signature of every input the detector reads
  (dialogue and music clips on role tracks, their gain/fades/envelopes and
  track mute/solo/volume); any change discards the proposal.

## Verification

- New regression tests: `npm run test:security-hardening` (MCP guard over real
  loopback HTTP, settings key shield on the extracted real handlers, bridge
  origin rule), plus additions to `test:sfx-library` (wrong `Content-Range`,
  prefetch, abbreviations) and `test:auto-ducking` (staleness signature,
  settings whitelist).
- UI pass: the real dialogs, SFX browser and settings section were rendered
  in a browser harness with real stores and a mocked desktop bridge (synthetic
  data). Checked: search, auto-duck analyze → stale-on-dialogue-move → apply
  (one undo entry, exact attack/hold/release times), conform plan → GPU
  confirmation → hero arrival → swap with unchanged edit points. No console
  errors.

## Not covered

- No packaged Windows/macOS/Linux build was exercised; the MCP fix is tested
  against the real server class over loopback HTTP, not a packaged app.
- The ComfyUI bridge fix was checked by reading the bridge script
  (`electron/comfyui-injected/comfystudio_bridge`); a live ComfyUI was not run.
