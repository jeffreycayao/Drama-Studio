# Side-panel design QA

Review date: 2026-08-17

The `0.0.2` rebuild was checked against the seven supplied screenshots from the
signed `2.6.3` extension. The reference distribution was used read-only. The
active interface is implemented as maintainable Vue components and local CSS.
Version `0.0.10` retains that geometry and wiring while intentionally applying
the requested SYS001X color and typography system and projecting the connected
Google account plus exact session-resolved plan into the plan banner.

## Reproducible capture

Build the production extension, then run the disposable Chromium capture:

```powershell
npm run build:grok
npm run smoke:grok -- "C:\path\to\chrome-for-testing.exe" --capture-dir ".recovery-tmp\visual-final"
```

The capture tool asserts a `536 × 890` viewport, Vue mount, the first-use modal,
Grok-page detection, Control/Setting/Debug Logs navigation, top and bottom
scroll positions, and an empty runtime-error list. It writes:

1. `01-fresh-tip-modal.png`
2. `02-control-top.png`
3. `03-control-bottom.png`
4. `04-settings-top.png`
5. `05-settings-bottom.png`
6. `06-debug.png`
7. `07-signed-out-run-gate.png`

The generated screenshots are intentionally ignored by Git.

The `0.0.3` SYS001X capture completed on 2026-08-15 with all six states at
`536 × 890`, successful Grok-tab detection and an empty runtime-error list. The
reviewed local captures are under `.recovery-tmp/visual-sys001x/`.

The `0.0.6` seven-state capture completed on 2026-08-16 at `536 × 890`. It
mounted with document title and visible heading **Grok Automator™**, opened a
Grok context without submitting a prompt, exercised the signed-out Run gate,
and reported no runtime errors. The ignored evidence is under
`.recovery-tmp/visual-0.0.6/`.

The `0.0.7` seven-state recapture completed on 2026-08-16 at `536 × 890`. The
shared footer remains in normal document flow below the active view, its local
Shields badge loaded with manifest version `0.0.7`, the exact copyright stamp
rendered legibly, and no `img.shields.io` resource was requested. The smoke run
reported no runtime errors and the reviewed evidence is under
`.recovery-tmp/visual-0.0.7/`.

The `0.0.8` seven-state recapture completed on 2026-08-17 with Chrome for
Testing `146.0.7680.31` at `536 × 890`. The footer rendered the exact PAKS LLC
stamp and local `0.0.8` Shields badge, the resource audit reported no hosted
Shields request, navigation across Control/Setting/Debug and the signed-out Run
gate passed, and runtime errors were empty. The ignored evidence is under
`.recovery-tmp/visual-0.0.8/`. An earlier attempt with regular branded Chrome
failed to mount the isolated panel, matching the documented runner limitation;
it was not counted as release evidence.

The `0.0.10` account-banner release must add a deterministic signed-in capture
using a synthetic local session fixture, not a tracked screenshot containing a
real customer's email. The capture must show a connected account and exact Free,
Grok Automator™, or All Apps plan without a residual sign-in prompt, horizontal
overflow, remote avatar, or runtime error. Passing evidence is recorded only
after the root CI and isolated-browser run complete.

## Comparison findings

The reference and production screenshots were rendered together at their
captured size before this review. The rebuilt UI matches the important visible
relationships:

- the original near-black geometry, gray outlined fields and 8–10 px card
  radius/spacing, with mint intentionally replaced by restrained SYS001X gold;
- identity/plan header, three primary tabs and the five-mode 3+2 selector;
- two-column concurrency/delay and output/folder controls;
- prompt text/file/spreadsheet input, large always-visible prompt queue and the
  Report Bug/Clear/Run action row below the queue;
- one-card-per-setting sequence, retry stepper, download settings, save/reset
  actions and sync notice;
- flat debug toolbar with entry count, auto-scroll, Copy/Clear and an expanding
  empty/log viewport; and
- 448 px first-use modal with gold/charcoal advice and warning panels plus two
  stacked actions over a blurred backdrop.

The locally bundled typography follows the repository rule: Instrument Serif
for the product and narrative display headings, Manrope for body text, controls
and navigation, and IBM Plex Mono for metadata, statuses and tabular numbers.
Tabler components replace the original icon set without remote assets or
handcrafted SVGs.

Production verification requires canonical `#D4AF37` gold, `#B8860B` deep
gold, `#1C1C1C` charcoal, `#0A0A0A` black, white/muted-white and neutral border
tokens. It rejects the previous mint/blue/green values, verifies gold focus and
dark text on primary gold actions, and requires all eight local WOFF2 faces.

## Intentional differences

The old publisher name, author email/domain, Discord/store identity, pricing
claim, public manifest key and email-token login are not present. Their visible
slots use Paks Tools Faceless automations copy and the fail-closed Google-only
central-auth readiness flow. These are product/security requirements, not
missed visual states.

The central release footer is also an intentional addition rather than a
recovered `2.6.3` element. Its Shields badge is generated locally and packaged
with the extension; no remote badge, font, icon, or stylesheet is required.

The current UI exposes English only until complete maintained catalogs are
available. No unimplemented locale is presented as working.

## Interaction checks

- First-use modal closes through its close/Got it actions and can persist “do
  not show again.”
- Exactly one central footer remains present after switching among Control,
  Setting, and Debug Logs; its badge version matches the manifest and its image
  loads from the extension origin only.
- All five mode controls are keyboard-focusable and update the composer.
- Every tool remains visible while signed out; selecting **Run** opens the
  Google-only dialog and does not create a prompt group.
- A connected session renders the verified display name/email and exact
  session-resolved plan; missing names fall back to the verified email, and no
  signed-in state instructs the user to sign in again.
- After sign-in, **Run** requires a matching server allowance before queueing;
  entitlement, quota, capability, session, validation, timeout, and network
  failures leave the queue unchanged.
- TXT, CSV, XLS and XLSX inputs are local-only and produce validated prompts.
- Image uploads support drop, sort, drag reorder, keyboard reorder and removal.
- Per-prompt sequence options and prompt range feed the validated payload
  builder.
- Control settings auto-save and synchronize through WXT storage; explicit
  Save and Reset remain available.
- Queue cancellation targets its originating Grok tab, and queue/debug state
  replays after panel reopen.
- Debug Copy/Clear and auto-scroll expose only local diagnostics.

Automated browser QA does not submit a real prompt. Authorized, low-volume live
generation/download checks remain documented release work in
`RECOVERY_PARITY.md`.
