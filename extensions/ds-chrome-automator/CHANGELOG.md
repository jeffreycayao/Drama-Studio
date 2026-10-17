# Changelog

All notable monorepo infrastructure changes are documented here. Product-level
changes remain in each application's own changelog.

## [0.3.5] - 2026-08-20

- Added a generic, database-backed tool-guide CMS with a published public route,
  a protected administrator list/editor/create workflow, safe structured
  document blocks, optimistic revisions, and immutable guide/audit history. The
  first managed document is the Grok Automator™ manual at
  `https://paks-tools.vercel.app/guide/grok-automator`; future tool guides can be
  created without a source-code or database migration change.
- Added one-time administrator enrollment from the sensitive, API-only
  `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` Production variable. A configured, verified
  Google email may claim its identity once; subsequent authorization is bound
  to the persisted Google issuer/subject and active user, while the legacy exact
  subject allowlist remains an optional compatibility path. No email allowlist
  or provider identity is exposed to the dashboard or extension.
- Advanced the guarded release migration target to `0005_guide_cms` and updated
  the living release/audit plans. The two requested bootstrap emails were added
  to the `paks-api` Vercel Production environment as one sensitive value without
  pulling it locally. No deployment, database migration, or store submission was
  performed.

## [0.3.4] - 2026-08-20

- Added guarded staged Vercel release tooling bound to the exact PAKS team,
  dashboard project, API project, and canonical root configuration for each
  surface. External candidate, API migration, qualification, promotion, and
  cleanup commands require an explicit `--execute`; no deployment or migration
  was performed by this change.
- Made production-target candidates use `--skip-domain` from a surface-specific
  allowlisted snapshot with a generated root `vercel.json`, PAKS metadata, and
  no `--local-config`; common secret/key artifacts are rejected before staging.
  Qualification then requires exact Function inventory, rewrites, headers,
  cron configuration, liveness, fail-closed readiness, Git/source/config
  identity, and migration-set identity before promotion.
- Added automatic exact-project cleanup when a newly created dashboard
  candidate fails inspection. Cleanup requires exact local evidence for the
  same unpromoted dashboard candidate, bound to organization, project, source,
  config, Git revision, and migration; arbitrary older deployments remain
  rollback assets and cannot be removed through this tool.
- Added an API-only migration phase that accepts only exact local candidate
  evidence, requires the project cron deployment ID and host to point at the
  unaliased candidate while a different deployment remains stable, checks that
  binding before and after `vercel crons run`, polls readiness through the exact
  deployment selector, and persists version/timestamp/result evidence. It never
  downloads `CRON_SECRET` and refuses ambiguous bindings. A production-target
  API candidate is marked cron-exposed during validation and is never eligible
  for cleanup, even before an explicit migration, because provider scheduling
  may already have touched the shared database and candidate removal is not a
  database rollback.
- Made release operations process-exclusive across different candidate IDs
  within one shared checkout/evidence directory using a per-surface lock, while
  candidate evidence retains an additional per-deployment lock. This is not a
  distributed cross-host lock. Synced same-directory temporary writes, atomic
  replacement, and supported directory-entry syncing make evidence
  crash-conservative. Existing or stale locks fail closed for manual review.
- Added no-reinvoke recovery for an interrupted API migration: retries reprove
  the exact candidate identity and cron/production binding, poll candidate-only
  readiness, and retain a null invocation timestamp with explicit recovery
  evidence instead of triggering the cron twice.
- Made API promotion success require a fresh project-state postcheck proving
  both `targets.production` and the canonical cron deployment ID and definition
  host bind the exact promoted candidate. Promotion intent is persisted before
  invocation, and retries reconcile exact provider state through a bounded
  convergence poll without promoting twice.
- Recorded that the required pre-migration Vercel state for a skip-domain
  production-target candidate has not yet been live-qualified. If cron binding
  does not move to the candidate while `targets.production` remains on the
  prior stable deployment, the release fails closed.
- Prevented dashboard candidates from including the root `api/` entrypoint and
  made both local output and remote candidate inspection reject an unintended
  `api/index` Function. The currently served dashboard deployment still
  contains that Function and remains pending a separately authorized release.
- Added CI-enforced Vercel configuration-drift and release-tooling tests. Root
  `vercel.dashboard.json` and `vercel.api.json` are the canonical configs;
  uncertain workspace-local Vercel files are preserved but never selected by
  root release commands.
- Refreshed the living build plans for the 2026-08-20 source state, migration
  `0004_security_lifecycle`, remediated static-security findings, unresolved
  dirty-worktree/Git parity, and remaining provider/store activation gates.

## [0.3.3] - 2026-08-17

- Migrated the configured Vercel platform identity from the original Faceless
  project hostnames to the interim PAKS topology: `paks-tools.vercel.app` for the
  dashboard and browser gateway, and `paks-api.vercel.app` for the upstream
  and extension API.
- Defined `paks.tools` and `api.paks.tools` as the future custom-domain
  targets without treating the unpurchased domain as an active production
  origin.
- Coordinated the dashboard, API, extension, Google OAuth callback, tests,
  release verification, and living deployment plans around one staged
  cutover. No secret was added to source or materialized locally.

## [0.3.2] - 2026-08-17

- Established PAKS LLC as the active legal owner in repository governance and
  Grok Automator™ release policy. The repository-specific instruction
  supersedes the legacy publisher signature in the installed WXT skill template
  while preserving older changelog and audit records as historical evidence.
- Advanced the living build and audit plans for the `0.0.8` legal-owner release;
  dashboard and API product versions are unchanged.

## [0.3.1] - 2026-08-16

- Renamed the private GitHub repository to
  `Chris.dev-faceless-automations-monorepo`, updated the local `origin`, and
  aligned the root npm workspace identity and documentation. Application
  workspace versions are unchanged.

## [0.3.0] - 2026-08-16

- Activated `apps/faceless-platform-api` `0.2.0` as a strict TypeScript, Node.js 24
  Vercel Function workspace with fail-closed environment validation, Neon
  migrations, Private Blob integration, Google-only OIDC/session boundaries,
  Stripe Checkout/webhook intake, entitlement-aware extension authorization,
  administrative APIs, tests, source scans, build verification, and root CI
  coverage.
- Added separate Vercel project configurations for the dashboard and API. The
  two production deployments are live at their stable aliases, with immutable
  deployment IDs, same-origin gateway rewrites, and public endpoint evidence
  recorded in `.build_plans/VERCEL_DEPLOYMENT.md`.
- Enforced Vercel-only ownership for credentials and secrets, prohibited local
  secret materialization, and added explicit localhost/private-LAN development
  commands plus exact-origin validation for dashboard and extension clients.
- Expanded the dashboard to `0.2.1` with server-authorized administration for
  metadata, approved colors and fonts, users, bans/restores, entitlement
  revocation, and immutable audit activity. No local administrator bypass was
  added. Browser authentication and admin requests use a same-origin web `/v1`
  gateway that forwards to the separate upstream API, preserving secure cookie
  sessions without broadening CORS or exposing server credentials.
- Integrated Grok Automator `0.0.5` with the deployed-origin defaults and a
  server-authoritative `automation.run` decision before any prompt group is
  queued; all tools remain visible and signed-out Runs still enter the
  Google-only one-time flow.
- Completed a read-only, clean-room audit of the Pancake Toolsets reference and
  recorded only reusable architecture patterns and explicitly rejected
  product/IP-specific behavior in `.build_plans/REFERENCE_PORT_AUDIT.md`.
- Provisioned the Vercel project associations, a production Neon resource, and
  a private Blob store without copying their credentials into the workspace.
  Neon migrations are applied through `0002_extension_platform`; liveness and
  public settings return `200`, anonymous admin returns `401`, and readiness
  intentionally remains `503 not_ready`.
- Completed live desktop/mobile landing, Google-only auth, protected admin, and
  invalid extension-flow browser QA without claiming a provider-side outcome.
  Google OAuth credentials, administrator subjects, Stripe credentials/catalog,
  webhook fulfillment, and production provider journey evidence remain open
  release blockers.

## [0.2.2] - 2026-08-16

- Added active master and success-audit plans under `.build_plans` for the
  Vercel, Neon, Private Blob, Stripe, Google SSO, paid-extension, All Apps, and
  digital-product platform.
- Defined evidence-based milestone gates covering identity, payments,
  entitlements, downloads, security, privacy, accessibility, WXT/CWS release
  integrity, deployment, reconciliation, and production GO/NO-GO decisions.
- Recorded unresolved owner decisions and the honest non-deployable platform
  baseline without marking unverified systems as complete.

## [0.2.1] - 2026-08-15

- Standardized product UI icons on locally bundled, statically imported Tabler
  Vue and React components, with repository policy, license notices, and build
  verification that reject legacy or remote icon runtimes.
- Created the owner-controlled Google Cloud project `faceless-automations` and
  documented the remaining domain, callback, audience, secret-management, and
  backend decisions without creating credentials or a fake deployable service.
- Prepared the central Google-only extension contract and PKCE-bound session
  boundary while preserving fail-closed builds until owned web/API origins are
  configured.

## [0.2.0] - 2026-08-14

- Activated the TypeScript, React, and Tailwind landing page with a fail-closed
  Google-only central sign-in shell.
- Added a provider-neutral TypeScript/Zod platform contract package and a
  documented, deliberately non-deployable backend architecture boundary.
- Added shared Instrument Serif, Manrope, and IBM Plex Mono typography with
  locally bundled WOFF2 assets, fallbacks, licensing, and production checks.
- Extended root scripts and hosted CI to typecheck, lint, test, build, and
  verify the new web and shared-package workspaces alongside Grok Automator.
- Added repository rules requiring Terser, CSS minification, context-safe WXT
  chunking, no source maps, and no remote runtime font assets.
- Integrated Grok Automator `0.0.1`, which removes the inherited service
  identity and email-only auth dependency while preserving local automation.

## [0.1.1] - 2026-08-14

- Made the installed `$sys001x-wxt` skill mandatory for all current and future
  WXT extension work in the monorepo.
- Documented the canonical local skill path and fail-closed behavior when the
  skill cannot be loaded. The Grok Automator product remains at `2.7.0`.

## [0.1.0] - 2026-08-14

- Established the private npm-workspaces monorepo for the Faceless Automations
  collection.
- Relocated the maintainable Grok Automation `2.7.0` source to
  `apps/grok-automator` without changing extension behavior or version.
- Added `apps/faceless-automation-dashboard` as an explicit, non-deployable
  placeholder for a future collection dashboard.
- Centralized Node/npm versions, dependency locking, CI, formatting, audits,
  build verification, browser smoke testing, and release ZIP commands at the
  repository root.
- Configured hosted CI to upload the verified release ZIP from WXT's hidden
  output directory.
- Removed the original unpacked extension, recovery-tool output, decompiled
  bundles, nested Git history, generated output, and workspace-local installs.
- Added repository-wide README, AGENTS, changelog, ignore, and line-ending rules.
