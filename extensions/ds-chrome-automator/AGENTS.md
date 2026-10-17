# Paks Tools Faceless automations development guide

These instructions apply to the entire monorepo. A workspace may add stricter
rules in its own `AGENTS.md`; both levels apply.

## Mandatory WXT skill

- Always load and follow `$sys001x-wxt` from
  `C:\Users\jeff\.codex\skills\sys001x-wxt\SKILL.md` before planning,
  implementing, auditing, testing, building, packaging, releasing, or
  troubleshooting any WXT extension in this repository.
- This requirement applies to every current and future WXT application in the
  monorepo, not only `apps/grok-automator`.
- Read the skill's `AGENTS.md` and any task-required references before making
  WXT-specific decisions. If the installed skill cannot be loaded, stop the WXT
  work and report the missing dependency; do not silently substitute another
  workflow.

## Monorepo ownership

- The repository root exclusively owns `.git`, `.nvmrc`, `packageManager`,
  `package-lock.json`, root `node_modules`, shared formatting rules, and CI.
- Never add a nested Git repository, workspace lockfile, or workspace-local
  dependency install.
- Run required commands from the root through explicit workspace scripts.
- Do not use `--if-present` to hide a missing test, build, scan, or release gate.
- Shared runtime-agnostic code belongs under `packages/`; it must not import an
  application workspace or select a deployment provider.

## Typography

| Role                           | Font             | Guidance                                                       |
| ------------------------------ | ---------------- | -------------------------------------------------------------- |
| Display and narrative headings | Instrument Serif | Use at large sizes with restrained weight and tight tracking   |
| Body, controls and navigation  | Manrope          | Use 400–800 weights for readable, compact UI hierarchy         |
| Eyebrows, metadata and numbers | IBM Plex Mono    | Use 500–600 weights, tabular numerals and controlled uppercase |

- Consume these families from `@faceless-automations/brand`.
- Bundle licensed WOFF2 files inside each website or extension package when
  exact typography is required. Never load remote font CSS or runtime font
  assets.
- Fall back to Georgia, Arial/system sans, and Consolas/monospace respectively.
- A production verifier must prove that the expected local font assets and
  third-party license notice are present before an artifact can be released.

## Iconography

- Tabler Icons is the repository-wide product icon system. Use
  `@tabler/icons-vue` in Vue/WXT applications and `@tabler/icons-react` in React
  applications.
- Import only the named icon components a view uses. Icons must compile into
  the local application bundle; never load icon scripts, SVGs, fonts, sprites,
  APIs, or stylesheets from a CDN at runtime.
- Use `currentColor`, a consistent 1.75–2 pixel outline stroke, and accessible
  text or labels. Mark decorative icons `aria-hidden`; an icon alone must have
  an accessible name and must not be the sole carrier of state.
- Do not introduce a second general-purpose icon library, icon font, emoji UI,
  or hand-drawn replacement SVG. Reviewed provider marks such as the official
  multicolor Google sign-in logo and non-interactive brand artwork are the only
  exceptions.
- Bundle Tabler's license notice in every production artifact that contains its
  icons, and make the corresponding build verifier prove the notice is present.

## Adding applications

Every new application belongs under `apps/<app-name>` and must provide real
type, lint, test, build, security, and release gates appropriate to its runtime.
Add explicit root scripts and CI coverage before calling the app active.

## Grok Automator™ rules

- The active extension source is `apps/grok-automator/entrypoints` and
  `apps/grok-automator/src`.
- Preserve WXT, strict TypeScript, Manifest V3, generated manifests, centralized
  WXT storage, schema-validated boundaries, least-privilege permissions, strict
  CSP, and the raw typed wire protocol documented by the app.
- Never reintroduce compiled distributions, decompiler output, recovery-tool
  folders, remote executable code, unsafe evaluation, secrets, source maps, or
  broad speculative permissions.
- Every emitted JavaScript chunk must retain the required PAKS LLC legal
  banner. Production ZIPs must pass the app's build and ZIP verifiers.
- PAKS LLC is the active legal owner for product copyright stamps and emitted
  Grok Automator™ banners. This repository-specific owner instruction
  supersedes the legacy publisher name in the installed skill template; do not
  reintroduce that prior signature into active source or release artifacts.
  Preserve prior changelog and audit text only as immutable historical evidence.
- Production WXT builds must disable source maps, use Terser compression and
  identifier mangling, drop console/debugger statements, preserve legal
  comments, and explicitly minify CSS. Do not enable property mangling.
- Preserve WXT/Vite's isolated entrypoint boundaries and hashed chunks. Never
  force content scripts, background code, and extension pages into a shared
  manual chunk; verify the emitted chunk tree instead.

## Web and platform boundaries

- The dashboard and central sign-in surface use strict TypeScript and Tailwind.
  Google is the only planned sign-in provider; do not add password, email-only,
  or social-login alternatives.
- Vercel is the selected web/API host. Provider-backed routes must fail closed
  until their Vercel-only environment variables and backing resources are
  configured; a deployed health page is not evidence that Google, Stripe,
  persistence, licensing, or downloads are production-ready.
- Keep shared API schemas provider-neutral. Never place Google client secrets,
  backend credentials, or Google identity tokens in a browser extension.

## Vercel secrets and local development

- Confidential keys, API credentials, signing secrets, database URLs, webhook
  secrets, and OAuth client secrets live only in scoped Vercel project
  environment variables. Never commit them, copy them into a workspace file,
  expose them through a `VITE_`/`WXT_` variable, or add a local fallback.
- Do not run `vercel env pull` or otherwise materialize Vercel secrets on a
  developer machine. Public origins and non-sensitive identifiers may be set in
  documented examples or build configuration.
- Local websites and extensions may call an explicitly configured Vercel
  preview API. A fully local API must use no-secret adapters and return a clear
  unavailable response for Google, Stripe, database, signing, and private-file
  operations.
- Development-only HTTP origins are limited to exact localhost, loopback, or
  private-LAN IP origins. Production accepts HTTPS only. Never grant wildcard
  LAN ranges, wildcard CORS origins, or insecure production origins.
- Google remains the only authentication provider. Stripe Checkout and verified
  webhooks are the only payment authority; browser redirects never grant access.
- Admin routes require a verified server-side administrator identity. User bans,
  session revocations, entitlement changes, catalog changes, and platform-theme
  changes must be recorded in an immutable audit trail.

## Change and release workflow

- Root-only infrastructure changes update the root `CHANGELOG.md` and root
  package version; they do not require an extension version bump.
- Product behavior changes update the app README and changelog, bump the app
  version, and run `npm run ci` from the root.
- Preserve unrelated user work and inspect Git status before staging.
- Do not perform synthetic live Grok activity. Authorized live checks must be
  low-volume and use an owner-controlled account.
- Do not push, deploy, submit to a store, or change repository visibility unless
  the user explicitly authorizes that external action.
