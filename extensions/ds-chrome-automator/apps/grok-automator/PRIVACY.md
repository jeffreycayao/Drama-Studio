# Privacy disclosure

Last source review: 2026-08-20

This document describes the behavior implemented by the development source for
Grok Automator™ 0.0.13. It is a repository disclosure, not yet a hosted Chrome
Web Store privacy-policy URL. PAKS LLC must confirm the endpoint operator,
retention terms, contact address, and final store disclosures before release.

## Data handled by the extension

Grok Automator™ handles the following data only to provide its visible features:

- prompts, selected prompt ranges, uploaded images, generated-resource URLs,
  generation status, and debug messages used by the Grok automation workflow;
- extension preferences, locale, download folder/prefix, and a UTC daily prompt
  history counter stored locally in the Chrome extension profile;
- after a successful configured Google-only platform flow, a verified account
  profile, application entitlements, and a short-lived Paks Tools Faceless
  automations access token stored in extension session storage;
- bounded in-flight Run recovery identifiers (authorization, acceptance, prompt
  group, tab, lifecycle, and expiry values) in session storage; these receipts
  contain no prompt text, image payload, Google material, or bearer token; and
- a schema-validated, size-bounded prompt group (including prepared images) in
  extension-origin IndexedDB while a server-accepted Run is blocked or released
  but has not started. Blocked records expire after about five minutes; released
  records have a bounded 30-minute recovery horizon. Immediately before the
  first automation call, the payload is replaced with an IDs-only claimed
  receipt so an interrupted batch is surfaced but never automatically replayed;
  terminal completion or cancellation deletes the record; and
- downloaded images and videos saved through Chrome's Downloads API at the
  user's request.

The extension never receives or stores a Google access token, refresh token, ID
token, authorization code, client secret, or Google subject. It receives only a
bounded Paks Tools Faceless automations application-session response after the
configured backend has completed Google verification. That response can include the
account's verified email and display name, app entitlements, expiry, and a
short-lived application access token. Invalid or expired sessions are removed.
The verified display name, email, and session-resolved plan are rendered only
inside the extension side panel; displaying them adds no network request or
additional persistent account-data copy.
Former email-only authentication and token keys are deleted during side-panel
startup.

Uploaded images are converted to data URLs inside the extension and passed to
the Grok page selected by the user. Prompts and images are entered into Grok's
web interface; their processing by Grok is governed by Grok's own terms and
privacy practices. The extension may read generated media from the Grok page to
prepare downloads or a final frame for a follow-up prompt.

## Network destinations

The active source communicates with:

- `grok.com` and its subdomains, where the content script performs the requested
  prompt, upload, generation, and download workflow;
- `https://imgen.x.ai` and `https://vidgen.x.ai`, Grok's ephemeral generated
  image and video hosts, when the extension reads or downloads requested media.

The production defaults target the reserved Paks Tools Faceless automations
Vercel web and API origins. The extension sends an app identifier and PKCE challenge to the
owned API to create an authentication flow. It opens only the returned owned
`/auth/extension/<flow-id>` page, displays the API-issued verification code only
inside the sign-in modal, and submits the in-memory PKCE verifier to that API's
one-time exchange route while polling for completion. The verification code is
not placed in a URL or diagnostic log.

After authentication, every Run sends the app ID, fixed `automation.run`
operation, requested prompt-unit count, a fresh idempotency key, and the
short-lived Paks Tools Faceless automations application token to the exact owned
API to reserve usage. After a local queue accepts the same stable ID without
starting work, the extension tentatively accepts the reservation with that ID,
durably commits and confirms the matching blocked group, and asks the API to
finalize the same acceptance. Only a confirmed finalization releases the group;
the worker then claims it durably before touching Grok. A missing local stage
rolls back the tentative acceptance; a never-accepted reservation is cancelled.
Bounded IDs-only session receipts reconcile ambiguous API replies and side-panel
restarts without sending prompt or image content to the platform API. The
temporary v1 compatibility route durably blocks the group before its immediate
usage decision and releases only an allowed result. The API returns
a bounded reservation, transition, or denial state. The extension does not send
prompt text, uploaded images, Grok page content, generated media, filenames,
Google tokens, or Google credentials to the platform API. If authentication or
authorization is unavailable, invalid, denied, or times out before commitment,
Run remains stopped. The update modal only reloads the installed extension after
an explicit user action. Installation opens no external welcome page.

The footer's version badge is a packaged SVG generated locally from the
extension version. It is loaded from the extension itself under an
`img-src 'self' data:` content-security policy and causes no request to
`img.shields.io` or another badge service. The `data:` image allowance is used
for validated, on-device previews of images the user selected; it is not a
network destination.

## Chrome permissions

- `storage` stores settings, locale, daily usage, download naming preferences,
  the bounded Paks Tools Faceless automations application session, and IDs-only
  in-flight Run recovery receipts in session storage. It is also used to remove
  former authentication values.
- `tabs` finds, opens, focuses, refreshes, or zooms Grok tabs.
- `downloads` saves generated media and applies user-selected filenames.
- `sidePanel` displays the extension interface.
- HTTPS-only host access for `grok.com` enables DOM automation; access for
  `imgen.x.ai` and `vidgen.x.ai` enables generated-media processing. The default
  production build adds only
  `https://paks-api.vercel.app/*` for authentication/session
  exchange and Run authorization. A development build may replace it with one
  exact validated localhost, loopback, private-LAN, or HTTPS owned origin; no
  wildcard subnet or public HTTP host is accepted.

The blocked-stage IndexedDB database is isolated to the extension origin and
does not require a broader Chrome permission or expose its payload to the
platform API. It is count-, text-, image-, per-record-, aggregate-, transfer-,
and time-bounded, pruned at startup, and removed on terminal completion,
cancellation, tab closure, expiry, or extension removal.

The source rejects media URLs outside those exact HTTPS hosts, bounded base64
raster-image data URLs, and blob URLs whose embedded origin is one of those
hosts. Media frame requests omit cookies and other credentials and enforce final
URL, type, byte, time, duration, dimension, and pixel limits. Local image and
spreadsheet inputs are bounded before expensive reads or workbook model
materialization. Sensitive
background messages are accepted only from this extension's top-frame content
script on an HTTPS Grok tab.

## Data sharing and analytics

The active 0.0.13 source contains no advertising SDK, analytics SDK, Meta Pixel,
remote executable code, remote font asset, embedded Google credential, or
sale-of-data implementation. Grok workflow data is handled on the Grok page as
required to perform the user's requested automation. The central API receives
only the authentication and Run-authorization data described above.

When automatic renaming is enabled (the recovered default), a sanitized prefix
derived from up to 50 prompt characters can appear in downloaded filenames.
Those filenames may remain in filesystem metadata, browser download history, or
the user's backup/synchronization services after the extension is removed.

## User controls and deletion

Chrome's extension-data controls or uninstalling the extension remove local and
session extension storage. Invalid or expired application sessions are removed
when read; closing Chrome also clears session storage according to Chrome's
session-storage behavior. Downloaded files remain in the user's chosen download
location and must be deleted by the user. Removing the extension does not delete
information that Grok or the platform backend may already hold; production
account-data access, retention, and deletion procedures remain release gates and
must be documented before distribution.

## Publisher checklist before distribution

Before publishing this policy, the publisher must:

1. identify the legal publisher and provide a monitored privacy contact;
2. complete and audit the central Google-only OAuth/session flow before enabling
   account or Pro state;
3. document the platform operator, retention, deletion, security, and
   subprocessors before account data is handled;
4. complete and audit Stripe-driven entitlement lifecycle, server usage limits,
   revocation, and reconciliation; the local daily history must never grant
   access;
5. confirm Grok's current terms permit the intended automation;
6. make the Chrome Web Store data-use answers match the shipped ZIP exactly; and
7. host the final policy at a stable public HTTPS URL and add its effective date.
