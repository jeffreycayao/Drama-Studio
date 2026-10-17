# Paks Tools Faceless automations build plans

> **Status: ACTIVE**  
> **Canonical planning directory:** `.build_plans/`  
> **Last updated:** 2026-08-20

This directory contains the living product, architecture, delivery, and audit
plan for the Paks Tools Faceless automations platform.

## Active documents

- [`MASTER_PLAN.md`](MASTER_PLAN.md) is the authoritative roadmap, architecture,
  decision register, milestone plan, and definition of done.
- [`AUDIT_PLAN.md`](AUDIT_PLAN.md) is the authoritative success-gate catalog,
  evidence standard, audit cadence, and release decision record.
- [`REFERENCE_PORT_AUDIT.md`](REFERENCE_PORT_AUDIT.md) is the read-only,
  clean-room review of the Pancake Toolsets reference, including the approved
  pattern backlog and explicit do-not-port register.
- [`VERCEL_DEPLOYMENT.md`](VERCEL_DEPLOYMENT.md) records the live production
  scaffold, immutable deployments, endpoint/browser evidence, applied migration,
  and the provider-readiness boundary.

The current plans are version `2.1`. The active source targets are root `0.3.5`,
dashboard `0.2.6`, API `0.2.6`, platform contracts `0.1.2`, and Grok
Automator™ `0.0.13`. None of those releases is recorded as deployed. Source
contains migration `0005_guide_cms`; applied production parity is
unverified and production readiness remains fail-closed.

Plan 2.0 records the same-session Google, CSRF, and extension-code v2 auth
boundary; the non-breaking v1 compatibility window through
`2026-11-30T00:00:00Z`; API abuse/retention controls; bounded extension imports
and message reassembly; bounded local API requests; opaque chronological audit
pagination; and guarded Vercel candidate, API migration, qualification, and
promotion phases with a checkout-local per-surface release lock, per-candidate
crash-conservative evidence locks, no-reinvoke recovery, and an exact
post-promotion production/cron binding check. It also records that any
production-target API candidate may be scheduled before explicit migration and
therefore cannot be treated as a safe cleanup target. The currently served
dashboard deployment contains an unintended root `api/index` Function. The next
authorized release must use the coordinated dual-protocol order, keep the
migration compatible with the prior stable API, and prove an empty dashboard
Function inventory before promotion.

The per-surface lock coordinates processes sharing one checkout/evidence
directory; it is not distributed across other clones, hosts, or CI runners.
The required Vercel skip-domain candidate state—cron bound to the candidate
while production remains on the prior deployment—is still an external
qualification assumption and fails closed if the provider does not expose it.

Immutable plans 1.0–1.9 and audit records 001–008 remain historical evidence.
Current Git/deployment parity is unresolved: the audit-start worktree at HEAD
`c4527a5bb4eff53359af7fcc587f407935a0855d` contained 62 tracked changes and
185 untracked paths. Stripe fulfillment, paid licensing, private delivery,
provider activation, live Grok, and Chrome Web Store evidence remain separate
external gates.

Plan 2.1 adds a generic structured tool-guide CMS, the public
`/guide/:slug` document route, immutable guide revisions/audit attribution, and
one-time verified-Google administrator enrollment. The requested administrator
emails are present only in the `paks-api` Vercel Production secret store under
the sensitive `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` key; the target API binds a
successful claim to the immutable Google issuer/subject. This provider change
does not deploy source or apply migration `0005`.

## Maintenance contract

These files are operational records, not one-time proposals.

1. Update the master plan when product scope, architecture, providers, domains,
   pricing models, milestones, or owner decisions change.
2. Update the audit plan whenever a new trust boundary, paid capability,
   deployment target, data category, extension, or downloadable product is
   introduced.
3. Every implementation pull request or change set must reference the affected
   milestone and gate IDs.
4. A gate can be marked `PASS` only when its required evidence is recorded and
   reproducible against the identified commit and environment.
5. A successful local build is not evidence of a successful deployment,
   payment, entitlement, download, Chrome Web Store submission, or third-party
   outcome.
6. Failed, blocked, waived, and not-run checks remain visible. Do not rewrite
   history by deleting them.
7. Material plan changes must add a dated entry to each document's change log.

## Status vocabulary

| Status        | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `PLANNED`     | Approved direction; implementation has not started             |
| `IN PROGRESS` | Work is underway; required gates are not all satisfied         |
| `BLOCKED`     | Work cannot safely continue without a named decision or input  |
| `PASS`        | Required evidence exists for the identified revision           |
| `FAIL`        | Evidence proves that one or more acceptance criteria are unmet |
| `SUPERSEDED`  | Replaced by a newer documented decision; retained for history  |
