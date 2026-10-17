# Pancake Toolsets reference port audit

> **Status:** ACTIVE — living reference decision record  
> **Audit type:** Read-only architecture and product-pattern review  
> **Reference root:** `C:\xampp\htdocs\CHROME EXT\PANCAKE TOOLSETS\ATMT Pancake™`  
> **Target:** Paks Tools Faceless automations monorepo  
> **Initial audit date:** 2026-08-16  
> **Last reviewed:** 2026-08-20  
> **Canonical plans:** [`MASTER_PLAN.md`](MASTER_PLAN.md) and
> [`AUDIT_PLAN.md`](AUDIT_PLAN.md)

> **2026-08-20 security correction:** an exact `chrome-extension://` Origin is
> necessary for browser CORS and app routing, but it is not client
> authentication because a raw HTTP client can supply the header. The active
> implementation therefore adds a bounded, one-time user-verification code
> before Google approval. Any older language in this reference about Origin
> enforcement must be read with that v2 requirement.

## 1. Purpose and authority

This document records which ideas from the Pancake Toolsets reference may add
material value to Paks Tools Faceless automations. It is an implementation backlog and an
evidence index, not permission to copy the reference.

`MASTER_PLAN.md` remains authoritative for architecture and milestones.
`AUDIT_PLAN.md` remains authoritative for pass criteria and release evidence.
This audit introduces `REF-*` work-item IDs only for traceability; they are not
additional release gates and cannot be used to mark a canonical gate `PASS`.

The reference repository was inspected read-only. No reference files were
edited. It was Git-clean at the end of the initial audit. No root `AGENTS.md`
governs the audited `AAS API` or `X24H EXTREME™` paths; Paks Tools Faceless automations'
own `AGENTS.md` and mandatory `$sys001x-wxt` rules govern every port.

## 2. Clean-room and intellectual-property boundary

The reference root describes itself as proprietary and “All Rights Reserved”:

- `README.md:1-8`
- `README.md:265-269`

No tracked `LICENSE`, `COPYING`, or `NOTICE` file granting reuse was found
during the audit, even though an internal README link refers to a license.
Until the owner confirms ownership of both codebases and explicitly authorizes
reuse, the following boundary is mandatory:

1. Reimplement approved behavior from a Paks Tools Faceless automations specification.
2. Do not copy source, assets, CSS, product copy, customer claims, databases,
   secrets, identifiers, or proprietary branding.
3. Do not preserve Pancake-, Systeme-, Meta-, or customer-specific workflows
   unless they independently belong in the approved target product scope.
4. Do not import the reference repository as a package, submodule, build input,
   test fixture, or deployment dependency.
5. Keep provider trademarks and SDKs subject to their current terms. Do not
   imply that code ownership grants rights to Google, Stripe, Chrome Web Store,
   marketplace, customer, or third-party assets.
6. Use Tabler Icons and the stable `@faceless-automations/brand` package; do not
   copy the reference's Lucide, Phosphor, remote icon, or font implementation.

If reuse rights are later confirmed, retain this boundary for customer data,
credentials, branding, and third-party material. Record that decision under
`PLAN-04` before any direct reuse.

## 3. Decision summary

| ID               | Decision                    | Reference behavior                                                                  | Target adaptation                                                                                | Master / audit mapping                                                                  |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `REF-AUTH-01`    | **PORT**                    | One-time OAuth transaction, PKCE S256, bounded return URL, secure cookie            | Neon-backed, atomically consumed Google OIDC flow; identify by issuer and subject                | M2–M3; `DATA-02..03`, `AUTH-01..05`, `AUTH-09`                                          |
| `REF-SESS-01`    | **PORT**                    | Opaque web sessions, hashed token lookup, session-bound CSRF, revocation            | Separate web and app-scoped extension sessions; persistent audit and live ban checks             | M2–M3; `DATA-02`, `DATA-06..07`, `AUTH-05..09`, `SEC-04`                                |
| `REF-ORIGIN-01`  | **PORT WITH HARDENING**     | Exact Chrome extension ID-to-product mapping and exact-origin CORS                  | Environment-specific app registry; reject unknown and missing Origin on extension-only routes    | M0–M3, M8; `PLAN-03`, `PLAT-03`, `AUTH-07`, `WXT-02..04`                                |
| `REF-ADMIN-01`   | **PORT WITH HARDENING**     | Admin user search, filters, ban/unban, license actions, and session kick            | SQL/cursor queries, role checks, immutable audit events, scoped session revocation               | M2, M5, M7, M9; `DATA-06..07`, `AUTH-08`, `LIC-06..07`, `LIC-11`, `UX-10`, `OPS-04..06` |
| `REF-LIC-01`     | **BUILD NEW MODEL**         | Global active subscription plus a global manual license                             | Capability entitlements for one extension, All Apps, versioned bundles, and assets               | M2, M4–M6; `DATA-02..03`, `PAY-05..11`, `LIC-01..12`, `FILE-02`, `FILE-06..07`          |
| `REF-PAY-01`     | **PORT PATTERN**            | Server-owned Stripe prices, verified webhook ingress, idempotent event claim        | Durable Neon webhook inbox, immutable orders, granular entitlement projection and reconciliation | M4–M5; `PAY-01..11`, `LIC-06..08`, `LIC-12`, `OPS-02`                                   |
| `REF-CAT-01`     | **PORT WITH HARDENING**     | Admin marketplace CRUD, active state, feature/order controls                        | Product/offer/app/asset catalog with draft, publish, archive, revisions, and owned assets        | M2, M4, M6–M7; `DATA-01..02`, `UX-01..05`, `FILE-01`, `FILE-07`                         |
| `REF-PUBLISH-01` | **PORT PATTERN**            | Validate, publish, archive, and rollback workflow                                   | Transactional immutable revisions for platform settings, SEO, catalog, and asset releases        | M2, M6–M7; `DATA-01..03`, `DATA-06`, `UX-01..04`, `FILE-07`                             |
| `REF-APPEAR-01`  | **BUILD NEW**               | Reference has static metadata/theme and a local light/dark toggle only              | Admin Appearance and SEO consoles backed by published revisions                                  | M2, M7; `DATA-01..02`, `UX-03..08`, `A11Y-02..03`                                       |
| `REF-DEV-01`     | **BUILD NEW**               | Extension hardcodes a production API origin and host permission                     | Explicit local, LAN, preview, and production public-origin build profiles                        | M0–M3, M8; `PLAN-03`, `PLAT-02..03`, `AUTH-05`, `AUTH-07`, `WXT-02..04`                 |
| `REF-RUN-01`     | **PORT STATE CONCEPT ONLY** | Reference has useful access states but hides the entire UI behind full-screen gates | Keep tools visible; authorize only on Run; resume one pending Run after fresh authorization      | M3, M5, M8; `AUTH-08..10`, `LIC-01`, `LIC-09..10`, `WXT-08..10`                         |
| `REF-SEC-01`     | **PORT AND STRENGTHEN**     | Build scan checks source maps and secret environment names                          | Scan source, bundles, manifests, ZIPs, known-secret hashes, remote code, CSP, notices, and maps  | M1, M8–M9; `SEC-02..05`, `WXT-02..07`, `WXT-11`                                         |

## 4. Evidence and implementation decisions

### 4.1 Google-only authentication and sessions

#### Port

- `AAS API/lib/browser-oauth.ts:47-67` creates cryptographically random values
  and a SHA-256 PKCE challenge.
- `AAS API/lib/browser-oauth.ts:112-141` restricts post-login return targets to
  the owned origin.
- `AAS API/lib/browser-oauth.ts:143-195` stores an expiring transaction and
  consumes state once.
- `AAS API/lib/browser-oauth.ts:202-288` sets secure cookies, builds the Google
  authorization request, and exchanges the code with its verifier.
- `AAS API/lib/browser-session.ts:199-262` issues opaque sessions, stores a
  token hash, and supports one-session or all-session revocation.
- `AAS API/lib/browser-session.ts:269-327` checks expiry, ban state, and current
  role during session resolution.
- `AAS API/lib/browser-session.ts:381-452` applies Secure, HttpOnly, SameSite,
  and timing-safe CSRF checks.
- `AAS API/lib/browser-csrf.ts:45-108` combines exact Origin, Fetch Metadata,
  and session-bound double-submit CSRF checks.

#### Required adaptation

- Use Google authorization code plus PKCE and validate the OIDC ID token's
  signature, issuer, audience, nonce, expiry, and verified-email claim.
- Identify a user by `(issuer, subject)`, not by mutable email and never by a
  client-supplied user identifier.
- Store only hashed session tokens. Keep Google tokens and provider subject out
  of extension responses.
- Model `auth_flows` with expiry, consumed time, intended client, exact app ID,
  exact return target, challenge, and one-use exchange transaction.
- Keep the extension token short-lived, app-scoped, and in WXT/Chrome session
  storage. Renewal and revocation remain server decisions.

#### Do not port

- `X24H EXTREME™/utils/auth.ts:196-212` directly requests a Google token with
  `chrome.identity.getAuthToken`.
- `AAS API/lib/extension-oauth.ts:65-133` uses unsigned, encoded extension
  state rather than a server-created one-time transaction.
- `AAS API/lib/extension-oauth.ts:247-297` returns a raw application token in a
  URL fragment.
- `AAS API/lib/google.ts:20-89` relies on token-info/user-info calls instead of
  locally validating the OIDC token and nonce.

Related gates: `AUTH-01..10`, `DATA-02..03`, `SEC-02`, `SEC-04`, `PRIV-01`.

### 4.2 Exact origins, extension identity, and CORS

#### Port

- `AAS API/lib/extension-product-binding.ts:82-109` maps extension IDs to a
  product and validates Chrome's 32-character extension-ID form.
- `AAS API/lib/extension-product-binding.ts:137-226` binds the redirect,
  extension origin, and claimed product.
- `AAS API/lib/cors.ts:21-82` echoes an exact allowed origin, emits
  `Vary: Origin`, restricts headers/methods, and rejects unknown preflight.
- `AAS API/tests/extension-product-binding.security.ts:210-383` covers origin
  and product-binding denial cases.

#### Required adaptation

- Store `{environment, extension_id, app_id, active}` in a validated registry
  with Vercel environment configuration as bootstrap only.
- Bind extension sessions and usage decisions to the registered `app_id`.
- Require a recognized extension Origin on extension-only browser routes.
  `AAS API/lib/cors.ts:35-37` currently allows a request with no Origin, and
  `AAS API/tests/extension-product-binding.security.ts:293-298` treats that as
  an accepted non-extension client. A separate server-to-server route should
  carry any legitimate originless traffic.
- Treat Origin as a routing/CORS control only. Bind the public client to the
  person approving the flow with a short code displayed independently by the
  initiating extension, hash that code at rest, cap attempts, expire it, and
  keep it out of authorization URLs and logs.
- Do not pin an extension ID in source while the manifest key remains removed.
  Register the observed unpacked development ID per environment, then add the
  final store ID when the owner supplies it.

Related gates: `PLAN-03`, `PLAT-03`, `AUTH-07`, `LIC-02..03`, `LIC-10`,
`WXT-02..04`.

### 4.3 Admin identity, users, bans, and sessions

#### Port

- `AAS API/lib/admin-allowlist.ts:1-7` provides a deployment-environment admin
  bootstrap allowlist.
- `AAS API/lib/admin-auth.ts:206-274` performs request-aware authorization,
  CSRF enforcement on unsafe methods, and live role checks.
- `AAS API/app/admin/users/page.tsx:22-48` exposes user status and source
  filters.
- `AAS API/app/admin/users/page.tsx:147-395` provides search, status, license,
  ban, and user-management surfaces.
- `AAS API/app/api/admin/ban/route.ts:7-70` prevents banning administrators,
  records actor/reason/time, and revokes user sessions.
- `AAS API/app/admin/users/BanActions.tsx:19-66` confirms destructive actions
  and collects a reason.
- `AAS API/app/admin/sessions/SessionsClient.tsx:13-220` lists and sorts active
  sessions and provides a kick action.
- `AAS API/app/admin/sessions/kick/route.ts:5-18` scopes revocation to one
  user/product pair.

#### Required adaptation

- Use a Vercel secret allowlist only to bootstrap the first administrator.
  Store normal roles and grants in Neon, protect the final active administrator,
  and require current role evaluation for every admin request.
- Add immutable `admin_audit_events` with actor, target, action, reason,
  before/after references, request ID, environment, and timestamp.
- Make ban/revoke operations transactional across web sessions, extension
  sessions, refresh grants, pending downloads, and future usage authorization.
- Keep separate actions for one session, all sessions for one app, and all
  account sessions.
- Perform search, filters, sorting, and cursor pagination in SQL.
  `AAS API/lib/admin-data.ts:678-725` filters a loaded collection in memory and
  must not become the production query pattern.
- Preserve historical ban/revocation events. The reference clears current ban
  metadata on unban and relies heavily on console logs rather than durable
  audit records.

Related gates: `PLAN-04`, `DATA-02`, `DATA-06..07`, `AUTH-08`, `LIC-06..07`,
`LIC-11`, `SEC-04`, `UX-10`, `OPS-04`, `OPS-06`.

### 4.4 Licensing and entitlements

#### Build new

The reference's account record has a global `subscription_active` flag and a
global manual license:

- `AAS API/lib/kv.ts:21-84`
- `AAS API/app/api/subscription/status/route.ts:26-39`
- `AAS API/lib/stripe.ts:97-158`

That shape cannot represent the approved platform catalog. Build normalized,
provider-neutral grants such as:

```text
extension:grok-automator
bundle:all-extensions
bundle-version:<bundle-version-id>
asset:<asset-id>
collection:<collection-id>
```

Every grant must record subject, capability, source, validity window, status,
revocation, issuer, reason, and source order/subscription/admin event. Manual
grants must be additive or explicitly overriding under written precedence
rules; an active Stripe subscription must not prevent a bounded correction.

The following reference UX can inform, but not define, the new model:

- `AAS API/app/api/admin/license/route.ts:7-117` validates manual grant/revoke
  actions.
- `AAS API/app/admin/users/LicenseActions.tsx:19-185` exposes assignment,
  trial, expiry, and revocation states.

Related gates: `DATA-02..03`, `PAY-05..11`, `LIC-01..12`, `FILE-02`,
`FILE-06..07`, `UX-03..05`.

### 4.5 Stripe checkout, webhooks, and reconciliation

#### Port

- `AAS API/app/api/subscription/checkout/route.ts:22-59` authenticates the user,
  selects the Price server-side, and stamps provider metadata.
- `AAS API/lib/stripe.ts:33-46` keeps Stripe Price IDs in server configuration.
- `AAS API/app/api/webhooks/stripe/route.ts:59-171` reads the raw request,
  verifies its signature, claims an event, recomputes state, and releases failed
  work for retry.
- `AAS API/lib/webhook-idempotency.ts:12-124` defines receipt and claim-token
  behavior.
- `AAS API/lib/webhook-idempotency.ts:237-337` distinguishes processed,
  in-progress, retryable, and completed events.

#### Required adaptation

- The client submits a public offer slug; the API resolves the active Stripe
  Product and Price. Never authorize arbitrary client-submitted Price IDs.
- Persist a durable webhook inbox with unique `(provider, event_id)`, payload
  hash, signature result, attempt count, processing lease, error class, and
  processed time.
- Project immutable orders and granular entitlements transactionally. Treat a
  success redirect as informational only.
- Reconcile Stripe into the internal entitlement projection asynchronously.
  Do not copy `AAS API/lib/stripe-entitlement.ts:42-75`, which can turn access
  off because of a transient live provider request failure.
- Cover refunds, disputes, failed payments, cancellation, expiry, resumption,
  and out-of-order events under written policy.

Related gates: `PAY-01..11`, `DATA-02..03`, `LIC-06..08`, `LIC-12`, `SEC-02`,
`OPS-01..02`.

### 4.6 Product catalog and versioned publication

#### Port

- `AAS API/app/admin/marketplace/MarketplaceForm.tsx:19-230` manages identity,
  store ID, copy, icon, category, order, feature, and active state.
- `AAS API/app/admin/marketplace/MarketplaceClient.tsx:20-149` manages listing
  state and removal.
- `AAS API/app/api/admin/marketplace/route.ts:12-196` protects and validates
  catalog CRUD.
- `AAS API/app/api/marketplace/route.ts:12-50` emits an active-only public
  projection.
- `AAS API/app/api/admin/prompts/validate/route.ts:1-60`,
  `publish/route.ts:1-69`, `archive/route.ts:1-30`, and
  `rollback/route.ts:1-55` demonstrate validate/publish/archive/rollback
  lifecycle actions.

#### Required adaptation

- Create an app/product/offer/price/asset catalog used by the storefront,
  dashboard, API, and extension discovery.
- Add product kind, entitlement capability, Stripe references, bundle
  membership, download asset/version, install URL, state, ordering, and
  effective dates.
- Validate request bodies with shared runtime schemas and explicit size bounds.
- Accept only owned, validated image assets from the selected private/public
  asset delivery path. The reference accepts arbitrary HTTP(S) icon URLs.
- Archive sold products instead of hard deleting them.
- Publish immutable revisions and implement rollback by creating a new revision,
  not by rewriting history.
- Send extensions data only, never executable configuration or remote scripts.

Related gates: `DATA-01..03`, `PAY-01`, `LIC-02..06`, `FILE-01`, `FILE-05`,
`FILE-07`, `UX-01..05`, `SEC-01`, `SEC-03`.

### 4.7 Admin Appearance and SEO controls

#### Build new

The reference does not provide an admin-controlled theme or metadata system:

- `AAS API/app/layout.tsx:1-36` statically configures fonts and root metadata.
- `AAS API/app/page.tsx:38-42` statically defines landing metadata.
- `AAS API/app/admin/admin.css:8-132` contains fixed theme aliases and tokens.
- `AAS API/components/theme-toggle.tsx:8-39` changes a per-browser light/dark
  preference only.
- `AAS API/app/admin/layout.tsx:12-39` statically defines admin metadata and
  theme color.

Build `platform_settings` and immutable `platform_settings_revisions`, then add
separate `/admin/appearance` and `/admin/seo` surfaces with draft, preview,
validate, publish, and rollback.

Initially allow only controlled fields:

- semantic platform color tokens with format and contrast validation;
- the approved Instrument Serif, Manrope, and IBM Plex Mono presets consumed
  through `@faceless-automations/brand`;
- site title, description, Open Graph title/description/image, robots defaults,
  and owned asset identifiers;
- structured preview and publication metadata, actor, time, and audit event.

Do not allow arbitrary font URLs, runtime font CSS, raw CSS/HTML/JavaScript,
untrusted metadata templates, or remote icon libraries. Published settings must
fail closed to a versioned safe default if a database read is unavailable.

Related gates: `DATA-01..03`, `DATA-06..07`, `UX-03`, `UX-06..08`,
`A11Y-02..03`, `SEC-01`, `SEC-03..04`.

### 4.8 Local development and Vercel origins

#### Evidence

- `AAS API/lib/url.ts:1-35` selects public application, portal, and callback
  URLs from environment values, but falls back to production defaults.
- `AAS API/DEPLOYMENT_GUIDE.md:223-255` documents separate Vercel environments
  and stable callback/origin values.
- `AAS API/DEPLOYMENT_GUIDE.md:348-364` recommends sensitive Vercel values but
  also recommends pulling them into `.env.local`, which conflicts with the
  owner's Vercel-only secret requirement.
- `AAS API/DEPLOYMENT_GUIDE.md:775-783` documents exact development extension
  IDs and CORS origins.
- `X24H EXTREME™/utils/auth.ts:1-14` hardcodes the production API base.
- `X24H EXTREME™/wxt.config.ts:226-233` grants only the production host.

#### Build new

- Use public build variables such as `WXT_PLATFORM_API_ORIGIN` and
  `WXT_PLATFORM_WEB_ORIGIN`, validated against an explicit environment matrix.
- Development manifests may include only the exact
  `http://localhost:<port>/*` and, when required, exact
  `http://<approved-LAN-IP>:<port>/*` patterns. Production contains only the
  stable Vercel/owned API origin and required target-site origins.
- Never use `http://*/*`, a private-subnet wildcard, or `<all_urls>`.
- The endpoint host and caller origin are distinct. A LAN API request still
  presents the extension's `chrome-extension://<extension-id>` origin; register
  that exact development ID in CORS.
- With no manifest key, an unpacked ID may change with browser profile or path.
  Capture and register it per development environment; do not reintroduce a
  key merely for convenience.
- Keep Google, Stripe, Neon, Blob, signing, and application secrets only in
  Vercel. Do not run `vercel env pull` for real secrets. Local clients should
  call a stable Vercel Preview API for real Google/Stripe flows; local APIs may
  use non-secret mocks or isolated test fixtures.
- Do not weaken Secure or `__Host-` cookies to support plain LAN HTTP. Google
  allows localhost development exceptions more readily than arbitrary LAN
  callback IPs. Use localhost, stable Vercel HTTPS, or an approved HTTPS tunnel
  with an exact registered callback.
- Use a stable Vercel project URL or stable preview alias for OAuth callbacks;
  do not register ephemeral commit URLs.

Related gates: `PLAN-03`, `PLAT-02..04`, `AUTH-03`, `AUTH-05`, `AUTH-07`,
`SEC-02`, `WXT-02..04`.

### 4.9 Extension Run UX and authorization state

#### Port only the state concept

- `X24H EXTREME™/utils/auth.ts:17-32` and `:80-131` use session-scoped extension
  storage for an application session.
- `X24H EXTREME™/utils/auth.ts:398-470` refreshes access state and obtains
  backend-created Checkout/Portal URLs.
- `X24H EXTREME™/utils/access-gate.ts:1-30` defines a stable
  subscription-required result.

Use a stable, typed platform decision union:

```text
SIGNED_OUT | NOT_ENTITLED | BANNED | SESSION_REVOKED | OFFLINE | AUTHORIZED
```

All tools remain visible. A Run click creates one pending intent, obtains a
fresh server usage decision, and either runs, opens Google-only sign-in, offers
the exact purchase path, or reports a recoverable denial. After sign-in, resume
the pending Run at most once and only after the server returns `AUTHORIZED`.
Perform access refresh on open, Run, and a bounded alarm/backoff schedule rather
than high-frequency polling.

#### Do not port

`X24H EXTREME™/entrypoints/sidepanel/App.tsx:750-771` replaces the tool UI with
full-screen disclaimer, login, and subscription gates. That directly conflicts
with the approved visible-tools, gate-on-Run workflow.

Related gates: `AUTH-08..10`, `LIC-01`, `LIC-09..10`, `WXT-08..10`, `UX-04`,
`A11Y-01..04`.

### 4.10 Deployment, CSP, logging, and build verification

#### Port and strengthen

- `AAS API/vercel.json:1-4` demonstrates a minimal monorepo deployment-ignore
  rule.
- `AAS API/DEPLOYMENT_GUIDE.md:214-245` separates Vercel environments.
- `AAS API/DEPLOYMENT_GUIDE.md:301-390` documents sensitive environment input,
  stable previews, and production promotion.
- `AAS API/scripts/check-build-security.mjs:21-92` rejects source maps and
  selected secret environment names in client chunks.
- `AAS API/lib/cors.ts:8-14` and `:47-59` expose request/version metadata useful
  for release tracing.

Platform verification must additionally scan source, web output, WXT output,
manifest, production ZIP, and public assets for known-secret value hashes,
credential patterns, source maps, unsafe evaluation, remote executable code,
unapproved origins, missing legal banners, and missing font/Tabler notices.
Structured logs should contain request ID, server release, app ID, and client
version while redacting auth headers, cookies, tokens, prompts, provider bodies,
and unnecessary PII.

#### Do not port

- `AAS API/next.config.ts:16-31` permits remote Google font origins,
  `unsafe-inline`, and multiple broad endpoints. Build a least-privilege CSP
  from the actual platform routes and bundled assets.
- A scanner that detects only environment-variable names is insufficient; it
  does not prove that secret values are absent.
- Do not port Upstash-specific persistence. The approved platform database is
  Neon Postgres.

Related gates: `PLAT-01..06`, `SEC-01..05`, `OPS-01..05`, `WXT-02..07`,
`WXT-11`.

## 5. Consolidated do-not-port register

| Item                                                                              | Reason                                                                                    | Evidence / boundary                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Upstash Redis data layer                                                          | Conflicts with the approved Neon relational architecture and required transactional model | `AAS API/lib/kv.ts`                                                      |
| Global `subscription_active` or global manual license                             | Cannot represent one-extension, All Apps, versioned bundle, and asset grants              | `AAS API/lib/kv.ts:21-84`                                                |
| Direct Chrome Google OAuth token                                                  | Exposes provider-token handling to the extension and weakens central flow control         | `X24H EXTREME™/utils/auth.ts:196-212`                                    |
| Unsigned extension OAuth state or URL-fragment session token                      | Missing one-time server state and stronger exchange guarantees                            | `AAS API/lib/extension-oauth.ts:65-133`, `:247-297`                      |
| Client-supplied Google/user identifier for session creation                       | Identity must derive from a verified provider response and server session                 | `AAS API/lib/extension-session.ts:85-129`                                |
| Full-screen login/paywall gate                                                    | Conflicts with visible tools and gate-on-Run                                              | `X24H EXTREME™/entrypoints/sidepanel/App.tsx:750-771`                    |
| Hardcoded production API origin                                                   | Prevents safe local/preview profiles and environment isolation                            | `X24H EXTREME™/utils/auth.ts:1-14`                                       |
| Broad or speculative host permissions                                             | Violates least privilege and WXT/CWS gates                                                | `X24H EXTREME™/wxt.config.ts:226-233` is evidence to replace, not expand |
| Remote Google fonts and broad CSP                                                 | Violates bundled typography and least-privilege CSP policy                                | `AAS API/next.config.ts:16-31`                                           |
| Lucide, Phosphor, emoji UI, or arbitrary remote icon assets                       | The platform standardizes on bundled Tabler icons and notices                             | Reference UI dependencies and marketplace icon field                     |
| Hard delete of sold catalog items                                                 | Breaks order, entitlement, support, and audit history                                     | `AAS API/app/admin/marketplace/MarketplaceClient.tsx:20-58`              |
| In-memory production user filtering                                               | Does not scale and weakens stable pagination                                              | `AAS API/lib/admin-data.ts:678-725`                                      |
| Console-only admin audit                                                          | Does not provide durable attribution or history                                           | Admin ban/license/session handlers                                       |
| Provider outage interpreted as license loss                                       | A transient integration failure must not silently rewrite customer rights                 | `AAS API/lib/stripe-entitlement.ts:42-75`                                |
| Pancake/Systeme/Meta proxies, campaigns, courses, customer data, and PWA behavior | Outside approved initial scope and carries product/IP/privacy coupling                    | Reference-specific routes and applications                               |
| Reference source, branding, copy, assets, and customer claims                     | Proprietary/all-rights-reserved clean-room boundary                                       | `README.md:1-8`, `README.md:265-269`                                     |

## 6. Actionable backlog

No item is complete merely because a similar reference feature exists. Each
item needs target source, tests, and the evidence required by its canonical
gates.

| Backlog ID  | Milestone | Work                                                                                                                                                                                                         | Completion evidence                                                                                | Related gates                                                                 |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `REF-BL-01` | M0        | Approve an environment registry covering stable Vercel web/API URLs, localhost, optional exact LAN IP, Google callbacks, CORS origins, dev extension IDs, and future CWS IDs                                 | Reviewed environment matrix with no wildcard origins                                               | `PLAN-01`, `PLAN-03`, `PLAN-05`, `PLAT-03`, `AUTH-07`, `WXT-03`               |
| `REF-BL-02` | M1        | Activate the strict-TypeScript API workspace with bounded requests, runtime schemas, redacted errors, structured request IDs, and public-config/secret separation                                            | Root CI plus negative configuration and logging tests                                              | `PLAT-01`, `PLAT-03`, `PLAT-05`, `SEC-01..04`, `OPS-01`                       |
| `REF-BL-03` | M2        | Add migrations for identities, auth flows, web/extension sessions, admin roles/audit events, app registry, catalog, offers, orders, webhook inbox, entitlements, revocations, assets, and settings revisions | Empty-database migration and constraint/race suite                                                 | `DATA-01..07`                                                                 |
| `REF-BL-04` | M3        | Implement Google-only OIDC with one-time PKCE transactions, nonce validation, opaque web sessions, CSRF, and exact return targets                                                                            | Replay, expiry, mismatch, cancellation, cookie, and output tests                                   | `AUTH-01..05`, `AUTH-09`, `PRIV-01`                                           |
| `REF-BL-05` | M3        | Implement app-scoped extension exchanges, hashed short-lived tokens, exact extension origin/app binding, logout, and revocation                                                                              | CORS/tampering matrix and two-profile session lifecycle                                            | `AUTH-03..09`, `SEC-01`, `SEC-04`, `WXT-03..04`                               |
| `REF-BL-06` | M4        | Implement server-owned offers, Stripe Checkout, raw-body signature verification, durable idempotent webhook inbox, order projection, Customer Portal, and reconciliation                                     | Stripe test-mode purchase, replay, out-of-order, failure, refund, dispute, and portal evidence     | `PAY-01..11`, `SEC-02`, `PRIV-02`, `OPS-02`                                   |
| `REF-BL-07` | M5        | Implement capability-based entitlement resolution and deterministic admin/provider lifecycle transitions                                                                                                     | Cross-app, All Apps, bundle, asset, expiry, revoke, tampering, race, and repair tests              | `LIC-01..12`, `DATA-02..03`                                                   |
| `REF-BL-08` | M5        | Build admin users, filters, roles, ban/unban, granular grant/revoke, scoped session revocation, and immutable audit views                                                                                    | SQL pagination tests, last-admin protection, confirmation UX, and audit records                    | `DATA-06..07`, `AUTH-08`, `LIC-06..07`, `LIC-11`, `UX-10`, `OPS-04`, `OPS-06` |
| `REF-BL-09` | M6        | Build versioned digital-product and owned-asset administration with authenticated delivery                                                                                                                   | Version, ownership, revocation, header, hash, and download tests                                   | `FILE-01..07`, `FILE-09..10`, `LIC-05`, `LIC-07`                              |
| `REF-BL-10` | M7        | Build catalog administration with drafts, owned assets, server-selected offers, publication, archive, and rollback                                                                                           | Catalog/API/UI reconciliation and revision history                                                 | `UX-01..05`, `DATA-01..03`, `PAY-01`, `FILE-07`                               |
| `REF-BL-11` | M7        | Build Appearance and SEO administration with controlled color/font/meta schemas, preview, publish, audit, cache invalidation, and safe fallback                                                              | Revision tests, rendered metadata, responsive/contrast audit, source/output/network scan           | `DATA-01..03`, `UX-03`, `UX-06..08`, `A11Y-02..03`, `SEC-03`                  |
| `REF-BL-12` | M8        | Add environment-specific WXT public origins and exact dev/production manifest hosts without embedding secrets or restoring a manifest key                                                                    | Dev manifest, production manifest, CORS, output, and ZIP evidence                                  | `PLAN-03`, `AUTH-07`, `SEC-03`, `WXT-01..07`, `WXT-11`                        |
| `REF-BL-13` | M8        | Implement the typed Run access state while keeping every tool visible and preserving queue/download behavior                                                                                                 | Signed-out, licensed, unlicensed, banned, revoked, offline, recovery, and one-resume browser tests | `AUTH-08..10`, `LIC-01`, `LIC-09..10`, `WXT-08..10`, `A11Y-01..04`            |
| `REF-BL-14` | M9        | Add source/build/deployment scanners, structured monitoring, admin/security runbooks, and exact release evidence                                                                                             | Full CI, deployed checks, alert exercises, artifact hashes, and owner launch record                | `PLAT-06`, `SEC-02..05`, `OPS-01..07`, `WXT-05..07`, `WXT-11..12`             |

## 7. Success-audit checkpoints

The following checkpoints prevent a reference-inspired feature from being
accepted on appearance alone:

1. **Authentication:** no redirect or HTTP 200 counts as login success. The
   verified Google identity, consumed one-time flow, and correct Paks Tools
   Faceless automations application session must be evidenced under
   `AUTH-02..09`.
2. **Admin enforcement:** hiding a control is not authorization. Server denial,
   immutable attribution, and revoked live sessions must be evidenced under
   `AUTH-08`, `LIC-07`, `LIC-11`, `UX-10`, and `OPS-04`.
3. **Payments:** a Checkout success page is not fulfillment. The verified
   webhook, unique order, exact entitlement, and reconciliation record must be
   evidenced under `PAY-04..11` and `LIC-12`.
4. **Appearance and SEO:** a saved form is not publication. The selected
   revision must render on the deployed immutable URL with valid contrast,
   local fonts, Tabler assets, and no remote runtime dependency under
   `PLAT-06`, `UX-06..08`, and `A11Y-02..03`.
5. **Extension access:** a login modal is not enforcement. All tools must remain
   visible, Run must call the server, denial must fail closed, and successful
   recovery must resume exactly once under `AUTH-10`, `LIC-09`, and
   `WXT-08..10`.
6. **Local development:** a local UI load is not an origin audit. Record the
   emitted manifest, endpoint URL, caller extension ID, CORS response, cookie
   behavior, and absence of secrets under `PLAN-03`, `PLAT-03`, `AUTH-05`,
   `AUTH-07`, and `WXT-03..04`.
7. **Release:** a local build is not deployment or store publication. Record
   commit, Vercel deployment, database environment, Stripe mode, manifest,
   verified ZIP, SHA-256, and CWS state separately under `PLAT-06`, `OPS-07`,
   and `WXT-11..12`.

## 8. Maintenance log

### 2026-08-16 — Initial reference audit

- Completed a read-only audit of the Pancake Toolsets reference.
- Established the clean-room/IP boundary and evidence index.
- Selected high-value authentication, session, CORS, admin, Stripe,
  publication, and build-verification patterns for independent implementation.
- Rejected global licensing, direct extension OAuth, full-screen gating,
  hardcoded origins, broad CSP, remote assets, and product-specific coupling.
- Added an ordered backlog mapped to the existing M0–M9 milestones and
  canonical success gates.
