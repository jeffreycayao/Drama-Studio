# Changelog

All notable changes to the Paks Tools Faceless automations dashboard are documented here.

## [0.2.6] - 2026-08-20

- Added the route-split `/guide/:slug` public document surface with a generated
  section table of contents, accessible responsive typography, and explicit
  missing, unpublished, unavailable, and loading states.
- Added a protected guide CMS library plus generic create and revision-aware
  edit routes for Grok Automator and future tools. The editor provides metadata
  fields and repeatable, reorderable H2 sections with H3/H4 heading, paragraph,
  ordered/bullet list, callout, and link blocks instead of a raw JSON or markup
  field.
- Bound public, admin, create, and update payloads to the shared
  `@faceless-automations/platform-contracts` schemas, including unique anchors,
  text/control-character limits, safe same-origin or credential-free HTTPS
  links, maximum document sizes, and strict response validation.
- Required the existing verified Google administrator cookie and exact
  per-session CSRF token for creates and updates. Duplicate slugs and stale
  revisions preserve the local draft and fail clearly; accepted writes use the
  server-returned document and revision only.
- Kept guide rendering data-only through React text nodes and semantic elements;
  no raw HTML, Markdown injection, scripts, embeds, remote runtime assets, or
  browser-side secret/persistence fallback was added.

## [0.2.5] - 2026-08-20

- Added the extension-auth protocol v2 verification step: Google first binds
  the flow to a verified web session, then that same session and its CSRF token
  must submit the short code shown by the initiating Grok Automator™ instance.
  The code is normalized, sent only in the owned JSON request, and never placed
  in the OAuth URL. A missing or mismatched session fails closed.
- Kept exact protocol v1 status rendering during the bounded compatibility
  window while clearly identifying that deprecated flow to users.
- Hid stale connection state immediately when client-side navigation changes
  the flow ID, and remounted the verified-flow controller for the new request.
- Added opaque `nextCursor` support to the audit API client and an accessible
  **Load older activity** control that retains verified rows on later-page
  failure and renders events newest first.
- Hardened dashboard output verification against unintended server/API files.
  The guarded root Vercel release workflow additionally requires an empty
  dashboard Function inventory before promotion.

## [0.2.4] - 2026-08-19

- Renamed active dashboard branding, fallback metadata, authentication copy,
  administration messaging, and release notices to **Paks Tools Faceless
  automations**.
- Updated the brand lockup to use the `PT` monogram while preserving technical
  package, path, and API protocol identifiers.

## [0.2.3] - 2026-08-17

- Migrated the browser-visible production gateway to
  `https://paks-tools.vercel.app` and the server-side `/v1/*` plus `/health/*`
  rewrites to `https://paks-api.vercel.app`.
- Preserved the same-origin secure-cookie boundary and local no-secret
  development proxy instead of exposing API credentials to the React bundle.
- Recorded `https://paks.tools` as the future verified custom-domain target;
  it is not treated as live until it is purchased and attached in Vercel.

## [0.2.2] - 2026-08-16

- Aligned landing-page, extension-connection, accessibility, and validated API
  display copy with the exact **Grok Automator™** customer-facing identity.
- Kept the stable `grok-automator` application ID, extension-flow routes, and
  browser/API security boundaries unchanged.

## [0.2.1] - 2026-08-16

- Changed the browser-visible API origin to the dashboard's own stable Vercel
  origin and added `/v1/*` plus `/health/*` forwarding to the separate upstream
  API project.
- Preserved secure, HttpOnly, deliberate SameSite session cookies by keeping
  dashboard authentication and administration requests same-origin. No broad
  cross-site cookie exception, client token persistence, or secret-bearing
  public variable was added.
- Retained `https://faceless-automations-api.vercel.app` as the server Function
  and direct extension API origin rather than exposing it as the dashboard's
  browser session boundary.
- Added source and configuration coverage for the gateway origin and rewrites.
- Deployed the dashboard/gateway scaffold to its stable production alias and
  verified desktop/mobile landing, Google-only auth, protected admin, invalid
  extension flow, liveness, public settings, and anonymous denial states.
  Google OAuth, authenticated cookie/admin actions, Stripe entitlement
  fulfillment, and production readiness remain pending.

## [0.2.0] - 2026-08-16

- Added a route-protected administration console with overview, platform
  settings, user access, entitlement revocation, and audit-activity routes.
- Added the fail-closed `/auth/extension/:flowId` connection page for one-time
  Grok Automator Google SSO requests, including verified pending, authorized,
  denied, expired, and consumed states without exposing extension or provider
  credentials or implying a paid entitlement.
- Added strict response schemas, credentialed cookie requests, per-session CSRF
  enforcement, safe retry states, and fail-closed handling for missing,
  unauthorized, forbidden, unavailable, and malformed API responses.
- Added an audited public metadata and theme editor with six approved color
  tokens, 4.5:1 contrast validation, local bundled font-family selection, and a
  read-only live preview.
- Added user ban/restore and entitlement-revocation confirmation flows that
  require a server-recorded audit reason and never imply a Stripe refund.
- Added runtime application of server-validated page metadata and locally
  bundled theme values to the public dashboard.
- Added the reserved stable Vercel API URL as the non-secret default public origin,
  exact HTTPS/CSP binding, and development-only loopback/RFC1918 HTTP overrides
  with LAN-hosted Vite development.
- Expanded tests and production policy checks for administrator authorization,
  CSRF, hostile return paths, API-schema failure, local typography, accessible
  theme contrast, destructive actions, route coverage, secret exclusion, and
  network-origin validation.

## [0.1.1] - 2026-08-15

- Standardized generic interface symbols on statically named
  `@tabler/icons-react` imports while preserving their decorative-only
  accessibility semantics.
- Retained the local multicolor Google mark and decorative signal waveform as
  intentional brand and illustration assets.
- Added icon dependency, source-policy, rendered accessibility, license-notice,
  and production-output verification coverage.

## [0.1.0] - 2026-08-14

- Activated the reserved workspace as a React 19, Vite 8, strict TypeScript,
  and Tailwind CSS 4 application.
- Added the initial Faceless Automations landing page and Grok Automator preview.
- Added a Google-only central authentication shell that fails closed until a
  validated owned-backend origin is configured.
- Added locally bundled brand typography, route-level chunks, Terser
  minification, tests, linting, and production-output verification.
