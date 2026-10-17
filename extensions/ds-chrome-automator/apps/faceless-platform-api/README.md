# Paks Tools Faceless automations API

Live TypeScript API scaffold for Paks Tools Faceless automations at
`https://paks-api.vercel.app`. It runs as a Node.js 24 Vercel
Function and uses Neon Postgres, Google OpenID Connect, Stripe Checkout, signed
Stripe webhooks, and Vercel Private Blob.

The current source release is `0.2.6`. The latest verified production release is
`0.2.3`; deployment `dpl_5scMFAw976ScifQCAdZFLFCGRCKF` is Ready at the stable
`https://paks-api.vercel.app` alias. Source version and production deployment
status remain separate until `0.2.6` is explicitly released.

The implementation fails closed. Liveness and Neon-backed public platform
settings return `200`; the source migration set is current through
`0005_guide_cms`. The latest recorded production migration evidence
predates this migration and must be refreshed after an authorized deployment and
server-side migration run. Readiness intentionally returns `503 not_ready`, and
Google authentication, Checkout, authenticated administration, entitlement
fulfillment, and private delivery remain unavailable until their exact Vercel-
only configuration and audited journeys exist.

## Secret ownership

All credentials are created and retained in Vercel project environment storage.
Do not create `.env`, `.env.local`, workspace secret files, or run
`vercel env pull`. Do not pass real secrets to local commands.

Server-only Vercel values:

| Variable                        | Purpose                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | Vercel Marketplace Neon connection string                                            |
| `BLOB_READ_WRITE_TOKEN`         | Private Blob server access                                                           |
| `GOOGLE_CLIENT_ID`              | Server-owned Google Web OAuth client                                                 |
| `GOOGLE_CLIENT_SECRET`          | Google authorization-code exchange                                                   |
| `GOOGLE_OAUTH_REDIRECT_URI`     | Exact deployed callback URL                                                          |
| `OAUTH_TRANSIENT_KEY`           | Encrypt transient OAuth verifier material                                            |
| `SESSION_TOKEN_PEPPER`          | Hash sessions and derive CSRF, cursor, flow, and rate keys                           |
| `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` | Exact normalized Google-verified emails eligible for one-time stable-subject binding |
| `ADMIN_GOOGLE_SUBJECTS`         | Optional legacy stable Google-subject allowlist                                      |
| `STRIPE_RESTRICTED_KEY`         | Least-privilege `rk_` key for Checkout Sessions                                      |
| `STRIPE_WEBHOOK_SECRET`         | Signature verification for the deployed webhook endpoint                             |
| `STRIPE_PRICE_CATALOG_JSON`     | Trusted product-to-Price/entitlement mapping                                         |
| `CRON_SECRET`                   | Vercel Cron authentication for server-side migrations                                |

Non-secret deployment configuration still belongs in Vercel, not a checked-in
runtime environment file:

| Variable                              | Example shape                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `PUBLIC_APP_ORIGIN`                   | Exact HTTPS dashboard origin                                                    |
| `PUBLIC_API_ORIGIN`                   | Exact browser-visible callback/gateway origin used to validate Google redirects |
| `PUBLIC_WEB_ORIGINS`                  | Comma-separated exact HTTPS origins                                             |
| `PUBLIC_EXTENSION_REGISTRATIONS_JSON` | Exact `appId`, extension origin, and environment tuples; `[]` is safe initially |
| `ALLOW_LOCAL_DEVELOPMENT_ORIGINS`     | Explicit `true` or `false`                                                      |
| `PUBLIC_DEV_ORIGINS`                  | Exact localhost/private-LAN HTTP origins with ports                             |
| `USAGE_AUTHORIZATION_TTL_SECONDS`     | Short active-reservation lifetime from 30 through 300 seconds                   |
| `USAGE_DAILY_UNIT_LIMIT`              | Server-owned daily authorized-unit ceiling                                      |

Wildcards, arbitrary HTTP sites, public IP development origins, duplicated
origins, and unregistered extension IDs are rejected.

## Local development

The recommended extension integration loop is:

```text
unpacked extension -> deployed Vercel preview API
```

This exercises the real provider boundary without copying secrets to a laptop.
Register each local dashboard/LAN origin in `PUBLIC_DEV_ORIGINS` and each
unpacked extension ID in `PUBLIC_EXTENSION_REGISTRATIONS_JSON` on Vercel. Web
session testing must use a deployed same-site dashboard/API route (or a reviewed
same-origin development proxy); a local dashboard calling an unrelated Vercel
API hostname must not be assumed to receive the API's SameSite cookie.

For offline routing and failure-state work, run the intentionally no-secret shell:

```powershell
npm run dev --workspace=apps/faceless-platform-api
npm run dev --workspace=apps/faceless-platform-api -- --host 0.0.0.0
```

The first command binds only `127.0.0.1:8787`; the second explicitly exposes the
shell to the LAN and adds each detected private IPv4 interface as an exact
`http://<address>:5173` dashboard origin. It never creates a wildcard origin.
`PUBLIC_DEV_ORIGINS` can override that detected list, and it plus
`PUBLIC_EXTENSION_REGISTRATIONS_JSON` may be passed as non-secret process
values. The shell defaults to the current unpacked Grok development registration,
`chrome-extension://gegefkobmeapidelleohofpcigokggci` with app ID
`grok-automator`; override the variable when Chrome assigns another development
ID. The shell constructs a scrubbed environment containing no
provider credential, so `/health/live` and exact CORS preflights work while
provider-backed routes and `/health/ready` return a closed failure. It never
invokes Vercel CLI or pulls Vercel environment values.

```powershell
$env:PUBLIC_EXTENSION_REGISTRATIONS_JSON='[{"appId":"grok-automator","origin":"chrome-extension://gegefkobmeapidelleohofpcigokggci","environment":"development"}]'
npm run dev --workspace=apps/faceless-platform-api
```

## Routes

| Route                                                  | Access                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /health/live`                                     | Dependency-free liveness                                              |
| `GET /health/ready`                                    | All public/secret config, Neon, and Blob must be ready                |
| `GET /v1/platform-settings`                            | Public, database-backed SEO/theme document                            |
| `GET /v1/guides/:slug`                                 | Public current published structured tool guide                        |
| `GET /v1/auth/google/start?client=dashboard`           | Starts server-owned Google OIDC with state, nonce, and PKCE           |
| `GET /v1/auth/google/callback`                         | Validates callback, creates a session, and returns web success to `/` |
| `POST /v1/auth/extension-flows`                        | Creates a registered-origin, Google-only, PKCE-bound flow             |
| `GET /v1/auth/extension-flows/:id`                     | Returns only safe central-page flow status                            |
| `POST /v1/auth/extension-flows/:id/verify`             | Bound web session + CSRF + code authorizes v2, at most five attempts  |
| `POST /v1/auth/extension-flows/:id/exchange`           | Atomically exchanges an authorized flow once                          |
| `GET /v1/session`                                      | Authenticated account summary                                         |
| `POST /v1/auth/logout`                                 | Revokes the current application session                               |
| `POST /v1/checkout/sessions`                           | Authenticated, idempotent, trusted-catalog Stripe Checkout            |
| `POST /v1/webhooks/stripe`                             | Raw-body signature verification plus durable idempotent intake        |
| `GET /v1/internal/migrations`                          | Vercel Cron only; rejects browser requests                            |
| `GET /v1/admin/session`                                | Owner allowlist plus derived CSRF token                               |
| `GET /v1/admin/overview`                               | Aggregate user/entitlement/webhook counts                             |
| `GET /v1/admin/guides`                                 | List bounded guide summaries, including drafts                        |
| `POST /v1/admin/guides`                                | Create a future tool guide with revision zero                         |
| `GET`, `PUT /v1/admin/guides/:slug`                    | Read/update a guide with optimistic revision                          |
| `GET`, `PUT /v1/admin/platform-settings`               | Read/update SEO, colors, and bundled-font choices                     |
| `GET /v1/admin/users`                                  | Cursor/search user listing                                            |
| `POST /v1/admin/users/:id/ban`                         | Ban and revoke active sessions                                        |
| `POST /v1/admin/users/:id/unban`                       | Restore account sign-in eligibility                                   |
| `GET /v1/admin/entitlements`                           | Cursor/search entitlement listing                                     |
| `POST /v1/admin/entitlements/:id/revoke`               | Revoke active access                                                  |
| `GET /v1/admin/audit-events`                           | Immutable chronological audit listing with a signed opaque cursor     |
| `POST /v1/apps/:appId/usage/reservations`              | Atomically reserves server-authorized Run units                       |
| `POST /v1/apps/:appId/usage/reservations/:id/consume`  | Records a tentative, acceptance-bound queue handoff                   |
| `POST /v1/apps/:appId/usage/reservations/:id/finalize` | Charges a locally confirmed tentative handoff exactly once            |
| `POST /v1/apps/:appId/usage/reservations/:id/rollback` | Releases an accepted but unfinalized reservation idempotently         |
| `POST /v1/apps/:appId/usage/reservations/:id/cancel`   | Releases a never-accepted reservation idempotently                    |
| `POST /v1/apps/:appId/usage/authorize`                 | Temporary v1 immediate-consume compatibility through 2026-11-30 UTC   |

Admin mutations require `Content-Type: application/json` and the
`X-Faceless-CSRF` value returned by `/v1/admin/session`. A bootstrap email is
read only from the server-side Vercel secret after Google has verified the ID
token and `email_verified`; the callback atomically binds that email once to its
issuer, stable subject, and user. Every later decision reads the persisted
subject binding, never a request or session email. The optional subject env is
retained for backward compatibility. A user ban immediately makes the bound
administrator ineligible because normal active-session checks still apply.
There is no development or bearer-token admin bypass.

Guide content is strict structured data: section titles plus bounded heading,
paragraph, list, callout, and safe-link blocks. It has no raw HTML, Markdown, or
executable embed field. Public reads expose only published documents. Admin
create/update writes the current row, an append-only revision snapshot, and an
immutable audit event atomically; stale revisions return `409`.

## Extension authentication and Run authorization

An extension creates the PKCE verifier locally and sends only its S256
challenge. The API derives the caller from the exact registered
`chrome-extension://` Origin, creates a ten-minute opaque flow, and returns a
separate eight-character user code. For v2, Google sign-in happens first: the
callback creates a secure web session and atomically binds that verified user
to the still-pending flow without authorizing it. The clean central page returns
a CSRF token only to that exact bound cookie session. Authorization requires the
same session, CSRF header, and code shown in the extension; five incorrect
attempts make the flow terminal. The extension then proves possession of its
original verifier to atomically consume the flow and receive a separate
15-minute opaque application token. A caller that merely knows the code or
spoofs Origin headers cannot authorize another user's callback. Google tokens,
codes, secrets, and provider subjects never enter the extension.

The OAuth allocation transaction row-locks the pending extension flow and
allows only one Google allocation for that flow. Callback completion reports a
new binding, an existing binding, or an unavailable flow as distinct outcomes.
A competing callback never replaces or denies an existing binding, and callback
cancellation/error denial affects only an unbound pending v2 flow. V1 keeps its
original pending-flow denial behavior during the compatibility window.

Protocol v1 is preserved only for flows created without `schemaVersion` before
the exclusive `2026-11-30T00:00:00.000Z` sunset. Those flows retain their exact
create/status/exchange shapes and receive `Deprecation` and `Sunset` headers.
Persisted `protocol_version` rejects cross-protocol exchange, so this bounded
compatibility path does not weaken the v2 bound-session gate.

Flow allocation, verification, polling, OAuth allocation, and exchange also
pass layered database-backed limits. Stored bucket and allocation keys are
server-keyed digests; raw client addresses are not persisted. Concurrent flow
caps are serialized before their database count is evaluated. If the limiter
or migration is unavailable, authentication fails closed.

Release `0.2.3` corrects the first-account persistence path discovered during
OAuth incident tracing. The previous single writable-CTE statement could insert
a first user while a sibling update in that same statement could not see the
new row under PostgreSQL data-modifying CTE snapshot rules. Session creation
then returned no row and the callback failed. The corrected adapter performs
the user, identity, and session work in an ordered Neon transaction. Concurrent
first-login handling remains bounded by database uniqueness constraints, and a
successful dashboard callback returns to the implemented `/` route.

Callback failure logs are stage-coded and non-secret so production operators
can distinguish provider exchange, claim validation, persistence, and flow
completion failures without logging Google codes or tokens, cookies, PKCE
material, or stable provider subjects.

The production incident verification used a fresh registered-extension flow.
The owned browser page reached **Account connected**, the PKCE exchange returned
`200 authorized` with an opaque application access token, and a replay returned
`409 auth_flow_consumed`. No token is recorded in this repository. Dashboard
OAuth also returns to `/`. An earlier denied flow cannot be revived; the user
must start a new request from the extension.

Every Grok Run reservation binds that application token to its original app and
extension Origin, verifies the user is active, and re-evaluates a current
`extension:grok-automator` or `bundle:all-extensions` entitlement in Neon. The
client cannot assert its plan, capability, quota, or entitlement. The quota lock
is acquired in a separate transaction command so the later query receives a
fresh PostgreSQL snapshot. Active reservations, tentative acceptances, and
consumed units count against the daily limit. Queue acceptance with a unique
`acceptanceId` creates a refundable hold. After the local idempotent commit/query
confirms the group, the extension finalizes the hold; a missing group rolls it
back, and a never-accepted reservation is cancelled. Finalize and rollback are
mutually exclusive, acceptance-bound, audited, and idempotent;
expired tentative holds auto-roll back. Temporary v1 `/usage/authorize` uses the
same atomic reservation but immediately consumes it under the request
idempotency key. This is server-side accounting, not a claim of tamper-proof DRM
for local DOM execution. Revocation and bans fail closed on the next operation.

## Stripe boundary

Checkout accepts a product slug, never a client-authored Stripe Price or
entitlement. The slug resolves through `STRIPE_PRICE_CATALOG_JSON`. The route
requires an `Idempotency-Key`, uses Stripe-hosted Checkout, and deliberately
omits `payment_method_types` so Stripe Dashboard controls dynamic payment
methods.

The webhook verifies `Stripe-Signature` against the untouched request body, then
persists the event once by Stripe event ID. Events are stored with `pending`
status. **This scaffold does not grant a license yet.** A later audited
fulfillment worker must map paid/refunded/subscription events to purchases and
entitlements before commerce can pass the release gate.

## Server-side migration

`vercel.json` schedules `/v1/internal/migrations` daily. Vercel Cron supplies
`Authorization: Bearer $CRON_SECRET` from the platform; the secret and Neon URL
never leave Vercel. The runner reads `schema_migrations`, builds a plan containing
DDL only for unapplied versions, but only after beginning a `READ COMMITTED` Neon
transaction and acquiring a Postgres advisory lock. The explicit isolation is
deliberate: the registry statement gets a fresh snapshot after a waiting runner
acquires the lock, so concurrent first-run invocations cannot plan against the
same stale snapshot. An already-current daily run executes retention queries
without replaying `ALTER`, `DROP`, or index creation. Migration
`0002_extension_platform` adds extension flows, application sessions, and
idempotent usage decisions without exposing `DATABASE_URL`. Migration
`0003_brand_rename` changes only exact legacy `Faceless Automations` values in
`seo.siteTitle` and `seo.openGraphTitle` to
`Paks Tools Faceless automations`. It preserves descriptions, theme data, and
custom title values, increments the settings revision only when a title changes,
and becomes a no-op after its migration claim is recorded.

Migration `0004_security_lifecycle` adds privacy-preserving fixed-window rate
buckets, bound initiator-verification state, concurrent-flow allocation keys,
reservation-saga fields, append-only usage transition events, and the composite
audit chronology index. Each authenticated daily invocation also expires stale
reservations, rolls back expired tentative acceptances, and removes aged
terminal OAuth/extension flows, usage records/events, sessions, and rate buckets.
The retention statements are bounded, repeatable, and run under the same
serialized migration invocation.

Migration `0005_guide_cms` adds one-time Google admin bindings, current tool
guides, append-only guide revision snapshots, and the published Grok Automator
guide seed. The generic admin create route supports future tools without a code
or migration change. Unique normalized-email, stable-subject, and user keys
prevent a second Google identity from replacing an existing administrator.

The source migration set is current through `0005_guide_cms`. Use the Vercel
Cron dashboard's **Run** control after an authorized deployment and verify the
returned migration version without downloading `DATABASE_URL`. The SQL file
under `db/migrations` is an auditable mirror; the bundled runtime migration is
the production execution path. A successful migration does not make
`/health/ready` return `200` while unrelated required provider/admin
configuration remains absent. Readiness also verifies that the latest applied
migration exactly equals `0005_guide_cms` and returns only generic
`not_ready` when the database is behind, ahead, absent, or unreadable.

## Deployment

The production API target is
`https://paks-api.vercel.app`. Dashboard browser calls use the
same-origin `https://paks-tools.vercel.app/v1/*` gateway; extensions
call the upstream API directly with separate short-lived app sessions. The
stable and immutable deployment identifiers, endpoint evidence, region record,
and incomplete gates are in the
[Vercel deployment record](../../.build_plans/VERCEL_DEPLOYMENT.md).

Run the workspace gates from the monorepo root:

```powershell
npm run ci --workspace=apps/faceless-platform-api
```

For `0.2.6`, the local API gate covers the structured guide CMS, stable-subject
admin bootstrap, atomic revision history/audit writes, shared protocol versions,
separated-lock quota transactions, idempotent terminal transitions, user-code lockout,
privacy-keyed rate windows, retention, migration parity, chronological cursors,
and bounded Node request reads. This is source/build evidence only; no `0.2.6`
deployment or production migration run is claimed here.

For `0.2.3`, this gate passed 7 test files and 26 tests, including a regression
that enforces contiguous SQL placeholders. The clean Ready deployment is
`dpl_5scMFAw976ScifQCAdZFLFCGRCKF` at immutable host
`paks-bvz2tyxqn-atmt.vercel.app`; the stable production alias remains
`https://paks-api.vercel.app`. The fresh dashboard callback and registered-
extension authorization/exchange journey pass. Entitlement and paid Run proof
remain separate gates.

The live scaffold is not a platform production-readiness claim. Current public
evidence is liveness `200`, platform settings `200`, anonymous admin `401`, and
intentional readiness `503`. Successful Google, authenticated-cookie/admin,
Stripe signature/fulfillment, entitlement, private delivery, and reconciliation
journeys remain separate gates.

Extension sign-in and Run remain inactive until the deployed project has the
exact Google Web OAuth client/callback and a real active entitlement created by
an audited server-side fulfillment or admin process. The extension registration
and app-session/usage schema are deployed; `0005_guide_cms` remains a
source release until an authorized deployment and migration run are verified.
A successful Google redirect still never creates paid access.
