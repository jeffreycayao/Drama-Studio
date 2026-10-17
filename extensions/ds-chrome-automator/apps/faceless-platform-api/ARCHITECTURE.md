# Paks Tools Faceless automations API architecture contract

This document began as the provider-neutral design boundary and now describes
the active Vercel Node.js implementation. Vercel environment storage owns every
secret, Neon owns relational persistence, Private Blob owns paid files, Google
is the only identity provider, and Stripe owns payment collection. Core types
remain separated from provider adapters.

## TypeScript shape

```text
apps/faceless-platform-api/
├── api/
│   └── index.ts
├── src/
│   ├── core/
│   │   ├── crypto.ts
│   │   └── errors.ts
│   ├── ports/
│   │   ├── database.ts
│   │   └── providers.ts
│   ├── schemas/
│   ├── http/
│   ├── config/
│   └── adapters/
├── db/migrations/
├── scripts/
└── tests/
```

The core may depend on `@faceless-automations/platform-contracts` and port
interfaces. It must not depend directly on a cloud SDK, framework request type,
database client, global environment access, or extension source module.

## Active platform routes

| Route                                                   | Purpose                                                    | Boundary                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /v1/auth/google/start?client=dashboard`            | Begin the dashboard's server-side Google OIDC flow         | Owned web origin, state, nonce and secure transient cookie         |
| `GET /v1/auth/google/start?client=extension&flowId=:id` | Bind central Google OIDC to a pending extension flow       | Opaque flow ID plus server state, nonce, and PKCE                  |
| `POST /v1/auth/extension-flows`                         | Begin Google-only, PKCE S256 extension authentication      | Derive and allowlist the exact extension origin                    |
| `GET /v1/auth/extension-flows/:flowId`                  | Return safe flow state for the central connection page     | Opaque flow ID; no origin, PKCE, identity, or token data           |
| `POST /v1/auth/extension-flows/:flowId/verify`          | Authorize a callback-bound v2 flow with the displayed code | Exact bound web session, derived CSRF, code, and five attempts     |
| `GET /auth/extension/:flowId`                           | Owned central account connection page                      | Opaque, short-lived flow; no token in URL                          |
| `GET /v1/auth/google/callback`                          | Receive the Google authorization code                      | Validate state, nonce, issuer, audience, expiry and verified email |
| `POST /v1/auth/extension-flows/:flowId/exchange`        | Exchange a one-time flow with the PKCE verifier            | Return only a short-lived application token                        |
| `GET /v1/session`                                       | Resolve the verified dashboard account                     | Secure web cookie or web-session bearer token                      |
| `POST /v1/auth/logout`                                  | Revoke the dashboard web session                           | Secure web cookie or web-session bearer token                      |
| `POST /v1/apps/:appId/usage/reservations`               | Reserve units under an atomic daily quota                  | Active app session, entitlement, separate lock/snapshot            |
| `POST /v1/apps/:appId/usage/reservations/:id/consume`   | Tentatively accept a queue operation                       | Owned reservation plus unique acceptance receipt                   |
| `POST /v1/apps/:appId/usage/reservations/:id/finalize`  | Charge after local commit/query confirmation               | Same acceptance, mutually exclusive terminal transition            |
| `POST /v1/apps/:appId/usage/reservations/:id/rollback`  | Release missing/unfinalized accepted work                  | Same acceptance, idempotent audited compensation                   |
| `POST /v1/apps/:appId/usage/reservations/:id/cancel`    | Release an unaccepted queue operation                      | Owned reservation, idempotent terminal transition                  |
| `POST /v1/apps/:appId/usage/authorize`                  | Temporary v1 immediate final consumption                   | Exact legacy schema and idempotency key until the UTC sunset       |
| `GET /health/live`                                      | Minimal process liveness                                   | No dependencies or sensitive metadata                              |
| `GET /health/ready`                                     | Verify provider configuration and required dependencies    | Generic failure; no credential metadata                            |
| `GET /v1/platform-settings`                             | Public SEO, palette, and bundled-font settings             | Schema-validated persisted data                                    |
| `GET /v1/guides/:slug`                                  | Read one current published structured guide                | Bounded data-only public projection                                |
| `GET /v1/admin/session`                                 | Resolve a bound owner and issue derived CSRF               | Stable Google subject or persisted one-time bootstrap binding      |
| `GET /v1/admin/overview`                                | Administrative counts                                      | Owner only                                                         |
| `GET`, `POST /v1/admin/guides`                          | List or create generic tool guides                         | Owner; create also requires CSRF, snapshot, and audit              |
| `GET`, `PUT /v1/admin/guides/:slug`                     | Read or optimistically update one guide                    | Owner; update also requires CSRF, snapshot, and audit              |
| `GET`, `PUT /v1/admin/platform-settings`                | Read/update central platform presentation                  | Owner plus CSRF and optimistic revision                            |
| `GET /v1/admin/users`                                   | Search and page user accounts                              | Owner only                                                         |
| `POST /v1/admin/users/:id/ban`, `/unban`                | Change account status and revoke sessions                  | Owner plus CSRF and audit                                          |
| `GET /v1/admin/entitlements`                            | Search and page access grants                              | Owner only                                                         |
| `POST /v1/admin/entitlements/:id/revoke`                | Revoke an active grant                                     | Owner plus CSRF and audit                                          |
| `GET /v1/admin/audit-events`                            | Review administrative activity                             | Owner only                                                         |
| `POST /v1/checkout/sessions`                            | Create trusted-catalog Stripe-hosted checkout              | Authenticated, idempotent                                          |
| `POST /v1/webhooks/stripe`                              | Verify and persist Stripe events once                      | Raw body, signature, durable pending queue                         |
| `GET /v1/internal/migrations`                           | Apply idempotent schema from Vercel                        | Vercel Cron secret, no browser Origin                              |

The owned dashboard serves `/auth/extension/:flowId`; it reads only the safe API
status above and initiates Google at
`/v1/auth/google/start?client=extension&flowId=:flowId`. Google returns to the
single server callback and the browser is redirected back to the clean flow URL
without a token or status query value.

## Google-only extension authentication

```text
extension user gesture
  -> owned API creates PKCE-bound flow
  -> extension opens owned central auth page in a normal tab
  -> central auth page redirects to Google
  -> Google returns an authorization code to the owned backend
  -> backend verifies identity, creates a web session, and binds but does not authorize v2
  -> that exact web session submits CSRF plus the code shown by the extension
  -> backend atomically authorizes the same bound user
  -> extension exchanges the one-time flow with its PKCE verifier
  -> backend returns a short-lived Paks Tools Faceless automations application token
  -> extension stores that token in chrome.storage.session
  -> every Run reserves, tentatively accepts, locally commits/queries, then finalizes or rolls back
```

Google access tokens, refresh tokens, client secrets, ID tokens, authorization
codes, signing material, and the provider subject must never be returned to an
extension. Email is profile data, not the account key. No password, email-only,
OTP, magic-link, or static shared-token route is planned.

## Security boundary

- Strict Zod parsing applies to request bodies, query values, path values,
  headers used as data, provider responses, persistence reads, and outgoing API
  responses.
- CORS echoes only a registered owned web origin or exact
  `chrome-extension://<id>` origin and sends `Vary: Origin`; wildcard CORS is
  forbidden.
- The server uses the exact browser origin only to select and validate the
  registered `(environment, appId, extensionId)` client tuple for routing and
  CORS. Origin is not client proof and a body field is never sufficient
  authorization. V2 authorization additionally requires the callback-bound
  Google web session, its CSRF value, the extension-displayed code, and the
  one-time PKCE exchange. The isolated v1 compatibility path retains its weaker
  Origin-only initiator boundary until the documented sunset.
- V2 authentication flows use high-entropy opaque IDs, short expiry, state,
  nonce, PKCE S256, a callback-bound Google web session, derived CSRF, an
  independent eight-character user code, a five-attempt terminal lock, one-time
  exchange, replay protection, and generic failure messages. One row-locked
  Google allocation is permitted per extension flow; competing callback and
  later cancellation/error outcomes cannot replace or deny an existing v2
  identity binding. The temporary v1 shape remains isolated by persisted
  protocol version until the exclusive `2026-11-30T00:00:00.000Z` sunset.
- Google ID tokens require signature, audience, issuer, expiry, nonce, and
  `email_verified` validation. The stable account key is issuer plus `sub`.
- Application access tokens are short-lived and hashed at rest. Web sessions use
  Secure, HttpOnly, SameSite cookies; extension sessions are separate.
- Request bodies, provider calls, flow lifetimes, polling guidance, app-session
  lifetimes, daily units, and reservation evidence are bounded in code.
  Database-backed fixed windows layer client and aggregate limits over flow
  allocation, verification, polling, OAuth allocation, and exchange. Raw
  client addresses are keyed before persistence, and concurrent-flow counts
  are evaluated only after a separate advisory-lock statement.
- Logs and errors exclude authorization headers, cookies, OAuth codes, PKCE
  values, tokens, raw provider responses, secrets, DOM content, prompts, and
  email addresses.
- Remote configuration is JSON data only. It cannot add permissions, change
  network origins, supply executable code, or bypass extension-side schemas.
- Tool guides are bounded structured JSON only. Heading, paragraph, list,
  callout, and safe-link blocks are rendered as data; there is no raw HTML,
  Markdown, script, style, iframe, or executable embed field. Public routes
  select only published rows, while every admin create/update atomically appends
  a recoverable revision and immutable audit event.
- Server-authored entitlements fail closed. A signed-in Google account does not
  automatically receive Pro access.
- Run authorization re-checks the active application session, user ban state,
  and an unexpired `extension:<appId>` or `bundle:all-extensions` entitlement.
  The plan displayed in an extension session is not authorization by itself.
- Layered abuse limits lock their privacy-keyed buckets in stable order and
  consume all buckets or none, so rejection by a narrow bucket cannot deplete
  a broader shared allowance. Daily quota evaluation acquires its advisory
  lock in a separate transaction statement, then counts only consumed units
  and unexpired reservations/tentative holds in the server-computed UTC reset
  window. Accept/finalize/rollback/cancel transitions take ordered locks and
  cannot double-count or cross a terminal state.
- The daily migration invocation executes DDL only for unapplied versions. A
  current schema runs retention only: it expires reservations, auto-rolls back
  tentative holds, and removes bounded-age terminal OAuth/extension flows,
  usage records/events, sessions, and rate buckets.
- Migration `0005_guide_cms` adds persisted stable-subject admin bindings,
  generic current guide documents, append-only guide revisions, and the initial
  published Grok Automator manual. The same advisory-locked migration plan keeps
  its seed and schema idempotent under concurrent runners.
- Audit pages use reverse chronology on `(created_at, id)` and a signed opaque
  cursor; callers cannot substitute a raw event ID as pagination order.
- Administrative routes authorize stable Google subjects. A Vercel-only list
  of exact normalized emails may bootstrap a subject once, but only after the
  server verifies the Google ID token and `email_verified`; unique email,
  subject, and user constraints prevent replacement. Later authorization reads
  the persisted subject, never email. The legacy subject env remains optional.
  Mutations additionally require a derived per-session CSRF token, active user,
  immutable audit entry, and operation-specific transaction. A user ban revokes
  effective admin access. There is no admin bypass.

## Extension permission boundary

When the API origin is known, each extension may request only that exact owned
host for authentication, session, configuration, and usage calls. Opening the
owned auth page does not justify a Google host permission, wildcard host access,
remote scripts, or executable responses. Content scripts do not contact Google
or a third-party API.

## Configuration behavior

Grok Automator™ keeps a bundled last-known-good selector configuration. A future
owned response must match the app-specific shared schema, list the current
extension version as compatible, and pass its content hash before use. Failure,
incompatibility, or malformed data falls back safely; remote data is never
executed.

## Verification gates

Current automated tests cover strict shared contracts, exact CORS and app/origin
registration, user-code verification and lockout, PKCE proof, safe status
serialization, expiry, replay, layered rate keys, atomic one-time exchange,
separated quota locks, idempotency structure, two-phase usage transitions,
retention coverage, signed chronological cursors, migration readiness parity,
and bounded Node request reads. Source scanning, strict TypeScript, lint,
production compilation, and emitted-artifact checks are also mandatory.

Activation still requires the server-side Neon migration, provider-backed
integration tests, an exact deployed Google callback, verified Google token
failure cases, real Postgres quota/concurrency tests, configured Vercel Firewall
thresholds, readiness 200, and low-volume owner-controlled smoke tests. CI must
not use live Google accounts, production credentials, synthetic Pro records, or
third-party user data.
