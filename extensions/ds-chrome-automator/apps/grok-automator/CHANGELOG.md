# Changelog

## 0.0.13 - 2026-08-20

- Pinned the side-panel **User Guide** action to the canonical dynamic manual at
  `https://paks-tools.vercel.app/guide/grok-automator`, independent of local
  platform-origin overrides.
- Added regression coverage for the exact managed-document URL and header
  wiring without adding a host permission, remote executable content, or a new
  network data flow.
- Synced the exact shared platform-contract dependency to `0.1.2` for the
  coordinated guide-CMS/API release; the extension continues to import only its
  existing auth and usage schemas.
- Advanced the bundled selector compatibility version and locally generated
  release badge to `0.0.13`; the selector set itself is unchanged.

## 0.0.12 - 2026-08-20

- Upgraded extension authentication and paid Run authorization to strict v2
  PKCE/user-code negotiation and the exact reserve → tentative accept
  (`/consume`) → durable blocked local commit/query → `/finalize` → idempotent
  release lifecycle, with `/rollback` for a missing local stage and `/cancel`
  before acceptance. A bounded extension-origin IndexedDB stage restores exact
  pre-start work after content reload, atomically becomes an IDs-only claimed
  receipt before automation, and never replays an interrupted started batch. A
  separate schema-validated session receipt reconciles ambiguous API responses
  and side-panel reloads without bearer credentials.
- Preserved compatibility with the temporary strict v1 auth and legacy usage
  APIs through narrowly gated protocol fallback; malformed, network, auth,
  validation, rate-limit, and server errors do not trigger a downgrade.
- Added streaming byte-bounded JSON readers and request deadlines, exact-session
  cancellation rollback, bounded image transfer concurrency/chunks, pre-read
  upload limits, XLSX central-directory expansion preflight, and workbook
  sheet/range/cell/text limits.
- Bounded generated-video fetch, decode duration, dimensions, pixels, and bytes;
  downloads now wait for terminal browser completion, keep same-URL filenames
  isolated by download ID, and retry only failed stable resources without
  regenerating prompts or repeating completed downloads. Deadline cancellation
  is ID-rechecked and terminally confirmed; ambiguous, user-cancelled, policy,
  and file interruptions cannot start an automatic second download.
- Added regression coverage for each boundary, advanced the selector snapshot,
  and regenerated the packaged version badge without changing MV3 permissions,
  WXT/Vue architecture, or executable-code policy.

## 0.0.11 - 2026-08-19

- Renamed the active platform display copy to the exact **Paks Tools Faceless
  automations** brand across the side-panel header, community link, portal,
  Google sign-in, session, license, and support surfaces.
- Updated current package metadata, environment guidance, README, privacy
  disclosure, third-party notice, and copy assertions without changing the
  stable package scopes, storage keys, application IDs, paths, or service URLs.
- Advanced the bundled selector snapshot and locally generated version badge to
  `0.0.11`; prior changelog and visual-audit evidence remains unchanged.

## 0.0.10 - 2026-08-17

- Projected the verified Google account display name/email and exact
  session-resolved `free-plan`, `single-license`, or `all-apps` plan into the
  central plan banner immediately after connection and session restoration.
- Replaced the signed-in sign-in prompt with connected-account copy while
  retaining Google as the only authentication provider and keeping every tool
  visible behind the existing server-authorized Run boundary.
- Kept account presentation local to the validated short-lived application
  session: no provider token, new API request, remote avatar, permission,
  browser-side secret, or additional persistent account-data copy was added.
- Advanced the bundled selector snapshot and locally generated Shields version
  badge to `0.0.10`; final CI, browser capture, and ZIP evidence remain release
  gates rather than pre-claimed outcomes.

## 0.0.9 - 2026-08-17

- Migrated the production central-auth page to `https://paks-tools.vercel.app` and
  the exact extension API host permission to `https://paks-api.vercel.app/*`.
- Kept localhost, loopback, and explicit private-LAN development overrides
  unchanged while continuing to reject wildcard or insecure production
  origins.
- Advanced the local selector snapshot and Shields release badge to `0.0.9`;
  no Chrome identity key, new broad permission, remote executable code, or
  browser-side secret was introduced.

## 0.0.8 - 2026-08-17

- Replaced the active legal-owner signature with **PAKS LLC** in the central
  footer, every emitted JavaScript banner, release verifier, browser smoke
  contract, and repository-specific WXT policy.
- Added a production regression that rejects the prior publisher signature in
  generated artifacts while preserving the `0.0.7` changelog and audit record
  as immutable historical evidence.
- Regenerated the local Shields version badge for `0.0.8`; no hosted badge,
  remote image, or additional runtime permission was introduced.

## 0.0.7 - 2026-08-16

- Added one application-level footer after the Control, Setting, and Debug Logs
  views so the same release identity remains visible throughout the side panel.
- Stamped the footer with the exact copyright notice
  `© 2026 CHRÌS DIGÌTÀLS. ALL RIGHTS RESERVED.` and a package-version-matched
  Shields badge generated locally with the official `badge-maker` package.
- Committed the generated SVG as an extension asset and added a deterministic
  generate/check workflow; the side panel never calls `img.shields.io` or
  another badge service at runtime.
- Tightened the extension-page image CSP to extension assets plus validated
  local data-image previews, and expanded source, production-build, ZIP, and
  browser checks for a stale badge, missing legal stamp, remote image reference,
  or absent footer.

## 0.0.6 - 2026-08-16

- Renamed the complete customer-facing extension identity to **Grok
  Automator™** while preserving the stable `grok-automator` machine ID, API
  routes, entitlement codes, storage keys, and release filename.
- Replaced the extension, toolbar action, and side-panel artwork with the
  owner-provided transparent 16, 32, 48, and 128 pixel PNG set.
- Strengthened production verification to require the exact manifest/action
  title, explicit action icons, canonical icon paths, PNG headers, and exact
  dimensions before the unpacked build or deterministic ZIP can pass.
- Aligned the central extension-auth display contract and dashboard copy with
  the new product name. Google OAuth provider configuration and a live licensed
  journey remain separate pending gates.

## 0.0.5 - 2026-08-16

- Added a server-authoritative authorization request for every **Run**. The
  extension sends only the app ID, `automation.run` operation, requested prompt
  units, an idempotency key, and the short-lived Faceless application token to
  the exact owned API; no prompt text, images, Grok page content, or Google
  credentials are included.
- Kept every tool and composer control visible while refusing to queue a prompt
  group unless the API returns a schema-valid allowance for the requested app,
  operation, and unit count. Missing/expired sessions, entitlement denial,
  quota denial, disabled capabilities, malformed responses, timeouts, and
  network errors all fail closed.
- Defaulted the public web and API configuration to the reserved Faceless
  Automations Vercel origins and added only the exact HTTPS API host permission
  to production builds. Development overrides permit exact localhost,
  loopback, and private-LAN HTTP origins only in non-production mode.
- Removed the editable local free-run limit from the Run decision. The local
  daily counter remains display/history state and cannot grant access.
- Expanded contract-parity, authorization-client, origin-policy, manifest-host,
  and side-panel wiring tests for the extension/API boundary.
- Updated release, permission, privacy, and visual-QA documentation for the new
  authorization flow. The owned Vercel scaffold and migration `0002` are now
  live, while Google SSO, paid entitlement, Grok generation, final ZIP, and
  Chrome Web Store submission remain separate pending gates.

## 0.0.4 - 2026-08-15

- Replaced the complete side-panel icon system with statically imported
  `@tabler/icons-vue` components and shipped the exact Tabler MIT license,
  preserving the reviewed icon geometry and accessible labels.
- Kept every automation tool visible while gating **Run** behind a valid
  Faceless Automations session. Signed-out payloads are held without queueing,
  Google sign-in is requested, and a successful session resumes the pending run
  exactly once; cancellation leaves automation stopped.
- Added a fail-closed Google-only PKCE extension-flow client for the future
  central platform API. It validates owned flow URLs and bounded responses,
  stores only a short-lived application token/session in extension session
  storage, and never receives or stores Google tokens, codes, or client secrets.
- Added an optional build-time API host permission derived from the validated
  `WXT_PLATFORM_API_ORIGIN`; the default build requests no central-auth host.
- Expanded auth, Run-gate, icon-policy, license, and production-artifact tests.

## 0.0.3 - 2026-08-15

- Replaced the screenshot-era mint, blue and green accents with the restrained
  SYS001X gold, deep-gold, charcoal, black, white and grayscale dark theme while
  preserving the rebuilt side-panel geometry and interaction states.
- Applied Instrument Serif to product and narrative display headings, Manrope
  to body text, controls and navigation, and IBM Plex Mono to metadata, status
  labels and tabular numbers using the existing locally bundled WOFF2 assets.
- Strengthened production verification to reject the former color tokens,
  require semantic SYS001X color/font roles, and prove all eight expected local
  font faces are referenced with no orphaned font files.

## 0.0.2 - 2026-08-14

- Rebuilt the side panel against the supplied `2.6.3` reference screenshots,
  restoring the compact control, settings, queue, debug and first-use states
  with locally bundled Lucide icons and the required Faceless Automations
  typography.
- Restored TXT, CSV, XLS and XLSX prompt import, per-prompt duration/image
  options, prompt ranges, image sorting/reordering, filename-based character
  matching, concurrency, random delay, output/folder controls and queue actions.
- Corrected range-before-concat planning and recovered image-assignment rules
  for Frame to Video, Ingredients to Video and Image to Image.
- Bound groups and cancellation to the originating Grok tab, replayed queue and
  debug state from session storage, and prevented another tab's reset from
  clearing unrelated groups.
- Correlated each submission with its newly generated result article and made
  upload, generation, upscale and download failures propagate through bounded
  retries instead of reporting false completion.
- Added local SheetJS `0.20.3` parsing as a lazy production chunk, Lucide and
  SheetJS license notices, strict settings validation, and expanded app tests.
- Kept the new extension identity keyless and retained WXT/Terser production
  minification, hashed chunks, local WOFF2 fonts and deterministic ZIP checks.

## 0.0.1 - 2026-08-14

- Reset the maintainable extension's version line to `0.0.1` for its new
  Faceless Automations identity.
- Removed the recovered manifest public key so Chrome assigns a new unpacked
  extension ID until the owner supplies the intended key later.
- Updated browser smoke testing and release verification to discover the
  assigned ID dynamically and reject any accidentally bundled manifest key.

## 2.7.1 - 2026-08-14

- Removed the inherited publisher identity, authentication host permission,
  install welcome navigation, pricing route, guide link, and bug-report link.
- Removed the unverified email login and plan-check requests. The extension now
  purges former auth values and stays signed out in free mode.
- Added fail-closed Google-only platform readiness: a validated optional
  `WXT_PLATFORM_WEB_ORIGIN` opens `/auth?client=grok-automator`; an absent or
  invalid origin opens nothing and shows a clear message.
- Adopted the shared Faceless Automations typography package with locally bundled
  Instrument Serif, Manrope, and IBM Plex Mono WOFF2 assets and license notices.
- Kept WXT's hashed Rollup chunking, Terser compression/mangling, legal banners,
  and disabled source maps; made esbuild CSS minification explicit.
- Extended source/output scans and production verification to reject remote font
  CSS/assets and legacy publisher strings, and to require hashed WOFF2 assets,
  `THIRD_PARTY_NOTICES.md`, and at least one hashed JavaScript chunk.
- Added tests for platform-origin validation, central auth launch readiness,
  former auth-data cleanup, remote-font detection, and release typography gates.

## 2.7.0 - 2026-08-14

- Adopted as `apps/grok-automator` in the private Faceless Automations monorepo;
  product behavior and extension version remain unchanged.
- Removed superseded compiled distributions, decompiler output, and recovery
  tool artifacts after their required behavior was migrated to clean source.
- Restricted Grok execution to HTTPS and generated-resource handling to exact
  Grok subdomains, the documented `imgen.x.ai`/`vidgen.x.ai` ephemeral hosts,
  bounded base64 raster images, and origin-validated blob URLs.
- Added a background sender trust gate for the extension's top-frame content
  script, removed the redundant `activeTab` permission, omitted credentials from
  media fetches, and removed email addresses from pricing URLs.
- Documented the two backend release blockers: proof of email ownership before
  token issuance and a server-authoritative quota/capability boundary.
- Replaced the runtime side-panel bundle with maintainable Vue 3 SFCs and local CSS.
- Rewrote the recovered content application as strict TypeScript modules with a
  native adapter for the archived selector dialect; active code no longer loads
  jQuery or any forensic/recovered module.
- Added Zod-validated message, selector, storage, network, file, and DOM data
  boundaries while preserving the installed raw Chrome wire protocol.
- Restored all five modes, prompt/image assignment, 1 MiB image chunks, queue
  status, cancellation, retry/download state, settings migrations, auth/plan,
  daily usage, progress, debug logs, and modals.
- Centralized WXT storage, moved auth tokens to session storage, made download
  preferences service-worker durable, and sanitized download paths/URLs.
- Added source-boundary, security, build, deterministic ZIP, CI, and disposable
  Chromium smoke-test tooling.
- Expanded automated coverage to 45 app tests and 13 release-tool tests.
- Documented the remaining 20-locale catalog and spreadsheet-import migrations.
- Kept untranslated locales out of the active selector while retaining the
  recovered locale contract and deterministic language/direction initialization.
- Added a repository privacy/data-flow disclosure plus cross-platform Git
  line-ending and binary-file rules for a clean development baseline.

## 2.6.4 - 2026-08-14

- Recovered a buildable WXT/Vue Manifest V3 project from the signed 2.6.3 distribution.
- Reconstructed the background worker with semantic names and validated messages.
- Archived and embedded the 38 live Grok DOM selectors that were previously fetched remotely.
- Established behavior maps used to complete the clean 2.7.0 source rewrite.
