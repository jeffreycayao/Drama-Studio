# Changelog

## Unreleased

- **Works with the Drama Studio desktop link.** Drama Studio now ships the
  native host, so Settings › Drama Studio desktop reports "Connected to Drama
  Studio" once the browser is allowed in the app, with a **Check again**
  button after you click Allow. `#ds=` hand-offs from Drama Studio's
  **Open in…** fill the prompt.
- The link check sends a short browser name ("Chrome 141", "Edge 141")
  instead of the whole user-agent string, which was longer than the wire
  format allows.

## 0.1.0 (2026-10-17)

First Drama Studio Companion build: the Grok batch automator and the
long-prompt helper merged into one extension.

- **One extension.** The prompt-fill helper is now a TypeScript module of the
  Companion, with tests for every site's prompt box.
- **Drama Studio look.** Charcoal surfaces, cream text, one lime accent with
  charcoal text, olive for quiet decoration, the desktop app's fonts (Inter,
  Sora, JetBrains Mono) and Drama Studio icons.
- **Batches stop instead of pushing on.** A CAPTCHA, usage limit, moderation
  message or sign-in page stops the whole batch, with no retry, and the side
  panel says why. Only timeouts and network errors are retried.
- **Site changes are visible.** If Grok changes its page so the prompt box
  cannot be found, the batch does not start and the side panel says an update
  is pending.
- **Links ask first.** A prompt in a plain `#prompt=` link is shown in a
  "Fill / Dismiss" bar instead of being typed in silently, and leaves the
  address bar at once.
- **Drama Studio hand-off.** `#ds=<token>` links fetch the prompt from the
  desktop app over the desktop link, so prompts never travel in the URL. The
  desktop side is not shipped yet; until then the Companion says so.
- **No account needed.** The separate sign-in, plans and server check before
  every Run are gone.
- Removed: the remote "storage helper" script and its bookmarklet, the hosted
  landing page and API, the version badge, and leftover notes from the
  products this was built from.
