# Chrome Web Store listing: Drama Studio™ Companion

Paste-ready text for the Chrome Web Store Developer Dashboard. Images are in
`assets/` and are rebuilt with `node store/render.mjs <chromium-executable>`
from `src/store-art.html`.

## Package

Upload `.output/drama-studio-companion-<version>-chrome.zip` from
`npm run ci`, not the unpacked folder. The CI run checks the zip, the
audited permissions, the 132-character description and that there is no
remote code.

## Store listing tab

**Name:** Drama Studio™ Companion (comes from the manifest)

**Summary:** comes from the manifest description (120 characters):

> Companion for the Drama Studio desktop app: fills your prompts and references into AI sites and brings the results back.

**Category:** Productivity › Tools (if the dashboard offers "Workflow & Planning", that fits too)

**Language:** English

**Description:** paste only this. Do not add a list of the supported sites:
the Store rejected 0.5.2 for "excessive keywords" because the dashboard text
named every site. Keep other sites' and companies' names out of the
description, apart from Grok Imagine, which the batch feature needs.

```
Drama Studio Companion links the Drama Studio desktop video editor to the AI image, video and music sites you already use, in your own browser.

SEND FROM DRAMA STUDIO
In Drama Studio, choose a site, write the prompt (or a song's style, lyrics and title), and pick reference pictures or clips from your project. The site opens in your browser with everything filled in and the references added to its own upload button. You check it and press Generate yourself.

BRING RESULTS BACK
Right-click a picture, video or song you made and choose Send to Drama Studio. It goes straight into your Drama Studio project, together with the prompt it came from.

PROMPT BATCHES ON GROK IMAGINE
Paste or import a list of prompts (.txt, .xlsx or .csv) and run them one at a time in your own signed-in tab, with a pause between prompts. Results are saved to your Downloads folder.

BUILT TO STAY OUT OF TROUBLE
• The Companion never presses Generate, Create or Send for you, except in a batch you start yourself.
• Any sign-in page, usage limit, moderation message or CAPTCHA stops the batch at once. It never solves a check or works around a limit.
• It uses your own accounts. Each site's own terms and prices apply.

PRIVATE BY DESIGN
• No account, no server, no analytics, no tracking.
• The link to Drama Studio is optional, works only with the app on your own computer, and you allow each browser once in Drama Studio.
• Extra site access is asked one site at a time, only when you first use it.

Drama Studio shows which sites are supported. Sending and receiving need the Drama Studio desktop app for Windows; batches work on their own.

Drama Studio Companion is an independent tool. It is not affiliated with or endorsed by the AI sites it works with.
```

**Graphic assets:**

| Field                        | File                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Store icon (128 × 128)       | `assets/store-icon-128.png`                                                                              |
| Screenshots (1280 × 800)     | `assets/screenshot-1-batch.png`, `assets/screenshot-2-ai-sites.png`, `assets/screenshot-3-send-back.png` |
| Small promo tile (440 × 280) | `assets/promo-small-440x280.png`                                                                         |

**Official URL / homepage:** http://jepoy.dev/
**Support URL:** https://discord.gg/5nAZVQ7K4

## Privacy practices tab

**Single purpose:**

> Drama Studio Companion connects the Drama Studio desktop app to AI image, video and music websites in the user's own browser: it fills in prompts and reference files that the user sends from Drama Studio, runs user-started prompt batches on Grok Imagine, and sends results the user chooses back to Drama Studio.

**Permission justifications:**

| Permission                                                 | Justification                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                                                  | Saves the user's settings (batch mode, delays, download folder and file naming) in the browser.                                                                                            |
| `tabs`                                                     | Finds and focuses the AI site tab that a job or batch belongs to, and shows short status messages in that tab.                                                                             |
| `downloads`                                                | Saves Grok Imagine batch results to the user's Downloads folder, as the user asked.                                                                                                        |
| `contextMenus`                                             | Adds one right-click item, "Send to Drama Studio", on pictures, videos and songs from the supported AI sites.                                                                              |
| `sidePanel`                                                | Shows the Companion's interface (batches, settings, activity) in the side panel.                                                                                                           |
| Host `grok.com`, `*.grok.com`, `imgen.x.ai`, `vidgen.x.ai` | Runs the user's Grok Imagine batches in their own tab and downloads the results.                                                                                                           |
| Content scripts on the supported AI sites                  | Types the user's prompt into the site's prompt box and adds the user's reference files to the site's own upload button. Only when the user sends a job from Drama Studio, or presses Fill. |
| Optional host access to each site's media hosts            | Asked one site at a time when the user first sends a result from that site to Drama Studio, to download that one file.                                                                     |
| Optional `nativeMessaging`                                 | Connects to the Drama Studio desktop app on the same computer. Asked only when the user presses Connect.                                                                                   |

**Remote code:** No, I am not using remote code. (All JavaScript is in the package; the extension-page CSP is `script-src 'self'`.)

**Data usage** (tick these; nothing else):

- **Website content**: prompts, lyrics and reference files the user sends are placed on the AI site the user chose; results the user picks are sent to the Drama Studio app on the same computer.
- **User activity**: no.
- Personally identifiable info, health, financial, authentication, personal communications, location, web history: **no**.

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** publish the text of `PRIVACY.md` as a page on your site, for example `http://jepoy.dev/companion/privacy`, and paste that URL. It must be reachable without signing in.

## Before you submit

- [ ] **Rights to the batch code.** The Grok batch runner was derived from Grok Automation 2.6.3 (Chris.dev / Paks Tools) and the Sellify helper. Get written permission, or replace that code, before publishing under your name.
- [ ] **Batch mode on Grok.** Reviewers may question automation on a third-party site. Keep the stop-at-any-limit behaviour, and consider shipping the first version with batches off by default, or without them.
- [ ] **Description:** no list of supported sites or company names (rejected once for "excessive keywords", Yellow Argon, 18 Oct 2026).
- [ ] Host the privacy policy and paste its URL.
- [ ] Publisher name and contact email in the dashboard account settings.
- [ ] Pay the one-time developer registration fee if this is a new account.
- [x] Store ID `inkjhigflcgkaganbiepogcpcfgndfog` is in `store/identity.json` and in Drama Studio (`RELEASE_EXTENSION_IDS`, `build/companion/com.dramastudio.companion.json`, `src/config/projectInfo.js`). Tests keep them equal. Do not add the `key` to the Store upload; only `npm run build:unpacked` carries it.
