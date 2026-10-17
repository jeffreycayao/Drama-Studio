# Plan: macOS and Linux releases with a one-time price (2026-10-17)

Internal planning document. Not user-facing.

## Verdict

- **Windows:** sell through the **Microsoft Store** as a paid app. The Store
  takes the payment, keeps the license and pushes updates. Nothing to build
  for licensing.
- **macOS and Linux:** sell **direct** from jepoy.dev, through a *merchant of
  record*: a payment company that is the legal seller and handles VAT and sales
  tax worldwide. It issues a **license key** that the app activates.
  - The **Mac App Store is not an option.** It requires the App Sandbox, and
    its rules forbid downloading executable code. Drama Studio starts the
    user's own ComfyUI and Python and installs add-ons on request, so neither
    works sandboxed.
  - **Linux** has no store that takes payments.
- **One key works on macOS, Linux and (optionally) direct Windows**, for one
  person on up to 3 computers.
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

### Provider

Use a merchant of record with a **built-in license key API**, so we run no
license server of our own:

| Provider | License keys | Notes |
| --- | --- | --- |
| **Lemon Squeezy** (recommended) | Built in: activate / validate / deactivate, activation limit per key | Public license endpoints need no secret in the app; check fees at signup (around 5% + 50¢ per sale) |
| Polar | Built in (license-key benefit) | Developer-focused, open source friendly |
| Paddle | No keys; add Keygen.sh | More setup, two vendors |

Owner decision: the provider. The rest of this plan assumes Lemon Squeezy.

### Products

- **Drama Studio 1 — direct (macOS, Linux, Windows)**: one-time price,
  3 activations, updates through 1.x.
- **Drama Studio on the Microsoft Store**: the same price on the Store. It's a
  separate purchase: Store licenses can't be checked outside Windows. A buyer
  who wants a second platform emails the Store receipt and gets a discount
  code (manual at first).

### Free use before buying

Owner decision. Options, in order of preference:

1. **14-day full trial, then editing stays free and export adds a small
   "Made with Drama Studio" watermark** until a key is entered. People keep
   their projects, and the reason to pay is clear.
2. 14-day trial, then read-only.
3. No trial (buy to download). Weakest for an editor people want to try.

On the Store, use its built-in trial instead (option 1 maps to "free trial,
then the same watermark", read from the Store license API).

### In the app (direct builds only)

- `electron/license.cjs` (main process), behind IPC `license:status`,
  `license:activate`, `license:deactivate`:
  - **Activate:** `POST https://api.lemonsqueezy.com/v1/licenses/activate`
    with `license_key` and `instance_name` (the computer name). Store
    `{ key, instanceId, productId, validatedAt }` encrypted with Electron
    `safeStorage`.
  - **Check:** the response's `meta.store_id` and `product_id` must match
    ours. Otherwise any key from any Lemon Squeezy store would work.
  - **Validate** on launch when more than 7 days have passed since the last
    check. With no internet, keep working for **30 days**; after that, show
    the unlicensed state until it can check again. Never block opening or
    saving projects.
  - **Deactivate** frees the seat (Settings › License › "Move to another
    computer").
- Trial start date is kept in the same encrypted record and in a second
  location, so reinstalling doesn't silently reset it. Determined users can
  reset it anyway; that's acceptable.
- The Store build (`process.windowsStore`) skips all of this and asks the
  Store for its license instead.
- Renderer: Settings › **License** (status, enter key, buy link, move to
  another computer), a quiet trial chip in the top bar, and the export
  watermark. Plain-language Help Center article "Buying and activating
  Drama Studio".
- Tests: pure helpers (trial math, grace period, response checks) in
  `src/utils/license*.mjs` with node tests; IPC tested with a fake
  license server, like the fake LLM used for the Assistant tests.

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
2. Licensing module, Settings › License, trial and watermark, with tests.
   Direct builds only. **M**
3. CI: secrets, mac `zip`, Linux smoke test, upload to R2, an rc tag. **S–M**
4. `electron-updater` for direct builds. **S**
5. Platform pass on real hardware, then fix what it finds. **M**
6. Store listing price and trial; checkout page and download page on
   jepoy.dev; Help Center articles; update the privacy policy (license
   activation sends the key and the computer name to the payment provider). **S**

## Owner decisions

1. Payment provider: Lemon Squeezy (recommended), Polar or Paddle.
2. Price, and whether 1.x updates are free with a paid 2.0 (recommended), or
   free updates for 12 months.
3. Free use before buying: trial then watermark (recommended), trial then
   read-only, or no trial.
4. Windows: Store only (recommended until there is a signing account), or also
   direct with the same key.
5. Where downloads live: R2 at downloads.jepoy.dev (recommended), or a public
   releases repository.
6. A lawyer's check on selling a GPL-3.0 fork, and how the source is offered.
