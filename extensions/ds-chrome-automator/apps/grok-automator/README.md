# Grok Automator™

Maintainable WXT, Vue 3, and strict TypeScript source reconstructed from the
signed Grok Automation `2.6.3` Chrome extension. Grok Automator™ `0.0.13` no
longer runs the decompiled bundles: the background worker, content automation,
side panel, protocols, storage, tests, and release tooling are editable source
modules.

The installed artifact was a Vite/Rollup Manifest V3 extension, not a compiled
Node executable. Superseded compiled distributions, recovery-tool output, and
decompiled reference trees were removed when this clean source became the
`apps/grok-automator` workspace of the Paks Tools Faceless automations
monorepo.

Install and run commands from the [monorepo root](../../README.md). Do not create
a workspace-local lockfile or `node_modules` installation.

## Prerequisites

- Node.js 24 (see `.nvmrc`; WXT requires Node 22 or newer)
- npm 11 or another lockfile-compatible npm version
- Chrome for Testing or Chromium for automated smoke testing; regular Chrome
  for manual **Load unpacked** testing

## Start development

```powershell
npm ci
npm run dev
```

WXT prints the development output path. Load it through
`chrome://extensions` → **Developer mode** → **Load unpacked**, open
`https://grok.com/imagine`, and click the extension action.

The side panel's **User Guide** action always opens the canonical, dynamically
managed [Grok Automator manual](https://paks-tools.vercel.app/guide/grok-automator).
This documentation URL is intentionally independent of local authentication and
community-site overrides, so users always reach the maintained production
manual.

The checked-in non-secret defaults target the live Vercel web and API
origins. To test against another owned environment, set
`WXT_PLATFORM_WEB_ORIGIN` and `WXT_PLATFORM_API_ORIGIN` as process variables
before starting WXT; each value must be an origin only, without a path, query,
credentials, or fragment. Production accepts HTTPS only. Development also
permits exact `http://localhost`, loopback, or RFC1918/private-LAN IP origins;
it never permits public HTTP hosts or wildcard subnet origins.

Do not place Google, Stripe, database, Blob, signing, administrator, or webhook
secrets in a `WXT_` variable or any local extension file. The recommended real
integration loop is a local unpacked extension calling the exact Vercel API.

Common commands:

| Command                                                     | Purpose                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                                               | WXT development server with reload support                   |
| `npm run check`                                             | Types, lint, app/tooling tests, boundaries and source scan   |
| `npm run generate:version-badge`                            | Regenerate the committed local badge from `package.json`     |
| `npm run check:version-badge`                               | Reject a missing, modified, or stale local version badge     |
| `npm run verify`                                            | Full check plus production build and output hardening        |
| `npm run format`                                            | Format active source and tooling                             |
| `npm run zip`                                               | Create the Chrome release ZIP                                |
| `npm run verify:zip`                                        | Compare ZIP bytes/tree/version with the final unpacked build |
| `npm run smoke:grok -- "C:\path\to\chrome-for-testing.exe"` | Disposable-profile side-panel smoke test                     |

## Source architecture

```text
entrypoints/
├─ background.ts              # side panel, selectors, zoom and downloads
├─ content.ts                 # thin Grok content-script entry
└─ sidepanel/
   ├─ index.html
   └─ main.ts                 # Vue bootstrap

src/
├─ background/                # IndexedDB staging, download completion and safe paths
├─ config/                    # selector snapshot, origins and deployment defaults
├─ content/                   # typed DOM automation, queues, retries, downloads
│  └─ dom/                    # selector adapter, waits, interaction lock
├─ protocol/                  # Zod schemas and cross-context wire contracts
├─ security/                  # bounded JSON/image data and generated-media policy
└─ sidepanel/
   ├─ components/             # control, queue, settings, logs and modals
   ├─ App.vue                 # five-mode application shell
   ├─ auth.ts                 # Google-only PKCE flow and session controller
   ├─ auth-session.ts         # bounded application session storage
   ├─ run-auth-gate.ts        # hold/resume-once Run authorization boundary
   ├─ usage-authorization.ts  # reserve/accept/finalize/rollback usage client
   ├─ usage-contract.ts       # runtime-validated usage wire contract
   ├─ prompt-builder.ts       # prompt/image assignment and concat behavior
   ├─ protocol.ts             # panel/content transport and image chunking
   ├─ runtime-state.ts        # status, progress and capped logs
   ├─ spreadsheet-import.ts   # bounded local CSV/XLS/XLSX prompt extraction
   ├─ settings.ts             # defaults and five recovered migrations
   └─ storage.ts              # centralized WXT storage

tests/                        # app and release-tool tests
scripts/                      # boundary, security, build, ZIP and browser gates
```

The active code intentionally retains the original raw Chrome message envelope
because the installed release used it. All sends and listeners are centralized
and schema-validated; changing to an envelope-based messaging library would be
a protocol migration, not a drop-in refactor.

## Runtime flow

```text
Vue side panel
  ├─ validates settings, files and the exact platform origin
  ├─ prepares large images in <= 1 MiB chunks
  ├─ obtains or restores a short-lived application session
  ├─ reserves `automation.run` units with a stable local acceptance ID
  ├─ tentatively accepts the reservation and durably blocks the exact group
  ├─ finalizes server usage, then releases the matching local stage
  └─ rolls back an uncommitted acceptance or recovers the same IDs
          ↓
Typed content script
  ├─ validates every message and selector configuration
  ├─ queues prompts, retries and cancellations
  ├─ drives the Grok Imagine DOM
  └─ reports PROMPT_GROUP_STATUS / progress / logs
          ↓
MV3 background worker
  ├─ returns the local validated selector snapshot
  ├─ owns the bounded extension-origin IndexedDB prompt-stage store
  ├─ persists download naming preferences
  └─ performs and terminally confirms browser downloads
```

`AUTO_FILL_GROK` acknowledges a bounded staged group but does not make it
runnable. After tentative server acceptance, `COMMIT_PROMPT_GROUP` presents the
same acceptance ID and transfers the schema-valid, deduplicated group to a
bounded extension-origin IndexedDB blocked stage. Only a successful server
`/finalize` permits idempotent `RELEASE_PROMPT_GROUP`; immediately before the
first automation call, the worker atomically replaces the released payload with
a claimed receipt. A pre-start content reload can therefore rehydrate the exact
released group, while a reload after execution starts is surfaced as
interrupted and is never auto-replayed. Terminal completion or cancellation
deletes the durable record. A separate bounded IDs-only session receipt
reconciles side-panel restarts and ambiguous API responses without bearer
credentials.

## Permission and network map

| Permission / host                               | Feature                                                        | Removable with feature? |
| ----------------------------------------------- | -------------------------------------------------------------- | ----------------------- |
| `storage`                                       | Settings, locale, daily history, app session and downloads     | Yes                     |
| `tabs`                                          | Detect/focus Grok tabs, open Google auth, refresh and zoom     | Yes                     |
| `downloads`                                     | Save generated images/videos with organized names              | Yes                     |
| `sidePanel`                                     | Generated by WXT for the side-panel entrypoint                 | Yes                     |
| `https://grok.com/*`, `https://*.grok.com/*`    | HTTPS-only Grok automation and generated media                 | Yes                     |
| `https://imgen.x.ai/*`, `https://vidgen.x.ai/*` | Grok's ephemeral generated-image and generated-video resources | Yes                     |
| `https://paks-api.vercel.app/*`                 | Auth flow, session exchange and Run authorization              | Yes                     |

Google is the only supported sign-in provider. Pressing **Run** while signed out
does not queue automation: the validated payload is held in memory and a sign-in
modal appears. The production defaults use the interim PAKS web and API Vercel
origins. The extension creates a PKCE S256 flow at
`POST /v1/auth/extension-flows`, opens only the returned owned
`/auth/extension/<flow-id>` page, displays the API-issued verification code only
inside the sign-in modal, and polls the one-time v2 exchange route. The code is
never added to a URL or diagnostic log.
A narrowly gated compatibility retry sends the exact v1 request only when an
otherwise valid v2 request receives the old server's explicit
protocol-unavailable response. Network, authentication, rate-limit, malformed,
and server failures never cause a downgrade. The legacy path is temporary
through the platform's `2026-11-30T00:00:00Z` sunset.
A successful exchange stores only a short-lived Paks Tools Faceless automations
application token and verified session in `chrome.storage.session`, then resumes
the pending run exactly once. The side panel projects only the validated account display
name/email and the session-resolved Free, Grok Automator™, or All Apps plan from
that session; it does not make a second profile request or expose the application
token in the UI. Google tokens, authorization codes, the PKCE verifier, and a
client secret are never persisted or returned to the extension. An unavailable
or unconfigured backend, invalid flow, cancellation, or timeout fails closed and
Run remains stopped.
Former email and token storage keys are removed during panel startup.

After authentication, each Run calls
`POST /v1/apps/grok-automator/usage/reservations` with the app ID, fixed
`automation.run` operation, requested prompt units, a fresh acceptance/idempotency
key, and the short-lived application bearer token. Identical retries reuse that
key. The client stages the matching group without starting it, tentatively
accepts the reservation at `/<authorization-id>/consume`, durably commits and
queries the same blocked local group, then calls `/<authorization-id>/finalize`
and releases only a confirmed consumed acceptance.
Missing local state calls acceptance-bound `/rollback`; a never-accepted
reservation uses `/cancel`. Ambiguous responses are reconciled from a bounded,
IDs-only session receipt, and the UI tells the user not to submit a duplicate
Run while finalization is pending. The temporary v1 fallback durably blocks the
group first, performs the legacy immediate authorization, and releases only an
allowed result.
A missing entitlement, exhausted quota, disabled app/operation, or expired
session cannot authorize a new group. Pre-commit malformed, timeout, or network
failures leave the group inert/cancelled; post-commit ambiguity is reconciled
instead of inviting a duplicate Run. The local daily counter is display/history
state only and cannot authorize a Run.

Settings and daily counters stay on-device. Image inputs are count-, MIME-,
per-file-, and aggregate-byte-bounded before FileReader allocation. XLSX ZIP
metadata is preflighted before SheetJS parsing, and every supported spreadsheet
is bounded by sheets, ranges, cells, and text before the serializable prompt
model is built. DOM media and download messages
accept only exact HTTPS Grok/XAI media origins, bounded base64 raster images, or
blob URLs backed by those origins. Media frame fetches omit credentials, reject
redirects and mismatched final URLs/types, and cap bytes, deadlines, duration,
dimensions, and pixels. Downloads are keyed by browser download ID and count as
successful only after Chrome reports terminal completion. Deadline handling
rechecks the exact ID, confirms cancellation, and disables retry when the
outcome is ambiguous or Chrome reports a user/policy/file interruption. Partial retries use
stable resource descriptors and include only failed indexes, without repeating
generation or completed downloads. There
is no analytics implementation and no Meta Dataset/Pixel.
See [`PRIVACY.md`](PRIVACY.md) for the source-backed data-flow disclosure and the
publisher decisions that must be completed before Chrome Web Store submission.

## Typography and production hardening

The side panel imports the shared `@faceless-automations/brand/styles.css` entry:

- Instrument Serif for display and narrative headings;
- Manrope for body copy, controls and navigation; and
- IBM Plex Mono for metadata, status labels and tabular numbers.

The extension-owned interface applies the SYS001X dark theme: black and
charcoal surfaces, white and muted-white text, and restrained gold `#D4AF37`
with deep-gold `#B8860B` for primary actions, focus, active navigation, badges
and key metrics. Solid gold controls always use black text; destructive and
error states retain semantic red styling.

Fontsource WOFF2 assets and `THIRD_PARTY_NOTICES.md` are bundled into the
extension. No remote font stylesheet or runtime font asset is allowed. The build
verifier requires all eight licensed face/weight files, their semantic display,
body and metadata roles, the SYS001X production palette, the notice file and a
hashed JavaScript chunk.

WXT `0.21.4` retains its generated Rollup chunk layout. JavaScript uses Terser
compression and mangling, drops console/debugger output, preserves the legal
banner in every chunk and emits no source maps. CSS minification explicitly uses
esbuild. Property mangling and custom `manualChunks` are intentionally not used
because storage/message fields and WXT's IIFE content-script boundary must remain
stable.

## Central application footer

One application-level footer follows the active Control, Setting, or Debug Logs
view. It displays the exact legal stamp
`© 2026 PAKS LLC. ALL RIGHTS RESERVED.` and a version badge whose message
must equal the extension's `package.json` version.

The badge is rendered during development by the official Shields
`badge-maker` package and committed as `public/badges/version.svg`. It is a
static extension-owned asset: the side panel never requests `img.shields.io`, a
remote stylesheet, or another runtime badge resource. `npm run check` compares
the committed SVG with deterministic output for the current package version.
Production and ZIP verifiers also require the exact badge, footer text, bundled
license notice, and `img-src 'self' data:` extension-page CSP while rejecting
remote image references. The narrow `data:` allowance preserves the existing
validated, on-device upload previews; the footer badge itself must load from
the extension origin.

## Recovery status and limits

Implemented as clean source:

- all five modes: text/image/components to video and text/image to image;
- screenshot-matched control, settings, queue, debug and first-use interfaces;
- TXT, CSV, XLS and XLSX prompt import with local sheet/column preview;
- per-prompt options, prompt ranges, concat sequencing, image sorting,
  filename matching, assignment and 1 MiB chunk transport;
- owner-tab queue state and cancellation, session replay, retries, progress,
  correlated-result downloads and debug logs;
- exact settings defaults plus migrations and corrected reset behavior;
- fail-closed central Google PKCE/session exchange, server-authoritative Run
  authorization, local daily history, update and tip modals;
- a selector adapter for the archived jQuery-style selector dialect;
- MV3-safe storage, strict schemas, CI and deterministic release gates.

Known development gaps:

- **Central auth release status:** the configured Google-only callback and a
  fresh registered-extension PKCE connection/exchange passed against the live
  PAKS Vercel origins. The extension renders the verified connected account and
  exact session-resolved plan locally. Final installed-extension regression,
  entitlement, revocation, and Chrome Web Store evidence remain separate gates.
- **Commerce release blocker:** the API can resolve a direct
  `extension:grok-automator` or `bundle:all-extensions` entitlement before Run,
  but Stripe Products/Prices, verified provider journey, webhook fulfillment,
  entitlement lifecycle/reconciliation, and customer purchase routes are not
  complete. Authentication alone never grants automation.
- **Purchase recovery gap:** an authenticated entitlement denial is shown as a
  local status message; the exact individual-license and All Apps purchase
  actions on the owned dashboard have not yet been wired into the extension.
- English is the only locale exposed by the active UI. The exact recovered
  20-locale contract is preserved and mapped in
  `src/sidepanel/I18N_RECOVERY.md`, but its catalogs have not yet been
  semantically migrated.
- No live prompt generation, paid authorization, or real resource download was
  performed during automated preparation. Grok DOM
  selectors can drift and require a low-volume authorized smoke test.
- Original comments, local identifiers, discarded TypeScript types and
  tree-shaken code cannot be restored without the missing source maps/backups.

The clean source retains only the behavior and contracts needed for continued
development; the former compiled and decompiler artifacts are intentionally not
part of this repository.

See [`RECOVERY_PARITY.md`](RECOVERY_PARITY.md) for the control-to-source map,
mode-specific image rules, runtime wiring, and the exact owner-run live checks
that remain.

## Release and Chrome debugging

```powershell
npm run verify
npm run zip
npm run verify:zip
```

The production unpacked directory is
`apps/grok-automator/.output/chrome-mv3`. In Chrome, inspect:

- **Service worker:** `chrome://extensions` → this extension → Service worker
- **Side panel:** right-click inside the panel → Inspect
- **Content script:** Grok tab DevTools → Sources/Console, isolated context

Before a Chrome Web Store upload, also run the authorized live Grok checks,
review data-use disclosures for the final central auth flow, confirm selector currency,
and verify the exact ZIP version/hash. This repository has no configured store
credentials or automated submission; packaging does not publish anything.

The source manifest intentionally omits a public signing key. Chrome therefore
assigns an unpacked development ID instead of retaining the recovered extension
ID. Treat that ID and its storage namespace as disposable until the owner adds
the intended public key or creates the final Chrome Web Store item. Version
`0.0.1` is the first version of that new identity; it cannot be submitted as an
update to the former Web Store item because store updates must increase the
existing item's version.

For automated smoke testing, use Chrome for Testing or Chromium. Chrome 137 and
newer removed support for the `--load-extension` flag from the regular branded
browser; manual loading from `chrome://extensions` remains the local test path.
To capture reusable 536×890 visual-QA states with the same assertion-backed raw
DevTools smoke session, run:

```powershell
npm run smoke:grok -- "C:\path\to\chrome-for-testing.exe" --capture-dir ".artifacts\grok-smoke"
```

The JSON result lists the absolute PNG paths for the fresh tips modal, control
top and bottom, settings top and bottom, Debug Logs, and the signed-out Run gate.
The Run-gate state asserts that the Google-only dialog is open, the application
shell is inert, and no automation group was queued. Capture mode opens and
focuses a disposable Grok Imagine tab first; if the network is unavailable, its
JSON reports the fallback and retains the offline warning.
