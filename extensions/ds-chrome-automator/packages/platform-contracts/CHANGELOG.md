# Changelog

## 0.1.2 - 2026-08-20

- Added strict provider-neutral guide schemas for published documents, admin
  documents/summaries, structured safe content, creation, and optimistic
  updates.
- Bounded sections, blocks, links, list items, text, and aggregate content;
  accepted only credential-free HTTPS or same-origin relative links and no raw
  HTML/executable field.

## 0.1.1 - 2026-08-20

- Added version 2 extension authentication contracts for an independent user
  code, bound-session CSRF handoff, explicit initiator verification, attempt
  reporting, and versioned exchange responses. Exact v1 create/status/exchange
  schemas remain available for the documented sunset window.
- Added version 2 reservation, tentative acceptance, finalize, rollback, cancel,
  terminal-state, and transition contracts.
- Added `upgrade_required` to the bounded API error vocabulary for legacy
  one-step usage clients.

## 0.1.0 - 2026-08-14

- Added strict shared primitives and a stable API error envelope.
- Added Google-only dashboard-start and PKCE-bound extension authentication
  flow contracts.
- Added verified session and app entitlement contracts.
- Added a versioned remote-configuration envelope and the bounded Grok selector
  payload used by the current extension.
- Added idempotent usage-authorization contracts.
- Added strict TypeScript, runtime schema tests, declaration output, and a
  source-map-free build verifier.
