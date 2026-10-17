# Google SSO setup record

This document records owner-controlled Google Cloud state and the values still
required before the host-neutral authentication contract can become a deployed
service.

## Created Google Cloud project

| Field          | Value                  |
| -------------- | ---------------------- |
| Project name   | Faceless Automations   |
| Project ID     | `faceless-automations` |
| Project number | `464437881011`         |
| Created        | 2026-08-15             |

The project has one Google Web OAuth client named **Paks™ Faceless
Automations**. Its secret exists only in Google/Vercel and was not retrieved
into this repository. The consent app is **Paks™**, External, and currently in
Testing. A provider journey is not live until the PAKS callback is saved,
Vercel is redeployed with the matching value, and an intended test account or
published audience is configured.

## Remaining activation decisions

1. ~~Choose the TypeScript backend host/runtime and deployment region.~~ Vercel
   Node.js 24 is deployed and Neon `sin1` is selected.
2. ~~Confirm the owned public web, authentication, and API origins.~~ The
   interim production origins are `https://paks-tools.vercel.app` and
   `https://paks-api.vercel.app`. The future verified custom origins are
   `https://paks.tools` and `https://api.paks.tools`.
3. Publish the homepage, privacy policy, and terms URLs on a verified owned
   domain.
4. Confirm the owner-controlled support/developer-contact addresses and either
   add intended test accounts or complete the production publishing process.
5. Set the exact server callback URI to
   `https://paks-tools.vercel.app/v1/auth/google/callback`; it must
   match the Google OAuth client and Vercel variable byte-for-byte.
6. Supply the production Chrome Web Store extension ID and any staging ID so the
   backend can enforce exact extension-origin CORS and app registration.
7. Choose persistence, Secret Manager, session signing, retention, deletion,
   quota, and abuse-control policies.

## Google client contract

- Create one **Web application** OAuth client for the owned central backend.
- Request only OpenID Connect identity scopes needed for sign-in:
  `openid`, `email`, and `profile`.
- Keep the client secret only in the API project's server-side Vercel
  environment storage. It must never enter a local environment file, dashboard
  bundle, extension bundle, Git, build output, logs, browser storage, or a URL.
- Use the server authorization-code flow with state and nonce. Validate the ID
  token signature, issuer, audience, expiry, nonce, and `email_verified` on the
  backend.
- Google access tokens, refresh tokens, ID tokens, authorization codes, and the
  Google subject are never returned to an extension. The extension receives
  only a short-lived Paks Tools Faceless automations application session after its
  PKCE-bound one-time exchange.
- The dashboard extension page starts Google with
  `/v1/auth/google/start?client=extension&flowId=<opaque-flow-id>`. The callback
  returns to the clean `/auth/extension/<opaque-flow-id>` page, and the extension
  alone exchanges the flow by proving possession of its PKCE verifier.

## Activation evidence

Production was rechecked read-only on 2026-08-20. The canonical PAKS web and API
origins serve the earlier API `0.2.3`; a fresh registered-extension Google/PKCE
flow completed its one-time exchange and rejected replay. That proves the
deployed legacy flow had a configured Google client, callback, and eligible
identity, but it does not prove the target `0.2.6` same-session, CSRF, and
extension-code v2 journey or final provider-console settings.
`/health/ready` still returns the intended fail-closed `503`. Vercel project
metadata now verifies that `ADMIN_GOOGLE_BOOTSTRAP_EMAILS` is stored as a
Sensitive value scoped to Production; its value was not read, pulled, logged,
or materialized locally. That setting applies only when a future `0.2.6`
deployment consumes it. Migration `0005_guide_cms`, successful one-time claims
for both intended Google accounts, and the complete deployed v2 journey remain
unproven. The required Stripe values are still absent, so readiness remains
blocked independently. The final Google audience, branding, verified-domain,
callback, and test-user state must be rechecked in the provider console before
activation.

Do not mark Google sign-in active until all of the following are proven:

- the deployed callback exactly matches the Google client redirect URI;
- branding, audience, verified domains, privacy links, and required test users
  are configured;
- the backend's state, nonce, PKCE, token validation, session, CORS, expiry,
  replay, revocation, and redaction tests pass;
- the dashboard can complete a server-owned session without exposing a Google
  token to JavaScript; and
- an allowlisted extension can complete the one-time exchange while an unknown
  extension origin is rejected.
