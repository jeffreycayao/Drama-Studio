# Open-source readiness audit

Date: 2026-10-20. Branch: `drama-studio-rebrand-agent-setup` (app version 0.6.4).
Scope: the working tree, every commit reachable from any local or remote-tracking ref (83 commits, plus the stash), and the build output folders on the maintainer's machine.

This is a preparation report. Nothing here has been deleted, rewritten or made public. Items marked **Blocker** should be settled before the repository is made public.

## Summary of blockers

| # | Blocker | Owner action |
| --- | --- | --- |
| B1 | Third-party browser-extension code in history and in the Companion: code derived from "Grok Automation 2.6.3" (Chris.dev / Paks Tools) and the "Sellify" long-prompt helper, with rights unresolved | Get written permission, **or** remove the derived code from the Companion **and** rewrite history to drop commit `26f9b04`'s `extensions/ds-chrome-automator/` and `extensions/ds-long-prompt-helper/` trees |
| B2 | Release config still uses the upstream publisher's Azure signing account names | Create your own Azure Trusted Signing account and profile, update `package.json` and CI secrets |
| B3 | Branch protection and private vulnerability reporting are not available while the repo is private on the free plan | After going public (or on GitHub Pro): protect `main`, require a pull request with 1 approval and Code Owner review, require status checks, block force-pushes; enable private vulnerability reporting |
| B4 | Internal planning and handoff documents (business plans, Store identity notes, AI handoffs with other people's local paths) | Decide which of the files in [§4](#4-internal-documents) stay public; move the rest to a private place |

No live secret was found in the tracked files or anywhere in git history (details in §1). Nothing needs rotating because of what is in the repository today.

## 1. Secrets

### How the scan was done

- No gitleaks or trufflehog was installed, so a regex scanner was run over **every blob reachable from `git rev-list --objects --all`** (all branches, remote-tracking refs and the stash), not only the current tree. It looked for: AWS/R2-style access keys and secrets, Cloudflare and R2 tokens, account endpoints and `pub-*.r2.dev` buckets, Azure connection strings and client secrets, Apple app-specific passwords, Stripe `sk_/rk_/pk_` keys and `whsec_` secrets, GitHub, OpenAI, Anthropic, Google, Hugging Face, ElevenLabs, Slack and Comfy keys, JWTs, PEM private keys, Discord/Slack webhook URLs, and generic `password/secret/api_key = "…"` assignments.
- File names in history were checked for `.env*`, `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.p8`, `*.cer`, `*.crt`, keystores, `*_keys.txt`, `credentials*` and `*secret*`.
- The values in the local, ignored `R2_Read_only_keys.txt` were searched for (by exact match, without printing them) in every tracked file, all of history, and the local `dist/`, `release/`, `build/`, `public/`, `src/`, `electron/`, `docs/` and `scripts/` folders.
- All 83 commits use the `jeffreycayao@users.noreply.github.com` address; no personal email is in the commit metadata.

### Findings

| What | Where | Risk | Action |
| --- | --- | --- | --- |
| `R2_Read_only_keys.txt` (Cloudflare R2 read-only keys) | Repository root, **untracked**; ignored by `.gitignore` (`R2_Read_only_keys.txt`, `*_keys.txt`); never committed; `scripts/package-content-gate.cjs` refuses it in packages | Low while ignored. One `git add -f` or a changed ignore rule would publish it, and anyone with a copy of the folder has it | Move the file out of the repository folder (for example to a password manager). Rotate the keys if the folder has ever been zipped, shared or synced. See the result of the leak check below |
| AWS documentation example key `AKIAIO…` / `wJalrX…` | `tests/sfxR2Pack.test.cjs:51` | None. These are the public AWS example values | Keep |
| `rk_tes…` placeholder Stripe key | History only: `extensions/ds-chrome-automator/apps/faceless-platform-api/tests/stripe.test.ts` (commit `26f9b04`) | None as a secret (fake test value). It belongs to the third-party code in B1 | Goes away with the B1 history rewrite |
| `.env.example` with two service-origin variables (no credentials) | History only: `extensions/ds-chrome-automator/apps/grok-automator/.env.example` | None as a secret. It names the third party's Vercel deployments | Goes away with the B1 history rewrite |
| `docs/CI_SECRETS.md` | Tracked | None. It lists secret **names** and setup steps; no values | Keep |
| CI secret names: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `DISCORD_RELEASE_WEBHOOK` | `.github/workflows/*.yml` (read from GitHub secrets) | Low. Values are not in the repo. On a public repo, workflows from fork pull requests do not get secrets, and `release.yml` only runs on tags and manual dispatch | Keep. Before going public, check that no workflow uses `pull_request_target` (none does today) and that GitHub Actions' "Require approval for fork pull requests" is on |
| `.mcp.json` | Tracked; only points at `http://127.0.0.1:19790/mcp` | None | Keep (it has local edits that are not part of this change) |

Result of the R2 key leak check: the file holds three key values (two 32-character and one 64-character hex string). **None of them appears in any tracked file or in any commit of history.** The only match was a field-name label (`aws…`, 21 characters) that also appears in `electron/r2Client.cjs`; it is not a secret. The local `dist/`, `release/` (unpacked `app.asar` files included), `build/`, `public/`, `src/`, `electron/`, `docs/` and `scripts/` folders also contain none of the values. Single files over 300 MB, meaning the packed installers, were skipped, but their `app.asar` contents were checked unpacked.

## 2. Licensing

| What | Where | Status / risk | Action |
| --- | --- | --- | --- |
| No `LICENSE` file had ever been committed | Whole history | **Fixed in this change.** Distributing a GPL program without the license text breaks GPL §4 | `LICENSE` is now the upstream project's license file unchanged (the standard FSF GPLv3 text; its SHA-256 matches the copies in `ffmpeg-static` and `@derhuerst/ffprobe-static`) |
| Copyright lines | New `NOTICE` | Added: Drama Studio's copyright (Jeffrey Cayao and Drama Studio contributors), the upstream copyright (Velorn contributors, formerly ComfyStudio contributors), the GPL-3.0-only grant, and the MIT notice for code from the upstream releases before its 2026-06-30 relicensing. The fork comes from upstream v0.3.37, which is after that date | Confirm the trademark sentence in `NOTICE` and the README matches what you want to claim |
| `package.json` `"license"` | Root | `GPL-3.0-only`, matches | — |
| `extensions/companion/package.json` `"license"` | Companion | Was missing. Now `GPL-3.0-only` (and in its lockfile root entry) | Only valid once B1 is resolved; the Companion can only be GPL if you hold the rights to all of its code |
| `.github/workflows/cla-check.yml` required a "Contributor License Agreement" checkbox, and the template pointed at `CONTRIBUTOR_LICENSE_AGREEMENT.md`, which does not exist (an upstream leftover) | `.github` | Every pull request would have failed or agreed to a document that does not exist | Replaced with `pr-checklist.yml`: it requires the contribution-rights box (inbound = outbound GPL-3.0-only) and exactly one AI-disclosure box. **Owner decision:** if you want to sell or relicense Drama Studio later (see `docs/PLAN_MAC_LINUX_AND_PAYMENTS.md`), you need a real CLA from contributors; that is a legal document to get drafted, not something to improvise |
| FFmpeg / FFprobe | npm `ffmpeg-static` 5.3.0, `@derhuerst/ffprobe-static` 5.3.0, copied into `resources/bin` at packaging | GPL builds. Packaged apps must ship their licenses and a way to get the corresponding source | Already handled by `scripts/organize-licenses.cjs` and the release gate. Keep, and say in the release notes where FFmpeg source can be obtained |
| RIFE smooth-motion runtime and `rife-v4.6` model | Built in CI by `scripts/rife-runtime/build.py`; not in the repo | Licenses are collected per `docs/RIFE_RUNTIME.md` (rife-ncnn-vulkan, ncnn, glslang, stb, Practical-RIFE models, MoltenVK) | Keep |
| whisper.cpp macOS engine | Downloaded from this repo's GitHub Releases (`electron/captionWhisper.js`) | It works once the repo is public. The release must carry whisper.cpp's MIT license | Check the `whisper-cli-v1.9.1-mac` release asset includes the license |
| Fonts: Inter, Sora, JetBrains Mono | `public/fonts/*.woff2`, `extensions/companion/store/src/fonts/*.woff2`, and the `@fontsource-variable/*` packages | SIL OFL 1.1, fine to redistribute with the license. The Companion's `THIRD_PARTY_NOTICES.md` has the OFL text; the copies under `public/fonts/` and `extensions/companion/store/src/fonts/` have no license file beside them in the repo | Add `OFL.txt` next to those two font folders |
| Companion libraries | `extensions/companion/public/licenses/` (Tabler MIT, SheetJS Apache-2.0) | Notices present | Keep; these must ship |
| Bundled ComfyUI workflow JSON (`public/workflows/`, 47 files) and setup cover images/videos (`public/workflows/setup-covers/`, 37 files) | Inherited from upstream (first commit `9a7af49`) | Covered by the upstream GPL grant as far as the upstream author held the rights. Some graphs follow ComfyUI's official templates, and some covers look like model outputs | Low. Keep. If you can, check that cover media was made by upstream or by you, not copied from template sites |
| Sample media | `public/kling_o3_i2v_00002_.mp4` (23 MB), `public/test_video.mp4` (14 MB), `public/welcome-hero.mp4`, `public/hero-v1.webp`, splash images | Inherited from upstream. The two large test clips are only used by `mockups/generate-redesign.html` and look like AI outputs (Kling) with embedded workflow metadata that still names the upstream product | Remove `kling_o3_i2v_00002_.mp4` and `test_video.mp4` (37 MB the app does not need), or replace them with media you made yourself |
| Store and brand art | `build/appx/*.png`, `build/icons/`, `branding/`, `public/brand/`, `extensions/companion/store/assets/`, `docs/readme/` screenshots | Drama Studio's own branding | Keep; the trademark sentence in `NOTICE` covers the names and logos |
| Executables, model weights, audio | Searched across all history | None ever committed (no `.exe`, `.dll`, `.so`, `.dylib`, `.node`, `.onnx`, `.pth`, `.safetensors`, `.ckpt`, `.mp3`, `.wav`, `.zip`, `.msix`, `.crx`, `.pem`, `.pfx`) | — |
| SFX packs | Not in the repo. The app reads a catalog URL the user configures; R2 credentials are entered by the user and stored encrypted with Electron `safeStorage` | Fine. A test fixture names a bucket `sfx-drama-studio` | Keep. Make sure the SFX pack files you host have redistribution rights for the people who download them |

## 3. Third-party and proprietary code

### B1: Companion code derived from other extensions (Blocker)

- **What:** Commit `26f9b04` (2026-10-17, "Bring the browser extensions into the repo and plan the Companion") added about 72,000 lines in `extensions/ds-chrome-automator/` (a WXT/Vue rebuild of the signed "Grok Automation 2.6.3", branded Paks Tools / Chris.dev / PAKS LLC, with its `faceless-platform-api` and `faceless-automation-dashboard` apps and Stripe integration) and `extensions/ds-long-prompt-helper/` (the "Sellify™ AI Connector"). Commit `078328e` merged them into `extensions/companion/` and removed the originals from the tree. The originals are still in history.
- **Where it lives on:** `extensions/companion/` (the Grok batch runner in `content/`, the prompt-fill code). `TRACKER.md` line 50, `docs/PLAN_BROWSER_EXTENSIONS.md` §7 and `extensions/companion/store/LISTING.md` all say the rights are **unresolved**. The Companion is also already **published in the Chrome Web Store** (approved 2026-10-19), so this is a live question, not only an open-source one.
- **Risk:** High. Publishing the repository would publish another party's code under GPL without permission (copyright and possibly trademark claims), and expose their product's internals and service URLs. `docs/PLAN_BROWSER_EXTENSIONS.md` names the original folder paths and products.
- **Recommended action** (choose one):
  1. Get **written permission** from the rights holders to publish the derived code under GPL-3.0-only, and keep it with a notice in `extensions/companion/public/THIRD_PARTY_NOTICES.md`; or
  2. **Clean-room rewrite** or remove the derived parts of the Companion (batch runner, prompt fill), **and rewrite history** so `extensions/ds-chrome-automator/` and `extensions/ds-long-prompt-helper/` never appear (for example `git filter-repo --path extensions/ds-chrome-automator --path extensions/ds-long-prompt-helper --invert-paths`, then force-push every branch and tag, and ask GitHub Support to purge cached views and pull-request refs). The Companion files that were derived would also have to be dropped from history, so the simpler route may be to publish a **fresh repository** with a single squashed initial commit of the cleaned tree.
- Also review: the Grok batch mode automates a third-party site (`LISTING.md` notes reviewers may question it). Check the site's terms before promoting it.

### Upstream branding still present

| What | Where | Risk | Action |
| --- | --- | --- | --- |
| Azure signing account `velorn-signing`, profile `velorn-public` (**B2**) | `package.json` `build.win.azureSignOptions` (publisher name is already "Jeffrey Cayao") | Medium. Signing would fail or, worse, depend on someone else's account; it also shows the upstream identity in your release config | Create your own Azure Trusted Signing account and certificate profile, then update these two names and the `AZURE_*` secrets (TRACKER.md line 93) |
| `public/ComfyStudio_Project_Selection_Screen_BG.png` | Excluded from packages by `package.json` (`!dist/ComfyStudio_…`) | Low. Upstream-named file in the repo | Remove or rename it if nothing uses it |
| Legacy identifiers: `comfystudio`/`velorn` prefixes, `list_velorn_workflows` MCP aliases, `COMFYSTUDIO_*`/`VELORN_*` marker titles, `createComfyStudioMcpServer`, the old `%APPDATA%` folder name | `electron/`, `src/` (119 files mention `comfystudio`) | None. These are compatibility identifiers allowed by `AGENTS.md` | Keep |
| Upstream release notes `docs/RELEASE_NOTES_0.1.x`–`0.3.37`, upstream issue references | `docs/` | Low. Upstream history and contributor handles (for example `@dakipro`) | Keep as history, or move into `docs/upstream/` |

### Links and identities

| What | Where | Risk | Action |
| --- | --- | --- | --- |
| Affiliate link `https://curzzo.com/ref/…` behind the gold "Learn AI" button | `src/config/projectInfo.js:17` | Medium. Fine in a GPL app, but forks will carry your referral code, and open-source users may see an undisclosed affiliate link as a red flag | Label it as a partner link in the UI and README, or move it to a build-time setting so forks can change it |
| Discover catalog default URL `raw.githubusercontent.com/jeffreycayao/Drama-Studio/main/public/discover/catalog.json` | `src/services/discoverCatalog.mjs:4` | None after publishing. Today it is a private URL that returns 404 for everyone outside the repo | Keep; it starts working when the repo is public |
| whisper-cli download from this repo's Releases | `electron/captionWhisper.js:40` | Same: private until public | Keep |
| Microsoft Store / Partner Center identity `JEPOY.DramaStudio`, `CN=632EB17B-…` | `package.json` `build.appx` | Low. Public in the Store listing anyway. Forks must not publish under it | Keep; mention in CONTRIBUTING or release docs that forks need their own identity |
| Chrome Web Store ID `inkjhigflcgkaganbiepogcpcfgndfog` | `src/config/projectInfo.js`, `extensions/companion/store/identity.json` | Low. Public. `identity.json` holds no private key | Keep |
| Maintainer contact `hi@jepoy.dev` | `package.json` Linux maintainer field, now also `SECURITY.md` | Intended | Make sure the inbox exists |
| `infra/feedback-worker/` | Cloudflare Worker source, no `wrangler.toml`, no account ids or URLs | None | Keep |

## 4. Internal documents

These files were written for the private repository. Publishing them is not a secret leak, but some say more than you may want public. Recommended: **keep** the user and developer docs, and **review or move out** the rest.

| File | What is in it | Recommendation |
| --- | --- | --- |
| `docs/PLAN_MAC_LINUX_AND_PAYMENTS.md` | Plans for selling the app, payment providers, pricing and legal questions | Move out |
| `docs/MSIX_STORE_ASSESSMENT.md` | Store certification notes, Partner Center identity, signing details | Move out, or trim |
| `docs/AI_CURRENT_HANDOFF.md`, `docs/AI_PROJECT_CONTEXT.md`, `docs/AI_RELEASE_HANDOFF.md`, `docs/AI_HANDOFF_NVENC_TEST.md` | Agent handoff notes, including the upstream author's local paths (`C:\Users\papa\…`), old worktree names and upstream commit ids | Trim the personal paths and upstream details, or move out. `AGENTS.md` points agents at these files, so update it if they move |
| `docs/PLAN_BROWSER_EXTENSIONS.md` | Names the third-party extensions, their original folders and the rights question | Must be rewritten or removed together with B1 |
| `docs/PLAN_MOTION_STUDIO.md` | Mentions a local folder on the maintainer's machine and an AGPL project | Trim the local path |
| `TRACKER.md`, `docs/BACKLOG.md`, `docs/FEATURE_TRACKER.md`, `docs/AUDIT_SCORECARD_2026-10-16.md`, `docs/FEATURE_AUDIT_2026-10-17.md`, `docs/WORKSPACE_COVERAGE_2026-10-16.md`, `docs/SECURITY_HARDENING_PLAN.md` | Internal task lists and audits; the security plan lists known weaknesses | Review. Publish open hardening items only after they are fixed, or move them to private issues |
| `mockups/`, `DEMO_VIDEO_SCRIPT.md`, `docs/ux/UX_FLOW_MAP.html` | Design drafts and marketing script | Keep or move out; no risk |

## 5. Repository hygiene before going public

- **Branches.** `origin` has 15 branches besides `main` (`claude/*`, `feature/*`, `release/*`, `fix/*`, `chore/*`). All of them become public. Delete merged or abandoned ones, and make sure none still contain `extensions/ds-chrome-automator` or `extensions/ds-long-prompt-helper` (B1). Local-only branches are not pushed, but check before any `--all` push.
- **Size.** The pack is 165 MB, mostly media in history. A history rewrite for B1 is a good moment to also drop the two unused sample videos.
- **Protection (B3).** GitHub refuses branch protection on this private repo on the free plan ("Upgrade to GitHub Pro or make this repository public"). Right after the repo is public, set up a ruleset for `main`: require a pull request, 1 approving review, review from Code Owners (`.github/CODEOWNERS`), status checks (PR Checklist and the CI jobs), no force-pushes, no deletions, and include administrators.
- **Single maintainer.** GitHub does not let authors approve their own pull requests. While you are the only maintainer, your own pull requests (including the ones AI sessions open for you) cannot get a second human approval. Either add a second maintainer to `CODEOWNERS`, or allow yourself to bypass the rule and record the security and logic reviews in the pull request's maintainer checklist before you merge.
- **Security reporting.** Enable private vulnerability reporting (Settings › Code security) so the route in `SECURITY.md` works.
- **Actions.** Keep "Require approval for all outside collaborators" for fork workflows. Do not add `pull_request_target` workflows that check out pull-request code.

## 6. What this change adds

- `LICENSE` (unchanged GPLv3 text from upstream) and `NOTICE` (copyright, attribution, earlier MIT notice, third-party pointer, trademark line).
- `README.md`: open-source framing, current 0.6.x features, build-from-source steps, requirements, project structure, contributing, security and license sections; stale "private repository" and old-version notes removed. The six translations in `docs/i18n/` gained the build, contributing and license sections.
- `CONTRIBUTING.md`, rewritten `SECURITY.md`, `.github/pull_request_template.md` (AI disclosure, contribution rights, maintainer security and logic review), `.github/CODEOWNERS`, and `.github/workflows/pr-checklist.yml` replacing the CLA check.
- `"license": "GPL-3.0-only"` in the Companion's `package.json` and lockfile.
