# Changelog

## 0.5.1 (2026-10-18)

- One build with both the 0.5.0 Grok Imagine changes and the 0.4.2 Suno
  lyrics fix below.

## 0.5.0 (2026-10-18)

- **Grok Imagine sets the shape for you.** When a job from Drama Studio
  asks for a shape (16:9, 9:16, 1:1 and so on), the Companion opens Grok's
  shape menu and picks it, after filling the prompt and adding your
  reference files. It then checks the menu shows the new shape. If Grok
  has no such shape, or the menu does not change, it closes the menu and
  tells you to set the shape yourself, as before. Opening that menu and
  picking the shape are the only clicks; it never presses Generate or a
  submit button.
- **Send to Drama Studio button on Grok Imagine.** Point at a picture or
  video Grok made and a small **Send to Drama Studio** button shows in its
  corner. It does what the right-click menu does: the file goes into your
  project under AI Sites. Only results from Grok's own hosts get the
  button, and only a real click sends anything. The right-click menu still
  works on every site.
- No new permissions. The button uses the Grok access the Companion
  already has; if Chrome has not allowed a site yet, it points you to the
  right-click menu, where Chrome can ask.

## 0.4.2 (2026-10-18)

- **Suno lyrics.** The Companion now waits for Suno's lyrics editor, which
  appears a moment after the style box, instead of looking for it once. In a
  real run the style and title were filled but the lyrics were not; they are
  now filled too. The title box is waited for the same way.

## 0.4.1 (2026-10-18)

Checked live on Suno's create page, signed in:

- The style box is found by its section on the page, since its placeholder is
  a changing example rather than the word "style".
- Lyrics keep their line breaks: multi-line text goes into rich editors (such
  as Suno's lyrics box) as a paste over the whole box. The clipboard itself
  is never read or changed.
- Suno's mode tab is **Advanced** (and **Simple**). Only real tabs are
  clicked, so a plain button with the same word, such as Duration ›
  Custom, is never touched. A simple song switches to the Simple tab first,
  because Suno keeps that box on the page while Advanced is open.

## 0.4.0 (2026-10-18)

- **Suno.** A song from Drama Studio opens Suno's create page with the
  words filled in. In simple mode the song description goes in the
  description box. In custom mode the Companion switches to the Custom tab
  and fills the style of music, the lyrics and the title. That mode tab is
  the only thing it clicks. It never clicks a submit button, and you press
  Create yourself. For an instrumental it leaves the lyrics empty and
  reminds you to turn Instrumental on.
- Browser jobs now have a third kind, **audio**, with optional song settings
  (custom mode, lyrics up to 5,000 characters, title, instrumental). Drama
  Studio and the Companion check them the same way.
- **Send to Drama Studio** also takes songs (MP3, WAV, M4A) from Suno's own
  hosts. Right-click a player on the page; Chrome asks once to allow
  downloads from Suno (`*.suno.com`, `suno.com`, `*.suno.ai`, new optional
  host permissions, asked only when used).
- Plain text inputs (such as a title box) can now be filled, not just
  textareas and rich editors.

## 0.3.0 (2026-10-18)

- **Eleven more AI sites for browser jobs:** Google Flow, Kling AI, Runway,
  Hailuo AI, Luma Dream Machine, Pika, ChatGPT images, Gemini, Midjourney,
  Ideogram and Leonardo, next to Grok Imagine. A job from Drama Studio opens
  the site with the prompt filled in. You still press Generate yourself.
- **Reference files are attached.** The pictures and clips picked in Drama
  Studio are read from the desktop link in small pieces and handed to the
  site's own upload button, or dropped on the prompt box when there is no
  button. If neither works, the Companion says so and you add them yourself.
- The Companion tells you which shape and length to set on the page, since
  each site keeps those settings in its own menus.
- **Send to Drama Studio** works on all twelve sites, for pictures and videos
  from each site's own media hosts only.
- **New optional permissions,** one site at a time: the first time you send
  a result from a site, Chrome asks you to allow downloads from that site's
  media hosts. Nothing is asked at install, and Grok works as before.
- Prompt boxes that are on screen win over hidden ones, so the generic
  fallbacks never fill an off-screen field.

## 0.2.0 (2026-10-17)

- **Browser jobs from Drama Studio.** A `#dsjob=` link from Drama Studio
  fills its prompt on Grok Imagine and tells Drama Studio the job is waiting
  for you. The Companion never presses Generate; you check the prompt and
  start it yourself. Reference files are listed but not attached yet.
- **Send to Drama Studio.** Right-click a picture or video on Grok and pick
  **Send to Drama Studio**. The file goes straight into the open project,
  under AI Sites, with the prompt it was made from. Drama Studio checks the
  size and fingerprint of every file before keeping it.
- **New permission: context menus** (`contextMenus`). It is only used for
  the **Send to Drama Studio** item, which appears on Grok pages and only on
  pictures and videos from Grok's own media hosts. Nothing is sent until you
  pick it.
- The desktop link speaks protocol 2 for jobs and captures and still uses
  protocol 1 for hand-offs, so an older Drama Studio keeps filling prompts.
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
