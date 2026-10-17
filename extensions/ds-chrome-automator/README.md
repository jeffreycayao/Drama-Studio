# Paks Tools Faceless automations

Private npm-workspaces monorepo for the **Paks Tools Faceless automations** application
collection. The repository is named `Chris.dev-faceless-automations-monorepo`;
applications are independently versioned while installation, CI, dependency
locking, shared contracts, and brand assets are owned at the repository root.

The active platform roadmap and evidence-based release gates live in
[`.build_plans/MASTER_PLAN.md`](.build_plans/MASTER_PLAN.md) and
[`.build_plans/AUDIT_PLAN.md`](.build_plans/AUDIT_PLAN.md). These are living
documents and must be updated as product, commerce, deployment, or audit scope
changes.

## Applications

| Workspace                                                                            | Status            | Purpose                                                                        |
| ------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------ |
| [`apps/grok-automator`](apps/grok-automator/README.md)                               | Active — `0.0.13` | WXT/Vue MV3 Grok automation with server-authorized Run                         |
| [`apps/faceless-automation-dashboard`](apps/faceless-automation-dashboard/README.md) | Active — `0.2.6`  | React/Tailwind landing, dynamic guides, Google connection, and protected admin |
| [`apps/faceless-platform-api`](apps/faceless-platform-api/README.md)                 | Active — `0.2.6`  | Node.js/TypeScript Vercel API for identity, guides, commerce, access and ops   |

## Shared packages

| Workspace                                                              | Purpose                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`packages/brand`](packages/brand/README.md)                           | Locally bundled typography and shared design tokens                 |
| [`packages/platform-contracts`](packages/platform-contracts/README.md) | Provider-neutral Zod schemas and TypeScript API contracts (`0.1.2`) |

## Requirements

- Node.js 24, as pinned by [`.nvmrc`](.nvmrc)
- npm 11.16 or a lockfile-compatible npm 11 release
- Chrome for Testing or Chromium for automated extension smoke testing;
  regular Chrome remains supported for manual **Load unpacked** testing

Install dependencies once, from the repository root:

```powershell
npm ci
```

Do not run workspace-local installs or create nested lockfiles. The root
`package-lock.json` is the only dependency lock for the monorepo.

## Development commands

| Command                                                     | Purpose                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                                               | Start the Grok Automator™ WXT development server                                    |
| `npm run dev:api`                                           | Start the no-secret API shell on loopback port 8787                                 |
| `npm run dev:dashboard`                                     | Start the landing and central-auth shell locally                                    |
| `npm run dev:api:lan`                                       | Expose the no-secret API shell on the private LAN                                   |
| `npm run dev:dashboard:lan`                                 | Expose the dashboard dev server on the private LAN                                  |
| `npm run dev:grok:lan`                                      | Expose WXT development assets on the private LAN                                    |
| `npm run check`                                             | Run formatting, types, lint, tests, source-policy checks, and contract verification |
| `npm run build`                                             | Build contracts, API, dashboard, and the Chrome extension                           |
| `npm run verify`                                            | Run the full non-packaging production verification chain                            |
| `npm run smoke:grok -- "C:\path\to\chrome-for-testing.exe"` | Mount the built side panel in a disposable automation profile                       |
| `npm run zip`                                               | Build the Chrome release ZIP                                                        |
| `npm run verify:zip`                                        | Verify ZIP determinism, tree, version, local fonts, and legal banners               |
| `npm run verify:vercel-config`                              | Verify exact PAKS Vercel project/config bindings and fail on drift                  |
| `npm run test:vercel-tooling`                               | Test staging, migration binding, readiness, config, and cleanup guards              |
| `npm run release:vercel -- plan --surface dashboard`        | Print a verification-only dashboard release plan; no Vercel action                  |
| `npm run release:vercel -- plan --surface api`              | Print a verification-only API release plan; no Vercel action                        |
| `npm run audit`                                             | Audit the root and all workspaces                                                   |
| `npm run ci`                                                | Run the complete monorepo and Chrome release-integrity pipeline                     |

The unpacked extension is generated at
`apps/grok-automator/.output/chrome-mv3`. Load it from `chrome://extensions`
using **Developer mode → Load unpacked**. The dashboard production output is
generated at `apps/faceless-automation-dashboard/dist`.

Chrome 137 and newer do not honor the `--load-extension` automation flag in the
regular branded browser. Point `smoke:grok` at Chrome for Testing or Chromium;
continue using regular Chrome for the manual **Load unpacked** workflow above.

## Typography

| Role                            | Font             | Guidance                                                |
| ------------------------------- | ---------------- | ------------------------------------------------------- |
| Display and narrative headings  | Instrument Serif | Large sizes, restrained weight, tight tracking          |
| Body, controls, and navigation  | Manrope          | 400–800 weights for a compact readable hierarchy        |
| Eyebrows, metadata, and numbers | IBM Plex Mono    | 500–600 weights, tabular numerals, controlled uppercase |

All three families are self-hosted through `@faceless-automations/brand` and
emitted as same-origin WOFF2 assets. No application loads remote font CSS or
runtime font files. License attribution ships with production artifacts.

## Iconography

Product controls use statically imported Tabler components: `@tabler/icons-vue`
for WXT/Vue and `@tabler/icons-react` for React. Icons are tree-shaken into local
application bundles; no icon CDN, remote sprite, icon font, or runtime fetch is
allowed. The Google provider mark remains its official multicolor mark rather
than being misrepresented as a generic product icon.

## Platform and deployment status

The dashboard and API are live as separate Vercel production projects at these
stable origins until a custom domain is attached:

- dashboard and browser API gateway: `https://paks-tools.vercel.app`
- upstream API and extension API: `https://paks-api.vercel.app`

The future custom-domain targets are `https://paks.tools` for the website,
authentication UI, and browser gateway, and `https://api.paks.tools` for the
upstream/extension API. They remain inactive until `paks.tools` is purchased,
ownership is verified, and the DNS, Vercel, Google OAuth, extension permission,
and CORS cutover passes the living audit gates.

The root deployment configurations, production Neon resource, and private Blob
store are connected without writing provider credentials into the repository.
The source migration set is current through `0005_guide_cms`; no
current production evidence proves that migration has been applied. Stable
and immutable deployment identifiers, public endpoint results, browser checks,
and remaining gate decisions are recorded in the
[Vercel deployment record](.build_plans/VERCEL_DEPLOYMENT.md).

Dashboard/browser requests use same-origin `/v1/*` and `/health/*` paths on the
web origin. Vercel forwards those paths to the upstream API project so secure
cookie sessions are never made dependent on a cross-site browser fetch. Grok
Automator™ uses the upstream API origin directly with its short-lived app-scoped
bearer session and does not use the dashboard cookie.

All confidential Google, Stripe, Neon, Blob, session, webhook, and administrator
values belong only in Vercel project environment storage. Do not create local
secret files or run `vercel env pull`. Local extension clients may call the
exact HTTPS upstream API. Local dashboard clients use their own same-origin
`/v1` gateway, which is proxied to the selected upstream without copying secrets
locally. The local no-secret API shell exposes liveness but deliberately returns
unavailable for provider-backed operations.

The 2026-08-20 read-only production recheck proves:

- upstream and same-origin gateway liveness return `200`;
- Neon-backed platform settings return `200` through both API paths;
- anonymous `GET /v1/admin/session` returns `401`;
- desktop/mobile landing, Google-only `/auth`, protected `/admin/platform`, and
  invalid extension-flow browser states fail or render as designed; and
- `/health/ready` returns the intentional `503 not_ready` result. Current source
  also keeps readiness closed when the applied migration version is behind.

The `503` readiness response is a correct fail-closed result, not evidence that
authentication, payments, licensing, administration, or downloads are ready.

The dashboard source contains Google-only sign-in/extension-connection
surfaces, the structured public tool-guide route `/guide/:slug`, and a
server-authorized admin console for guides, platform metadata, approved
colors/fonts, users, bans/restores, entitlements, revocation, and audit events.
The guide CMS stores bounded structured blocks rather than executable HTML,
keeps drafts private, uses optimistic revisions, and records immutable revision
and audit history. The seeded Grok Automator™ manual is addressed at
`https://paks-tools.vercel.app/guide/grok-automator`; this target-source route is
not claimed live until the dashboard/API release and migration qualify.

Admin routes fail closed without a verified Google administrator session and
CSRF token; no local administrator bypass exists. The two owner-approved emails
are stored only in the `paks-api` Vercel Production environment under the
sensitive `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` key. A matching verified Google email
can claim an administrator identity once; authorization after enrollment is
bound to its persisted Google issuer/subject and active user. The value was not
pulled locally or copied into source, dashboard code, extension code, or logs.
It becomes available only to a subsequent API deployment; the current stable
deployment is not claimed administrator-ready.

Grok Automator™ keeps every tool visible. A signed-out **Run** starts the owned
PKCE-bound Google flow, and a signed-in **Run** must receive a matching
server-side `automation.run` allowance before any prompt is queued. The local
daily counter cannot authorize access.

Historical API `0.2.3` fixed the first-account Google callback failure caused by sibling
writes in one PostgreSQL data-modifying CTE. User, identity, and session work
now runs as an ordered Neon transaction, successful dashboard sign-in returns
to the implemented `/` route, and callback diagnostics are stage-coded without
secret or identity material. API CI passes 7 files and 26 tests. Ready deployment
`dpl_5scMFAw976ScifQCAdZFLFCGRCKF` serves the stable
`https://paks-api.vercel.app` alias, and a fresh registered-extension flow passed
its browser connection, one-time PKCE exchange, and replay rejection. The
original denied flow remains closed, so the extension must start a new request.

Google Cloud project `faceless-automations` (**Faceless Automations**, project
number `464437881011`) exists. Its project ID is immutable and is not a public
application hostname. The interim production callback is
`https://paks-tools.vercel.app/v1/auth/google/callback`; after the custom domain is
owned and verified, the intended callback becomes
`https://paks.tools/v1/auth/google/callback`. Google client credentials stay
only in the API project's Vercel environment.
Stripe credentials, Product/Price mappings, verified webhook fulfillment, and
live/test purchase evidence are also pending. See the
[API setup record](apps/faceless-platform-api/README.md),
[Google SSO setup record](apps/faceless-platform-api/GOOGLE_SSO_SETUP.md), and
[active audit plan](.build_plans/AUDIT_PLAN.md).

## Guarded Vercel release workflow

The only canonical deployment configurations are root
[`vercel.dashboard.json`](vercel.dashboard.json) and
[`vercel.api.json`](vercel.api.json). Exact non-secret bindings are enforced for
the PAKS team, `paks-tools` dashboard project, and `paks-api` API project. The
workspace-local `apps/faceless-platform-api/vercel.json` is retained as
non-canonical historical configuration and is never selected by root release
commands.

Start with a read-only plan:

```powershell
npm run verify:vercel-config
npm run test:vercel-tooling
npm run release:vercel -- plan --surface api
npm run release:vercel -- plan --surface dashboard
```

External release commands are deliberately absent from CI and refuse to run
without `--execute`. An authorized API operator must create a production-target
candidate with `--skip-domain`, run its evidence-bound server-side migration,
qualify that exact deployment, and only then promote it:

```powershell
npm run release:vercel -- candidate --surface api --execute
npm run release:vercel -- migrate --surface api --deployment dpl_EXACT --execute
npm run release:vercel -- qualify --surface api --deployment dpl_EXACT --execute
npm run release:vercel -- promote --surface api --deployment dpl_EXACT --execute
```

The dashboard sequence omits `migrate`: candidate, qualify, then promote.
Candidate staging copies only the root package contract, selected workspace
manifests, the selected surface's build inputs, and its direct shared-package
inputs. The staged root workspace list is narrowed to those selected packages,
so unrelated lifecycle scripts do not run. Staging rejects common environment,
credential, and private-key artifacts; dashboard staging excludes root `api/`,
while API staging retains it. The selected reviewed config is materialized as
the stage-root `vercel.json`, so candidate deployment never uses
`--local-config` and Vercel must discover the expected cron registration.
Qualification rejects project/config drift, unexpected Functions, rewrite or
cron drift, aliases applied before review, failed liveness/readiness, and any
source/config/Git change after candidate creation. Before invoking the API cron,
`migrate` requires the Vercel project to report the exact path and schedule,
`crons.deploymentId` and definition host bound only to the requested unaliased
candidate, and a distinct prior deployment still serving production. Because
`vercel crons run` has no deployment selector, the tool checks that binding
before and immediately after invocation, checks it again after polling the exact
candidate's `/health/ready` route with `--deployment`, and records the invocation
time, target migration version, prior production deployment, and readiness
result in local candidate evidence. These checks narrow but cannot eliminate
provider-side TOCTOU, so any binding ambiguity fails closed.

Release operations started from the same checkout and evidence directory are
serialized by an exclusive per-surface lock, including operations on different
candidate IDs. This is a local cross-process lock, not a distributed lock across
other clones, hosts, or CI runners; release authority must remain with one
operator/checkout, and live provider-state checks fail closed on external drift.
Candidate evidence also uses a per-deployment lock. Evidence updates are written
to a same-directory temporary file, synced, atomically replaced, and followed by
a directory-entry sync where the filesystem supports it. Windows filesystems
that do not expose directory syncing retain the file-sync and same-volume
atomic-replace boundary. An existing lock, including a stale lock left by a
crashed process, is never cleared automatically; recovery fails closed until an
operator confirms the prior process and external-action outcome.

A production-target API candidate may become the provider's scheduled cron
deployment before an explicit `migrate` command. The evidence records that
exposure during candidate validation, and API candidate cleanup is always
refused because deletion cannot prove that the cron did not mutate the shared
production database or reverse such a mutation. Migration SQL must therefore
remain backward-compatible with the prior stable API. Only an eligible
dashboard candidate may be removed after exact project, alias, evidence, and
stable-deployment checks; arbitrary rollback assets, aliased deployments, and
the stable deployment are always refused. If a process stops after writing the
migration intent marker, a retry never invokes the cron again: it revalidates
the exact binding and identity, polls candidate-only readiness, and records an
explicit no-reinvoke recovery result only after readiness succeeds. Promotion
also writes durable intent before invoking Vercel. A retry reconciles an exact
already-promoted candidate without invoking promotion again, and boundedly polls
eventual consistency. API promotion success is recorded only when both
`targets.production` and the canonical cron deployment ID and definition host
bind the exact candidate. The workflow never runs `vercel env pull` and never
materializes Vercel secrets locally. Migration `0005` alone also cannot make
readiness pass while the required Stripe configuration remains absent. The
configured bootstrap value does not by itself prove that either administrator
has completed the one-time Google identity claim.

The exact Vercel state required before migration—cron deployment ID and host on
the candidate while `targets.production` remains the distinct prior stable
deployment—has not yet been qualified with an authorized `--target production
--skip-domain` candidate. Current read-only inspection established the project
JSON shape only. If Vercel does not expose this combination, candidate migration
fails closed and the release remains blocked; operators must not weaken the
binding invariant to force a cutover.

## Local origin policy

Production browser clients accept HTTPS origins only. Development may use an
exact `localhost`, loopback, or RFC1918/private-LAN IP origin when explicitly
configured; public HTTP hosts, subnet wildcards, wildcard CORS, and `<all_urls>`
are rejected. The current approved dashboard LAN origin is documented in the
build plan, and each unpacked extension ID must be registered as an exact
`chrome-extension://<id>` origin because the source intentionally has no public
manifest key.

## Repository layout

```text
apps/
├─ grok-automator/                 # active WXT/Vue extension
├─ faceless-automation-dashboard/  # landing and Google-only auth shell
└─ faceless-platform-api/          # deployable Vercel/Neon/Blob platform API
packages/
├─ brand/                          # local fonts and shared design tokens
└─ platform-contracts/             # TypeScript/Zod wire contracts
.build_plans/                      # active platform roadmap and audit gates
.github/workflows/ci.yml           # monorepo release-integrity CI
vercel.api.json                    # root-owned API deployment configuration
vercel.dashboard.json              # root-owned dashboard deployment configuration
package.json                       # workspace scripts and Node/npm contract
package-lock.json                  # only dependency lock
AGENTS.md                          # repository-wide contributor rules
CHANGELOG.md                       # monorepo infrastructure history
```

Product behavior, permissions, privacy, and remaining live-verification gaps
are documented in the [Grok Automator™ README](apps/grok-automator/README.md),
[privacy disclosure](apps/grok-automator/PRIVACY.md), and app changelog.

## Agent requirement

All agent-driven WXT extension work must load and follow the installed
`$sys001x-wxt` skill at
`C:\Users\jeff\.codex\skills\sys001x-wxt\SKILL.md`. The authoritative,
repository-wide rules—including the typography and WXT minification contracts—
are in [AGENTS.md](AGENTS.md).

## Version and release ownership

- The root version tracks monorepo structure and tooling.
- Each real app owns its product version and changelog.
- A Grok Automator™ release requires matching source, unpacked manifest, and ZIP
  versions plus a recorded ZIP SHA-256.
- Packaging does not publish to the Chrome Web Store or deploy the dashboard.
  External publication and live Grok tests require explicit authorization.
- The GitHub repository must remain private unless the owner explicitly changes
  that decision.

See [AGENTS.md](AGENTS.md), [CHANGELOG.md](CHANGELOG.md), and the
[app changelog](apps/grok-automator/CHANGELOG.md) before contributing.
