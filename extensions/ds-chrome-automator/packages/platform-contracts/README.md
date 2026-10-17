# Platform contracts

`@faceless-automations/platform-contracts` is the private, host-independent
runtime contract package for Paks Tools Faceless automations extensions, web
applications, and the central platform API.

The package contains data schemas only. It has no network client, HTTP server,
OAuth implementation, persistence adapter, credentials, domains, or deployment
configuration.

## Contract guarantees

- Every object boundary is a strict Zod object; unknown keys are rejected.
- Identifiers, URLs, tokens, selector values, arrays, messages, and counters are
  bounded.
- Google is the only accepted identity provider in authentication contracts.
- Extension-flow creation is PKCE S256 only. Version 2 adds an independent
  `XXXX-XXXX` initiator code and an explicit verification request. Its safe page
  status carries a nullable, bounded CSRF token that the server supplies only to
  the Google-authenticated session bound by the callback.
- Google tokens are never part of an extension-facing response. A successful
  exchange returns only a short-lived Paks Tools Faceless automations
  application token.
- Remote configuration is versioned, content-hashed, and data-only. It must
  never be interpreted as executable code.
- Usage version 2 separates reservation, tentative acceptance, finalization,
  rollback, and cancellation. A tentative acceptance is finalized only after an
  idempotent local commit/query confirms the queue group; locally executed
  extension behavior is still not claimed to be tamper-proof.

## Modules

| Module       | Responsibility                                                       |
| ------------ | -------------------------------------------------------------------- |
| `primitives` | Bounded identifiers, semantic versions, hashes and secure URLs       |
| `errors`     | Stable, non-leaking API error envelope                               |
| `guide`      | Bounded structured multi-tool manuals and optimistic CMS writes      |
| `auth`       | Google-only web start, user-code, extension-flow, and PKCE contracts |
| `session`    | Verified Google account and app entitlement session                  |
| `config`     | Generic configuration envelope and Grok selector payload             |
| `usage`      | Versioned reserve, accept, finalize, rollback, and cancel contracts  |

Guide contracts expose only data-only heading, paragraph, list, callout, and
safe-link blocks. Links are restricted to credential-free HTTPS or a single-
slash same-origin relative path. Unique section IDs, aggregate text/block/link
caps, explicit revisions, and draft/published projections keep the shared
browser/API boundary deterministic without permitting raw HTML or executable
content.

## Development

The repository root owns installation, the lockfile, and CI. Never install
dependencies inside this package. Run its explicit workspace gate from the
repository root:

```powershell
npm run check:contracts
```

The build emits ESM JavaScript and declaration files to `dist/`. TypeScript
source maps and declaration maps are explicitly disabled, and `verify:build`
fails if any map or source-map reference is emitted.

## Integration boundary

An extension may import these schemas to validate every API response before it
touches UI, storage, permissions, or automation state. Backend implementations
remain responsible for host/origin authorization, Google OAuth, persistence,
secret ownership, server-side limits, atomic quota enforcement, and retention;
the contracts do not supply those controls.
