# Paks Tools Faceless automations Vercel deployment record

> **Status: LIVE SCAFFOLD — SOURCE RELEASE PENDING — NOT PROVIDER READY**  
> **Environment:** Vercel production  
> **Read-only recheck:** 2026-08-20 +08:00  
> **Sensitive environment update:** 2026-08-20 +08:00  
> **Companion gates:** [`AUDIT_PLAN.md`](AUDIT_PLAN.md)

## Active PAKS deployment checkpoint — 2026-08-20

The owner authorized the two administrator bootstrap emails to be configured.
They were added to the exact `paks-api` Production environment under the
`sensitive` `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` key; the value was not pulled or read
back, and metadata-only verification confirmed the project, target, and type.
Vercel environment changes apply to a subsequent deployment; this record does
not treat the currently served API deployment as administrator-enabled.
No candidate, deployment, migration, promotion, cleanup, or alias mutation was
performed because coordinated compatibility, readiness, Git parity, and
candidate-qualification gates remain open. Exact project/deployment metadata
and public endpoints were otherwise inspected without credentials.

| Surface                           | Project ID                         | Stable URL                      | Current immutable deployment                   | Deployment ID                      |
| --------------------------------- | ---------------------------------- | ------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Dashboard and browser API gateway | `prj_2bs4lFlzvcrOhVP1HOpLUywdkTS7` | `https://paks-tools.vercel.app` | `https://paks-tools-mh1kradki-atmt.vercel.app` | `dpl_CFLgg3i37twKJNvRSP52vcBPrFuF` |
| Upstream and extension API        | `prj_xJn4iaI7u6pDQnzhFxBuFbVI4W8V` | `https://paks-api.vercel.app`   | `https://paks-bmaptxrlz-atmt.vercel.app`       | `dpl_DR8YUFTCubqLQEHzSMPSomC2owTj` |

Both projects belong to exact Vercel organization
`team_8bOGJgNqmfKYV3jeay0uq8OO`. Root `vercel.dashboard.json` and
`vercel.api.json` are the only canonical release configs. The preserved
`apps/faceless-platform-api/vercel.json` is non-canonical and must not be used by
root release commands.

### Current artifact inspection

| Surface   | Observed Function inventory | Config evidence                                                      | Decision                                                 |
| --------- | --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| API       | Exact `api/index`           | PAKS rewrites, 30-second Function, daily migration cron              | Expected live scaffold                                   |
| Dashboard | Unexpected `api/index`      | PAKS upstream rewrites and SPA fallback, but root API was also built | Must be replaced by a qualified empty-Function candidate |

The dashboard alias remains reachable, but its unexpected Function is not an
acceptable release artifact. Root `0.3.5` tooling stages only allowlisted
dashboard build inputs in an isolated directory without root `api/`, writes the
reviewed dashboard config as root `vercel.json`, rejects any non-empty dashboard
Function inventory, and requires `--skip-domain` candidate qualification before
promotion. It rejects common secret/key artifacts and may remove a failed
first-inspection dashboard candidate only when exact local, unpromoted evidence
binds the deployment to the intended organization, project, source, config, Git
revision, and migration. Arbitrary unaliased deployments remain rollback assets.

The API release order is candidate → migrate → qualify → promote. The migration
phase requires Vercel's live project state to bind the canonical migration cron
path, schedule, deployment ID, and definition host only to the requested READY,
production-target, unaliased candidate while a different prior deployment still
serves production. It records an intent marker before invoking server-side
`vercel crons run`, rechecks the same binding immediately afterward, polls only
the candidate deployment's readiness, rechecks the binding again, and records
the version, Vercel invocation time, and result. No `CRON_SECRET` is downloaded.
Because the CLI cron command has no deployment selector, these checks narrow but
cannot eliminate provider-side TOCTOU; ambiguity fails closed. Release actions
sharing one checkout/evidence directory use an exclusive per-surface lock across
candidate IDs, while evidence uses an additional per-deployment lock, a synced
same-directory temporary file, atomic replacement, and directory-entry syncing
where supported. This lock is not distributed across clones, hosts, or CI;
release authority must remain with one operator/checkout. Existing or stale
locks fail closed until an operator confirms the prior process and
external-action outcome. An interrupted migration retry
never reinvokes the cron: it reproves the candidate identity and exact binding,
then records explicit recovery only after candidate-only readiness succeeds. A
production-target API candidate may be scheduled before explicit migration, so
validation records its cron exposure and API cleanup is always refused.
Candidate removal cannot prove or reverse a shared-database mutation. Migration
SQL must remain compatible with the prior stable API until promotion or rollback
is complete. Promotion writes intent before invocation, retries reconcile exact
already-promoted provider state without invoking twice, and a bounded poll
records success only after fresh project state proves `targets.production` plus
the canonical cron deployment ID and definition host bind the candidate. This
source remediation has not been executed or deployed.

### Current source and migration boundary

| Component          | Target source    | Live evidence boundary                                 |
| ------------------ | ---------------- | ------------------------------------------------------ |
| Dashboard          | `0.2.6`          | Current stable deployment predates the target source   |
| Platform API       | `0.2.6`          | Current stable deployment predates auth/CMS target     |
| Platform contracts | `0.1.2`          | No independent deployment                              |
| Grok Automator™    | `0.0.13`         | No CWS upload/submission/publication authorized        |
| Neon migration set | `0005_guide_cms` | Source exists; applied production parity is unverified |

Readiness in target API source fails closed when the applied migration version
is behind. Because production currently returns `503 not_ready` and no
authorized migration evidence was produced, this record does not infer that
`0005` is applied.

The target is a coordinated, dual-protocol cutover rather than an API-only
release. First create the dual-protocol API candidate, run its guarded migration,
and qualify it; create and qualify the matching dashboard candidate; then
coordinate promotion. Exact legacy v1 auth and usage responses remain available through
`2026-11-30T00:00:00Z` with deprecation/sunset headers so already installed
extensions continue to work. After the coordinated web release, roll out Grok
Automator™ `0.0.13`,
measure minimum-version adoption and residual v1 traffic, then disable v1 at
the sunset. The release validator rejects a stale or less-than-30-day legacy
window. No single surface may be promoted on an assumption that another surface
or client version is already compatible; rollback behavior must be exercised
against both the released legacy client and `0.0.13` first.

### Public endpoint recheck

| URL                                                  | 2026-08-20 observed result      |
| ---------------------------------------------------- | ------------------------------- |
| `https://paks-api.vercel.app/health/live`            | `200`, `{"status":"live"}`      |
| `https://paks-tools.vercel.app/health/live`          | `200`, `{"status":"live"}`      |
| `https://paks-api.vercel.app/health/ready`           | `503`, `{"status":"not_ready"}` |
| `https://paks-tools.vercel.app/health/ready`         | `503`, `{"status":"not_ready"}` |
| `https://paks-api.vercel.app/v1/platform-settings`   | `200`, schema `1`, revision `1` |
| `https://paks-tools.vercel.app/v1/platform-settings` | `200`, schema `1`, revision `1` |
| `https://paks-tools.vercel.app/v1/admin/session`     | `401 unauthorized`              |

This proves only liveness, public settings, same-origin gateway forwarding, and
anonymous administrator denial. It does not prove target-source deployment,
auth v2, migration `0005`, administrator enrollment, the dynamic guide/CMS,
Stripe fulfillment, licensing, downloads, or live extension behavior.

### Current release blockers

- Audit-start HEAD `c4527a5bb4eff53359af7fcc587f407935a0855d` had 62 tracked
  changes and 185 untracked paths; deployed Git parity remains unresolved.
- No qualified skip-domain candidate exists for either target source release.
- No authorized candidate has proven that Vercel binds the cron deployment ID
  and definition host to a `--target production --skip-domain` candidate while
  leaving `targets.production` on the distinct prior stable deployment. Current
  evidence proves only the project JSON shape; different provider behavior keeps
  migration fail-closed and requires release-design review.
- The dashboard must prove zero Vercel Functions before promotion.
- The API must prove exact `api/index`, rewrites, migration cron, and
  candidate-bound migration evidence followed by `200 ready`; readiness includes
  applied-migration parity and provider checks. Migration `0005` cannot by itself
  satisfy readiness while required Stripe variables remain absent.
- API/dashboard promotion must be coordinated, the temporary v1 window must
  pass the release guard, and both legacy-client continuity and `0.0.13`
  adoption/rollback behavior must be evidenced before the v1 sunset.
- Preview database/provider isolation, region approval, Neon restore, Google
  administrator enrollment for both configured bootstrap identities, Stripe
  provider configuration (`STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, and
  `STRIPE_PRICE_CATALOG_JSON`), fulfillment/reconciliation, private delivery,
  observability, final extension ID, licensed live Grok, CWS state, and owner GO
  remain external activation gates. Project metadata confirms the three Stripe
  names are not configured; `ADMIN_GOOGLE_SUBJECTS` remains an optional legacy
  subject path because the sensitive bootstrap-email key is now configured for
  the target API. Readiness must not be weakened and no placeholder values may
  be invented.

## Historical checkpoint — 2026-08-17

The remainder of this document is immutable evidence from the original
Faceless-host deployment checkpoint. Its old hostnames, deployment IDs,
migration `0002`, and provider state are retained for audit history and are not
the active PAKS deployment record above.

### Historical deployment inventory

| Surface                           | Stable URL                                    | Immutable deployment                                     | Vercel deployment ID               | State              |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------- | ---------------------------------- | ------------------ |
| Dashboard and browser API gateway | `https://faceless-automations.vercel.app`     | `https://faceless-automations-9042htsyw-atmt.vercel.app` | `dpl_9ZAwWuShfQFegKSYzebD4EHzikSV` | Production / Ready |
| Upstream and extension API        | `https://faceless-automations-api.vercel.app` | `https://faceless-automations-14os2b2qh-atmt.vercel.app` | `dpl_4MxC9bwqmn1u4V78QobEEydNiGnC` | Production / Ready |

Both deployments report their server Function in Vercel region `iad1`. The
production Neon and Private Blob resources are in `sin1`; region placement and
its latency/cost implications remain an explicit `PLAT-04` review item rather
than an assumed success.

## Backing-resource checkpoint

| Resource            | Current state                                                                       | Evidence boundary                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Neon Postgres       | Production resource connected; schema is current through `0002_extension_platform`  | Public settings read succeeds; migration application was verified by the release operator |
| Vercel Private Blob | Private production store connected                                                  | Credential remains server-only; customer download delivery is not active                  |
| Vercel environment  | Public origins plus server-only configuration are attached to their scoped projects | No secret values are recorded in source, this document, or audit output                   |

The applied migration proves the current schema exists. It does not prove
backup/restore, preview isolation, retention, deletion, or disaster-recovery
gates.

## Live endpoint evidence

All responses below were observed or rechecked on 2026-08-17 without
authentication or secret-bearing request data.

| URL                                                                | Observed                                | Interpretation                                                                   |
| ------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------- |
| `https://faceless-automations-api.vercel.app/health/live`          | `200`, `{"status":"live"}`              | Upstream Function is reachable                                                   |
| `https://faceless-automations.vercel.app/health/live`              | `200`, `{"status":"live"}`              | Dashboard same-origin health rewrite reaches the API                             |
| `https://faceless-automations-api.vercel.app/health/ready`         | `503`, `{"status":"not_ready"}`         | Expected fail-closed state while required provider/admin configuration is absent |
| `https://faceless-automations.vercel.app/health/ready`             | `503`, `{"status":"not_ready"}`         | Same fail-closed state is preserved through the dashboard gateway                |
| `https://faceless-automations-api.vercel.app/v1/platform-settings` | `200`, schema version `1`, revision `0` | Neon-backed public metadata/theme read succeeds                                  |
| `https://faceless-automations.vercel.app/v1/platform-settings`     | `200`, schema version `1`, revision `0` | Same-origin `/v1` gateway forwards the public read                               |
| `https://faceless-automations.vercel.app/v1/admin/session`         | `401 unauthorized`                      | Anonymous administration fails closed                                            |

The provider recheck also observed both direct and dashboard-gateway
`/v1/auth/google/start?client=dashboard` return `503 service_unavailable` rather
than redirecting to Google. Vercel environment metadata confirms that
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and
`ADMIN_GOOGLE_SUBJECTS` are absent from production; secret values were neither
retrieved nor exposed. The existing `OAUTH_TRANSIENT_KEY` and
`SESSION_TOKEN_PEPPER` are production-scoped, so the first broken boundary is
the incomplete Google provider configuration.

The expected `503` readiness result is not an outage claim and is not a
production-readiness pass. Liveness and selected public/database routes are
working while Google, Stripe, and administrator-dependent capabilities remain
deliberately unavailable.

## Browser QA

The live stable dashboard URL passed the following browser checks:

- landing page at desktop and mobile viewport sizes;
- `/auth` exposes Google as the only sign-in option;
- `/admin/platform` keeps protected platform controls fail-closed without an
  authenticated server-authorized administrator; and
- an invalid `/auth/extension/:flowId` request reaches the application shell and
  resolves to a fail-closed invalid-flow state.

This QA does not prove a successful Google callback, authenticated administrator
mutation, Stripe payment, entitlement grant, extension Run, private download, or
Chrome Web Store journey.

## Gate decisions from this checkpoint

| Gate      | Result        | Reason                                                                                                |
| --------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `PLAT-02` | `PASS`        | Dashboard and API are separate Ready production Vercel deployments with stable and immutable URLs     |
| `PLAT-05` | `PASS`        | Liveness/readiness responses are minimal and disclose no dependency or secret material                |
| `PLAT-04` | `IN PROGRESS` | Function and persistence regions are recorded but intentional co-location/latency approval is open    |
| `PLAT-06` | `IN PROGRESS` | Immutable deployments are recorded; audited Git commit parity is not yet recorded                     |
| `DATA-01` | `IN PROGRESS` | Production is current through migration `0002`; empty-database reproduction evidence remains separate |
| `AUTH-01` | `IN PROGRESS` | Live UI exposes Google only, but no successful provider journey exists                                |
| `AUTH-05` | `IN PROGRESS` | Same-origin gateway is live; an authenticated secure-cookie journey is not yet available              |

## Required follow-up

- Create and scope the Google Web OAuth client with exact callback
  `https://faceless-automations-api.vercel.app/v1/auth/google/callback`, consent
  configuration, and production administrator subject allowlist in Vercel.
- Configure Stripe restricted credentials, trusted Product/Price mappings, and
  webhook verification, then implement audited webhook-to-entitlement
  fulfillment and reconciliation.
- Prove authenticated dashboard and extension session journeys, direct and All
  Apps entitlements, bans/revocations, and denial recovery.
- Implement and verify private digital-product delivery.
- Exercise Neon backup/restore and approve the Vercel/Neon/Blob region strategy.
- Record audited Git commit parity for both immutable deployments.
- Build and verify the final Grok Automator™ ZIP before any authorized Chrome Web
  Store submission.

Until those checks pass, `/health/ready` must remain `503` and the platform must
not be described as production-ready for authentication, payments, licensing,
administration, or fulfillment.
