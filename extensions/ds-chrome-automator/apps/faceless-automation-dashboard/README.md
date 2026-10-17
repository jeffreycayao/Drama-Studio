# Paks Tools Faceless automations Dashboard

TypeScript landing and authentication shell for the **Paks Tools Faceless
automations** application collection. The first active product preview is Grok Automator™.
The same application now owns the customer-facing landing surface and a
server-authorized administration console.

The current source release is `0.2.6`.

## Stack

- React 19 and React Router
- Tabler Icons React with static named imports for interface symbols
- Vite 8 with Terser minification and route-level chunks
- strict TypeScript
- Tailwind CSS 4
- Vitest and Testing Library
- locally bundled Instrument Serif, Manrope, and IBM Plex Mono from the shared
  `@faceless-automations/brand` workspace

No page loads remote scripts, stylesheets, fonts, or runtime assets.
Production hosting must emit the strict security headers mirrored by Vite's
local preview configuration, including the Content Security Policy. The
development server adds only the inline-script and WebSocket allowances needed
by Vite's local hot-module runtime.

## Icon policy

Generic interface symbols use statically named imports from the pinned
`@tabler/icons-react` dependency so the production bundle can tree-shake unused
icons. The multicolor Google provider mark and the decorative signal waveform
remain local SVG artwork because they are brand and illustration assets rather
than general-purpose interface icons. No icon font, CDN, or remote icon asset is
loaded at runtime.

## Routes

| Route                      | Purpose                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `/`                        | Paks Tools Faceless automations landing page and Grok Automator™ preview |
| `/auth`                    | Google-only central sign-in shell                                        |
| `/auth/extension/:id`      | One-time, server-verified extension connection                           |
| `/guide/:slug`             | Published, revisioned product guide with generated section navigation    |
| `/admin`                   | Verified platform overview                                               |
| `/admin/platform`          | Public metadata, approved color tokens, and bundled font roles           |
| `/admin/users`             | User search, ban, and restore controls                                   |
| `/admin/entitlements`      | Entitlement search and audited revocation                                |
| `/admin/guides`            | Managed guide library for current and future tools                       |
| `/admin/guides/new`        | Structured guide creation                                                |
| `/admin/guides/:slug/edit` | Revision-aware structured guide editor                                   |
| `/admin/audit`             | Server-recorded administrative activity                                  |

## Google sign-in boundary

The browser never receives a Google client secret. The non-secret default API
origin is the dashboard's live Vercel production origin:

```text
https://paks-tools.vercel.app
```

Browser requests use same-origin `/v1/*` and `/health/*` paths. The dashboard
Vercel project rewrites those paths to the separate upstream API:

```text
https://paks-api.vercel.app
```

This gateway keeps the secure application cookie first-party to the dashboard;
the browser does not fetch the upstream API cross-site and the cookie policy is
not weakened to support two unrelated `vercel.app` sites. Grok Automator™ still
calls the upstream API directly with its separate short-lived app token.

`VITE_PLATFORM_API_ORIGIN` identifies the browser-visible gateway origin, not
the upstream server Function. A local override is valid only when an exact
same-origin `/v1` proxy exists at that origin. A direct cross-origin override to
port 8787 cannot prove the production cookie journey and must not be reported as
successful Google/admin integration.

Vite listens on the local interfaces at strict port `5173` so another device on
the same private network can open the dashboard without silently shifting to an
origin that the API has not allowlisted. In development only, the validator permits an
exact `http://localhost`, loopback, `10.0.0.0/8`, `172.16.0.0/12`, or
`192.168.0.0/16` origin. It rejects public or ambiguous HTTP hosts. Production
accepts HTTPS origins only. Paths, credentials, queries, and fragments are
always rejected. The Content Security Policy adds only the normalized selected
origin to `connect-src`.

`VITE_PLATFORM_API_ORIGIN` is a public gateway location, not a credential. Do
not put Google, Stripe, database, session-signing, CSRF-signing, or other secret
values in a `VITE_` variable, local environment file, browser storage, or this
workspace. Provider secrets belong in Vercel's protected environment settings.

A configured sign-in redirects to:

```text
{VITE_PLATFORM_API_ORIGIN}/v1/auth/google/start?client=dashboard
```

The backend remains responsible for Google OAuth, callback validation, secure
session cookies, account linking, authorization, CSRF verification, and logout.

## Administration boundary

The `/admin` route renders no protected child route until
`GET /v1/admin/session` returns a strictly valid Google account with the
server-authored `admin` role and a per-session CSRF token. A `401` offers the
Google-only sign-in route. A `403`, network failure, missing origin, or malformed
response stays closed and exposes no cached administrative data.

The dashboard consumes these owned API endpoints:

| Endpoint                                             | Use                                         |
| ---------------------------------------------------- | ------------------------------------------- |
| `GET /v1/platform-settings`                          | Public validated metadata and theme         |
| `GET /v1/auth/extension-flows/:id`                   | Read the negotiated v1/v2 connection state  |
| `POST /v1/auth/extension-flows/:id/verify`           | CSRF-bound v2 extension-code verification   |
| `GET /v1/admin/session`                              | Administrator role and CSRF verification    |
| `GET /v1/admin/overview`                             | Verified platform counts                    |
| `GET /v1/guides/:slug`                               | Read a published structured product guide   |
| `GET /v1/admin/guides`                               | List draft and published guide records      |
| `POST /v1/admin/guides`                              | Create an audited revision-0 guide          |
| `GET`, `PUT /v1/admin/guides/:slug`                  | Read and revision-check a guide update      |
| `GET`, `PUT /v1/admin/platform-settings`             | Read and update revisioned public settings  |
| `GET /v1/admin/users`                                | Search the user directory                   |
| `POST /v1/admin/users/:id/ban`, `POST .../:id/unban` | Audited account access changes              |
| `GET /v1/admin/entitlements`                         | Search product access grants                |
| `POST /v1/admin/entitlements/:id/revoke`             | Audited entitlement revocation              |
| `GET /v1/admin/audit-events?cursor=...`              | Review newest-first administrative activity |

All requests parse strict Zod schemas. Cookie-authenticated mutations require
`X-Faceless-CSRF`, a reason where the action affects access, and a matching
server response. The UI never fabricates records or treats a failed API call as
success.

The one-time extension page exposes only the verified application name, flow
state, expiry, remaining verification attempts, and a same-session CSRF value
that is never rendered as content. Protocol v2 starts with Google so the server
can bind the flow to a verified web session. After the callback, that same
session must submit the short code displayed by the initiating Grok Automator™
instance; a missing or different session fails closed. The normalized code is
sent only in the owned JSON request and is never placed in the OAuth URL.
Authorized, denied, expired, and consumed states are re-read from the API. Exact
v1 rendering remains only for the deprecated installed-client compatibility
window through `2026-11-30T00:00:00Z`. The page never receives an extension ID,
PKCE challenge, Google token, provider subject, application token, or
entitlement, and an authorized sign-in never implies paid product access.

Audit activity consumes the API's opaque `nextCursor`. The accessible **Load
older activity** action appends verified pages, deduplicates event IDs, renders
newest first, announces progress or failure, and retains existing rows when a
later request fails.

Platform settings are intentionally constrained: metadata is plain text,
social images require a credential-free HTTPS URL, colors are limited to six
named tokens with a minimum 4.5:1 content/action contrast, and typography is
limited to Instrument Serif, Manrope, and IBM Plex Mono already bundled through
`@faceless-automations/brand`.

## Managed product guides

The public `/guide/:slug` route is independently route-split and renders only a
strictly validated, published document returned by the platform. Missing and
draft guides return the same clear **Guide not found** state; network,
configuration, and malformed-response failures show an unavailable state and
never substitute cached or invented content. Each section becomes an H2 and an
entry in the page table of contents. Content blocks are limited to H3/H4
headings, paragraphs, ordered or bullet lists, callouts, and reviewed links.
The canonical Grok Automator manual is
`https://paks-tools.vercel.app/guide/grok-automator`.

The administration console offers a generic guide library, creation flow, and
editor for current and future tools. Administrators edit metadata plus
repeatable section and block rows with add, remove, and reorder controls. The
UI never accepts raw HTML, Markdown, scripts, or embeds. Link destinations are
limited by the shared platform contract to exact same-origin relative paths or
credential-free HTTPS URLs. All text, identifier, count, uniqueness, aggregate
size, and control-character limits come directly from
`@faceless-automations/platform-contracts` so browser and server validation
cannot drift.

Creating or updating a guide requires the verified Google administrator cookie
and exact per-session `X-Faceless-CSRF` value. Creates start at server revision
0 and duplicate slugs fail with `409`. Updates include the last verified
decimal revision; a `409` preserves the local draft and requires an explicit
reload before another save. The API atomically records every accepted create or
update in the current document, immutable revision history, and administrative
audit trail. Publishing exposes the accepted revision immediately; drafts are
never returned by the public endpoint.

## Root commands

Run installation and commands from the monorepo root. Do not create a workspace
lockfile or workspace-local install.

```powershell
npm run dev:dashboard
npm run check:dashboard
npm run build:dashboard
npm run verify:build:dashboard
```

The production build is written to `apps/faceless-automation-dashboard/dist`.
Its verifier rejects source maps, unintended server/API artifacts, and remote runtime/font assets, requires
route-level JavaScript chunks, verifies all three local font families, and
requires the bundled font and Tabler MIT notices. It also proves the Tabler
runtime is present and rejects legacy Lucide markers.

## Deployment boundary

The dashboard production target is `https://paks-tools.vercel.app`; it is also
the browser API gateway. The upstream API and direct extension origin is live at
`https://paks-api.vercel.app`. Direct and gateway liveness plus
platform-settings reads return `200`, while anonymous admin returns `401` and
readiness intentionally returns `503 not_ready`.

The future owned custom-domain target is `https://paks.tools`, with
`https://api.paks.tools` reserved for the upstream API. Neither is considered
active until purchase, DNS ownership, Vercel attachment, Google callback, and
browser verification are complete.

Live browser QA passed the landing page at desktop/mobile sizes, the Google-only
`/auth` surface, fail-closed anonymous `/admin/platform`, and an invalid
extension-flow state. These checks do not prove a successful Google callback,
authenticated admin mutation, Stripe purchase, entitlement, or extension Run.

The source migration set is current through `0005_guide_cms`; applied
production parity has not been verified for that migration. The administration UI remains unavailable until
the Vercel-only Google/Stripe/admin configuration, Google OAuth setup, and
explicit server-side administrator role are complete. No local fallback
administrator or bypass exists. See the [deployment
evidence](../../.build_plans/VERCEL_DEPLOYMENT.md) for immutable deployment
identifiers and remaining gates.
