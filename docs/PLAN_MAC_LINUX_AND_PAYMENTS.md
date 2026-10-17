# Plan: macOS and Linux releases with a one-time price (2026-10-17)

Internal planning document. Not user-facing.

## Status (2026-10-17): free for now

The owner decided to **release free for now**:

- **Windows:** a free Microsoft Store listing. Microsoft signs the MSIX
  package, so no certificate of our own is needed.
- **No licensing** is built yet.
- **macOS and Linux** still need their own signing: Apple's Developer ID
  (US$99/yr) for macOS; Linux needs none.

The paid plan below stays the design for later. When paid starts, the
recommended version is a **free Store listing plus one Stripe license key on
all three platforms**. The Store rules allow non-game apps to sell through
their own payment system, and Microsoft takes nothing from those sales. That
replaces the "paid Store app" and "Store license" parts below.

## Verdict (paid, later)

- **Windows:** sell through the **Microsoft Store** as a paid app. The Store
  takes the payment, keeps the license and pushes updates. Nothing to build
  for licensing.
- **macOS and Linux:** sell **direct** from jepoy.dev with the owner's
  **Stripe** account (decided 2026-10-17). Each purchase produces a **signed
  license key** that the app checks offline.
  - The **Mac App Store is not an option.** It requires the App Sandbox, and
    its rules forbid downloading executable code. Drama Studio starts the
    user's own ComfyUI and Python and installs add-ons on request, so neither
    works sandboxed.
  - **Linux** has no store that takes payments.
- **One key works on macOS and Linux**, for one person on up to 3 computers.
  Windows is **Store only** (decided 2026-10-17).
- **"One-time" means a perpetual license to the current major version**, with
  updates included until the next major version (for example "Drama Studio
  1.x"). The next major version is a discounted upgrade. Lifetime updates for
  one payment leave no income to fund the work once early buyers have paid.

The build pipeline mostly exists already. `.github/workflows/release.yml`
(from upstream) builds and signs Windows, macOS (Apple Silicon and Intel,
signed and notarized) and Linux (AppImage and deb). It has never run in this
repository, and no secrets are set (`gh secret list` is empty).

## What exists and what is missing

| Area | Today | Missing |
| --- | --- | --- |
| Build config | `build.mac` (dmg, notarize), `build.linux` (AppImage, deb), `build.appx` (Store identity set) | mac `zip` target (needed for auto-update); a Linux `.desktop` / MIME check |
| CI | `release.yml`: preflight → Windows / Linux / macOS ×2 jobs, RIFE built per platform | Secrets; Windows job still points at upstream Azure signing names; uploads go to GitHub Releases of a **private** repo, so buyers can't download them |
| macOS signing | Workflow asserts `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Apple Developer Program membership (US$99/yr), Developer ID Application certificate, the 5 secrets |
| Platform code | Windows-only features are gated by platform checks: RTX VSR (`rtxVideoUpscale.js`), the Windows signer check, ComfyUI launcher branches, ComfyUI auto-detect looks in `/Applications` on Mac | One pass on a real Mac and Linux PC (list below); the Companion native host registers on Windows only |
| Updates | None (no `electron-updater`); the Store updates Windows | Auto-update for direct mac/linux builds |
| Licensing | None | License activation, trial/limits, purchase links |

## 1. Payments and licensing

### Provider: Stripe (decided)

Stripe is a payment processor, **not a merchant of record**. The owner is the
legal seller:

- Turn on **Stripe Tax** so tax is calculated and collected at checkout.
- Register where the thresholds require it, for example EU VAT (OSS), UK VAT
  and US states. Stripe Tax shows which registrations are due.
- Stripe sends receipts. Refunds are done in the Stripe dashboard.

Stripe has no license keys, so we add two small pieces:

```
Stripe Checkout (Payment Link) ──webhook──> Cloudflare Worker ──> license key
        │                                       │                     │
   buyer pays                       checks the Stripe signature,   shown on the
                                    signs the key, logs the sale   success page + emailed
                                    in KV, sends the email
App: verifies the key's signature offline with the public key built into it
```

- **License key** = base64url of `{ v: 1, sku: "ds1", email, order, issued }`
  plus an **Ed25519 signature**. The private key lives only as a Worker
  secret; the app holds the public key. A key can't be forged, and checking it
  needs no internet.
- **Device limit (optional, phase 2):** the app calls the Worker's `/activate`
  with the key and a random install id. The Worker counts installs per order in
  KV, allows 3, and frees one on `/deactivate`. With no internet the app trusts
  the signed key, so the limit is a soft one.
- **Worker routes:**
  - `POST /stripe/webhook` (`checkout.session.completed`): checks the Stripe
    signature and issues the key.
  - `GET /license?session_id=…`: lets the success page show the key.
  - `POST /activate` and `POST /deactivate`: phase 2.
  - `POST /resend`: emails the key again to the purchase email.
- **Where it lives:** `infra/license-worker/` next to the existing
  `infra/feedback-worker` idea. Its secrets are the Stripe webhook secret and
  the Ed25519 private key; neither is ever committed.
- Lemon Squeezy (owned by Stripe) or Stripe's own merchant-of-record offer
  stays an option if handling tax yourself becomes too much. Only the Worker
  would change; the app's key check stays the same.

### Products

- **Drama Studio 1 — direct (macOS, Linux, Windows)**: one-time price,
  3 activations, updates through 1.x.
- **Drama Studio on the Microsoft Store**: the same price on the Store. It's a
  separate purchase: Store licenses can't be checked outside Windows. A buyer
  who wants a second platform emails the Store receipt and gets a discount
  code (manual at first).

### Free use before buying: trial, then read-only (decided)

- **14 days with everything.**
- **After that, read-only until a key is entered.** Projects open, play and
  show their timelines. Editing, generating and exporting ask for a key.
- **Never hostage:**
  - "Open project folder" stays available, so media and project files are
    always reachable outside the app.
  - Help, Settings and buying always work.
- **On the Store:** use the Store's own free trial, then the same read-only
  state, read from the Store license API.

### In the app (direct builds only)

- `electron/license.cjs` (main process), behind IPC `license:status`,
  `license:activate`, `license:deactivate`:
  - **Activate:** verify the key's Ed25519 signature and `sku` with the
    built-in public key (Node `crypto.verify`, no network). Store it
    encrypted with Electron `safeStorage`.
  - **Phase 2:** also register the install with the Worker, and free it with
    "Move to another computer".
  - A key for another product or major version (`sku` other than `ds1`) is
    refused with a plain message and the upgrade link.
- Trial start date is kept in the same encrypted record and in a second
  location, so reinstalling doesn't silently reset it. Determined users can
  reset it anyway; that's acceptable.
- The Store build (`process.windowsStore`) skips all of this and asks the
  Store for its license instead.
- Renderer:
  - Settings › **License**: status, enter key, buy link, move to another
    computer.
  - A quiet "Trial: 9 days left" chip in the top bar.
  - In read-only mode, edit, generate and export actions open a "Buy or enter
    your key" dialog instead of running. The timeline store refuses edits, so
    the command palette, the Assistant and agents are covered too. Plain-language Help Center article "Buying and activating
  Drama Studio".
- Tests: pure helpers (trial math, grace period, response checks) in
  `src/utils/license*.mjs` with node tests: the signature check, a forged
  key, a wrong product, trial math and clock rollback. The Worker gets its own
  tests with a fake Stripe event.

### The GPL constraint

Drama Studio is a GPL-3.0 fork, so it cannot be relicensed:

- Selling it is allowed. Buyers must get the source code (a public repository,
  or a written offer valid for three years).
- Anyone may build it from source with the license check removed and give it
  away. The license check is a **convenience gate for honest buyers**, not
  copy protection. Keep it simple and don't spend effort on obfuscation.
- What people really pay for: signed, notarized builds that just install,
  automatic updates, support, and content and services we own outright (packs,
  prompt sets, cloud credits, the course).
- **Get advice from an open-source licensing lawyer before launch.**

## 2. Downloads and updates

- Buyers download from jepoy.dev. Builds can be public: the key gates use,
  not the download. Host the files on **Cloudflare R2**, which the project
  already uses, behind `downloads.jepoy.dev`. Or use a separate **public**
  GitHub releases repository: the main repository is private, so its release
  files can't be downloaded by buyers.
- Add **`electron-updater`** for direct builds, with a generic provider pointed
  at the same bucket (`latest-mac.yml`, `latest-linux.yml`):
  - macOS needs the `zip` target next to the `dmg`, and a signed app;
    otherwise the update can't apply.
  - Linux: AppImage updates itself. The `.deb` doesn't; tell deb users to
    download new versions. An apt repository can come later.
  - Ask before installing an update, and show what's new from the changelog.
  - Turn the updater off for the Store build and when running from source.
- The release workflow uploads to the bucket after all jobs pass. Tags stay
  owner-approved, as today.

## 3. CI changes (`release.yml`)

1. Windows job:
   - Replace the upstream Azure signing names with our own, once there is a
     signing account.
   - Until then, build only the **Store `.appx`**, which needs no signing,
     plus an unsigned portable exe for testers.
2. macOS jobs:
   - Add the 5 Apple secrets.
   - Add the `zip` target.
   - Keep the existing notarization pre-check.
3. Linux job: build AppImage and deb, then smoke-launch the AppImage under
   `xvfb-run` (open, show the welcome screen, quit).
4. Last job:
   - Upload the release files and update manifests to R2.
   - Draft the GitHub release.
   - Post to Discord (the `discord-release.yml` workflow exists).
5. Run the whole pipeline on a `v0.x.y-rc` tag first, which needs the owner's
   OK.

## 4. Platform pass (real hardware)

| Check | macOS (Apple Silicon) | macOS (Intel) | Linux (Ubuntu 24.04, NVIDIA) |
| --- | --- | --- | --- |
| Opens, Gatekeeper accepts it (no "unidentified developer") | yes | yes | n/a |
| ComfyUI found / connect / cloud-only path | Comfy Desktop for Mac in `/Applications` | Comfy Desktop | Manual install or URL |
| Local AI | Apple GPU (MPS); slower, smaller models | Mostly cloud | CUDA |
| Export | Hardware encoder (VideoToolbox) and software fallback | Same | NVENC and software fallback |
| Smooth motion (RIFE) | Vulkan via MoltenVK (CI builds it) | Same | Vulkan |
| Captions (Whisper) | `whisper-mac-engine.yml` exists | Same | CPU / CUDA |
| Fonts, file dialogs, drag and drop, the packs importer | yes | yes | yes |
| Features to hide | RTX Video Super Resolution (Windows + NVIDIA only) | Same | Same |
| Companion native host | Manifest in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | Same | `~/.config/google-chrome/NativeMessagingHosts/` |

Without a Mac or Linux PC, the minimum is the CI smoke launch plus one owner
test on a borrowed Mac before a public launch.

## 5. Order of work

1. Owner decisions (below). Join the Apple Developer Program, which can take a
   few days for an individual.
2. Licensing in the app: key check, Settings › License, trial, read-only
   mode, with tests. Direct builds only. **M**
3. License Worker (`infra/license-worker/`): Stripe webhook, signed keys,
   success page and email; Stripe Payment Link with Stripe Tax on. **S–M**
4. CI: secrets, mac `zip`, Linux smoke test, upload to R2, an rc tag. **S–M**
5. `electron-updater` for direct builds. **S**
6. Platform pass on real hardware, then fix what it finds. **M**
7. Store listing price and trial; checkout page and download page on
   jepoy.dev; Help Center articles; update the privacy policy (license
   activation sends the key and the computer name to the payment provider). **S**

## Owner decisions

Decided 2026-10-17:

- Payments: **Stripe**, with signed license keys from a Cloudflare Worker.
- Before buying: **14-day trial, then read-only**.
- Windows: **Microsoft Store only**.

Still open:

1. Price, and whether 1.x updates are free with a paid 2.0 (recommended), or
   free updates for 12 months.
2. Device limit: soft limit of 3 through the Worker (phase 2), or no limit.
3. Where downloads live: R2 at downloads.jepoy.dev (recommended), or a public
   releases repository.
4. Which countries Stripe Tax should collect in, and the registrations that
   requires.
5. A lawyer's check on selling a GPL-3.0 fork, and how the source is offered.
