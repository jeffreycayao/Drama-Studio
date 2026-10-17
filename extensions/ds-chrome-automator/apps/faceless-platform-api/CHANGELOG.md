# Changelog

All notable changes to the Paks Tools Faceless automations API are recorded here.

## 0.2.6 - 2026-08-20

### Added

- Added public published-guide reads and authenticated, CSRF-protected admin
  list/read/create/update routes for current and future tool manuals.
- Added migration `0005_guide_cms` with a published Grok Automator guide seed,
  current structured documents, append-only revision snapshots, and immutable
  create/update audit events.
- Added server-only Google admin bootstrap. Exact normalized, verified emails
  are read from `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` only during the callback and
  atomically bound once to issuer, stable subject, and user. Later access uses
  only the persisted subject binding or the optional legacy subject env.

### Security

- Guide bodies accept no raw HTML or executable embed; bounded structured
  blocks and safe HTTPS/same-origin links are validated by shared contracts.
- Unique email, subject, and user constraints prevent a different Google
  identity from replacing an existing administrator. Bootstrap failures deny
  admin status without denying an otherwise valid Google login, and user bans
  revoke effective admin access through the normal active-session gate.
- Guide writes use optimistic revision checks and atomically persist the
  current document, recoverable snapshot, and audit event.

### Verification

- Added contract, public/draft projection, CSRF, create/conflict, near-limit
  body, migration, transaction-shape, callback bootstrap, collision, and
  persisted-subject tests. No deployment, Vercel secret write, production
  migration, or provider mutation is claimed by this source release.

## 0.2.5 - 2026-08-20

### Security

- Added versioned extension initiator verification with an independent
  eight-character user code and five-attempt terminal lock. A v2 Google callback
  now binds its verified user to a still-pending flow; only that exact web
  session with derived CSRF and the code can atomically authorize it. Existing
  PKCE, state, nonce, expiry, and one-time exchange controls remain.
- Serialized extension OAuth allocation now permits only one Google attempt per
  extension flow. Callback completion distinguishes a new binding from an
  already-bound or unavailable flow, and cancellation/error denial can mutate
  only an unbound pending v2 flow. A competing identity can no longer deny or
  replace the first valid binding; legacy v1 denial behavior remains intact.
- Added database-backed fixed-window limits for flow allocation, verification,
  polling, OAuth allocation, and exchange. Keys are server-keyed digests of
  bounded route context rather than stored IP addresses. Ordered advisory
  locks make layered bucket consumption all-or-none, and advisory-lock
  transactions enforce concurrent-flow caps.
- Replaced one-step Run authorization with reserve, tentative consume, finalize,
  rollback, and cancel operations. Tentative acceptances remain refundable until
  local commit/query confirmation, while finalize and rollback are mutually
  exclusive, acceptance-bound, append-only audited, and idempotent. Quota
  evaluation now takes its advisory lock in a separate transaction statement
  before a fresh database snapshot; active reservations, tentative acceptances,
  and consumed units count, while cancelled, rolled-back, or expired
  reservations do not.
- Added daily idempotent retention for terminal/expired OAuth and extension
  flows, usage reservations, obsolete sessions, and expired rate buckets.

### Changed

- Audit pagination now orders by `created_at DESC, id DESC` and returns a
  signed opaque cursor carrying that exact tuple.
- `/health/ready` now fails closed unless the latest `schema_migrations`
  version exactly matches the current source migration, without exposing which
  dependency failed.
- The LAN development server and Vercel entry point now share the same bounded
  Node request reader and scrub caller-supplied internal address headers.
- Advanced the schema to `0004_security_lifecycle`; the authenticated daily
  migration invocation also runs bounded retention maintenance.

### Compatibility

- Through the exclusive `2026-11-30T00:00:00.000Z` sunset, v1 flows created
  without `schemaVersion` retain their exact create/status/verifier-only exchange
  shapes and deprecation headers. Persisted protocol markers reject cross-version
  bodies; v2 always retains the bound-session verification gate.
- Restored legacy `/usage/authorize` during that same window as an atomic
  reserve-plus-immediate-consume operation under the original idempotency key.
  V2 clients use tentative consume, then finalize or rollback.

### Verification

- Added contract, transaction-shape, rate-key, user-code lockout, retention,
  audit-cursor, readiness-parity, lifecycle, and bounded-request regressions.
- No deployment, production migration, secret access, or live provider action
  is claimed by this source-only release.

## 0.2.4 - 2026-08-19

### Changed

- Renamed the active backend service and default public SEO titles to
  `Paks Tools Faceless automations` while preserving technical package scopes,
  protocol identifiers, and immutable deployment history.
- Updated current API documentation and the no-secret local development label
  without rewriting the recorded Google Cloud project, OAuth client, or project
  ID values.

### Migration

- Added idempotent migration `0003_brand_rename` and its auditable SQL mirror.
  It upgrades only exact legacy `Faceless Automations` values in
  `seo.siteTitle` and `seo.openGraphTitle`, preserves unrelated and custom
  settings, increments the revision only when changed, and is safe to repeat.

### Verification

- Added no-secret source-level migration regression coverage for exact matching,
  one-time claiming, JSON preservation, revision behavior, and runtime/SQL copy
  alignment.
- Passed the API workspace CI with 8 test files and 30 tests, the source security
  scan, production TypeScript compilation, and verification of 38 emitted files.
  No deployment or production migration run is claimed by this source release.

## 0.2.3 - 2026-08-17

### Fixed

- Replaced the first-login Google session writable-CTE path with a sequential
  Neon transaction so a newly inserted user is visible before identity,
  session, and returned-account work continues.
- Redirected successful dashboard sign-in to the existing `/` route instead of
  the unimplemented `/dashboard` route.

### Diagnostics

- Added stage-coded callback failure logging that records only safe request and
  processing context, never Google codes, tokens, cookies, PKCE values, or
  provider subjects.

### Verification

- Passed the API workspace CI with 7 test files and 26 tests, including the
  contiguous SQL-placeholder regression.
- Deployed the clean production release as Ready deployment
  `dpl_5scMFAw976ScifQCAdZFLFCGRCKF`, immutable host
  `paks-bvz2tyxqn-atmt.vercel.app`, and stable alias
  `paks-api.vercel.app`.
- Verified a fresh registered-extension Google flow reached **Account
  connected**, exchanged its PKCE verifier once with `200 authorized`, returned
  an opaque access token without exposing Google material, and rejected replay
  with `409 auth_flow_consumed`.
- Verified successful dashboard OAuth returns to `/`. The user's original
  denied extension flow remains terminal and must be retried by starting a new
  request from the extension.

## 0.2.2 - 2026-08-17

### Changed

- Migrated the production project identity to `paks-api.vercel.app` and the
  browser-facing application/callback origin to `paks-tools.vercel.app`.
- Kept the extension API and browser gateway as separate network surfaces
  while requiring the Google callback to return through the same-origin
  dashboard gateway.
- Documented `paks.tools` and `api.paks.tools` as future custom-domain
  targets that remain inactive until ownership and DNS are verified.

## 0.2.1 - 2026-08-16

### Changed

- Updated the public `grok-automator` application display name to **Grok
  Automator™** for the central extension-auth surface without changing the app
  ID, route contract, entitlement identifiers, sessions, or authorization
  behavior.

## 0.2.0 - 2026-08-16

### Added

- Registered Chrome-extension authentication flows with Google-only central
  sign-in, extension-created PKCE S256 proof, clean dashboard redirects, and
  atomic one-time exchange.
- Separate 15-minute opaque app sessions hashed at rest and bound to the exact
  app and originating Chrome extension.
- Server-authoritative Grok Run preflight with current ban, session,
  entitlement, quota, idempotency, and short authorization-evidence checks.
- Safe central-page flow status endpoint and `0002_extension_platform` Neon
  migration for extension flows, app sessions, and usage decisions.
- Non-secret local extension registration override for exact CORS/contract
  reachability while all provider-backed local routes remain closed.
- Exact private-interface origin discovery for the explicitly LAN-bound
  no-secret development shell, without wildcard CORS.
- A development-only default registration for the current unpacked Grok
  Automator ID, with an exact environment override for changed local IDs.

### Security

- Neither redirect completion nor client claims grant an entitlement. Only
  active Neon grants for `extension:grok-automator` or
  `bundle:all-extensions` authorize a Run.
- Google tokens, authorization codes, provider subjects, PKCE verifiers, and
  server credentials are excluded from extension responses.

### Deployment checkpoint

- Deployed the production API scaffold to
  `https://faceless-automations-api.vercel.app` and applied Neon migrations
  through `0002_extension_platform`.
- Verified direct and same-origin gateway liveness plus platform settings at
  `200`, anonymous administration at `401`, and the intentional provider-closed
  readiness state at `503 not_ready`.
- Kept Google OAuth, authenticated administration, Stripe fulfillment,
  entitlements, private delivery, and Chrome Web Store outcomes explicitly
  outside this scaffold deployment result.

## 0.1.0 - 2026-08-16

### Added

- Deployable Node.js 24 Vercel Function workspace with strict TypeScript gates.
- Exact web, extension, localhost, and private-LAN CORS configuration.
- Server-owned Google authorization-code flow with state, nonce, PKCE, encrypted
  transient material, opaque sessions, token hashing, and secure cookies.
- Owner-subject admin authorization, derived CSRF protection, platform SEO/theme
  settings, user bans, session revocation, entitlement revocation, and audit log.
- Stripe-hosted Checkout scaffold using trusted server catalog entries and
  idempotent signed webhook intake.
- Lazy fail-closed Neon, Google, Stripe, and Private Blob adapters.
- Idempotent Vercel Cron migration runner that keeps `DATABASE_URL` in Vercel.
- No-secret local development server with opt-in LAN binding.
- Source security scan, strict tests, build verification, and deployment docs.

### Not active

- Stripe webhook fulfillment remains deliberately pending and cannot grant
  purchases or entitlements until its event-to-product policy is implemented.
- Google sign-in, checkout, authenticated administration, Blob delivery, and
  readiness remain closed until the remaining exact production Vercel values
  and audited provider journeys are complete.
