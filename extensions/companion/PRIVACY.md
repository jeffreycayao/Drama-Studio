# Privacy disclosure (draft)

Drama Studio Companion 0.1.0. This is the repository draft; the store privacy
page, contact address and publisher name still need the owner's sign-off
before a Chrome Web Store or Edge Add-ons listing.

## What the Companion handles

- **Prompts and reference images** you enter in the side panel. They are
  typed into the Grok Imagine tab you chose and are not sent anywhere else.
- **Generated images and videos** on that Grok tab, read only to download
  them to your Downloads folder when you asked for downloads.
- **Prompts in links** to the supported AI chat sites. A plain `#prompt=` link
  is shown to you first and filled only if you press Fill. A Drama Studio
  `#ds=` link carries only a one-time token; the prompt comes from the Drama
  Studio app on your own computer.
- **Settings** (modes, delays, download folder and naming) in the
  extension's local storage.
- **An activity log** in the side panel's memory, which you can copy
  yourself to report a problem. It holds no prompts or images.

## Where data goes

- `grok.com` and Grok's media hosts (`imgen.x.ai`, `vidgen.x.ai`), for the
  batches and downloads you start.
- The AI chat site you opened, when you fill a prompt there. The Companion
  never presses Send.
- The Drama Studio app on the same computer, through Chrome's native
  messaging, only after you connect it in Settings.

The Companion has no server and no account. It sends no analytics, telemetry
or advertising data, and it does not sell or share data. What each AI site
does with your prompts is governed by that site's own terms and privacy
policy.

## Permissions

`storage`, `tabs`, `downloads` and `sidePanel`; host access to `grok.com`,
`imgen.x.ai` and `vidgen.x.ai`; content scripts on Gemini, ChatGPT, Claude,
Perplexity, Manus and Grok; and `nativeMessaging`, which is optional and asked
for only when you connect to Drama Studio.

## Removing data

Remove the extension from `chrome://extensions` to delete its settings.
Downloaded files stay in your Downloads folder.
