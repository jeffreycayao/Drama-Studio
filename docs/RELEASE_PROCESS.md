# Release Process

Use GitHub Actions for desktop releases.

Normal development stays on Windows.
GitHub builds Windows, macOS, and Linux for release tags.
macOS signing and notarization happen in GitHub Actions.

Future AI agents should also read `docs/AI_RELEASE_HANDOFF.md` before release work.

## One-Time Setup

- Keep the release workflow on `main`: `.github/workflows/release.yml`
- Keep the required repository secrets set in GitHub Actions
- For secret names and setup details, read `docs/CI_SECRETS.md`

## Normal Release

Drama Studio Companion shares the app's version. `scripts/bump-version.cjs`
writes it into `extensions/companion` too, and the release workflow's first
step (`scripts/check-version-sync.cjs --tag …`) stops a release whose app,
Companion and tag versions differ. After the release, upload the new
Companion zip (`extensions/companion`: `npm run ci`, file in `.output/`) to
the Chrome Web Store.

1. Update the version with `node scripts/bump-version.cjs set x.y.z` (or `version:patch|minor|major`).
2. Update the release notes doc for that version.
3. Commit and push the release changes to `main`.
4. Create and push the release tag:

```bash
git tag v0.1.12
git push origin v0.1.12
```

5. Open `Actions > Release Desktop Builds`.
6. Wait for all jobs to turn green.
7. Open the draft release GitHub created.
8. Replace the draft text with the real release notes.
9. Verify the uploaded assets:
   - `Windows Installer`
   - `Windows Portable`
   - `Mac (Apple Silicon)`
   - `Mac (Intel)`
   - `Linux AppImage`
   - `Linux deb`
10. Publish the release.

Without signing secrets the run still succeeds: Windows is built unsigned and macOS is skipped (see `docs/CI_SECRETS.md`, "Without Signing Secrets").

## What The Workflow Uploads

The workflow uploads only the user-facing desktop downloads:

- Windows installer `.exe`
- Windows portable `.exe`
- macOS Apple Silicon `.dmg`
- macOS Intel `.dmg`
- Linux AppImage `.AppImage`
- Linux Debian package `.deb`

It also uploads the auto-update files: `latest.yml` and the installer's `.blockmap` (Windows) and `latest-linux.yml` (Linux AppImage). Installed copies only see **published** releases, so publishing the draft is what ships the update to everyone; check the draft before you publish it. Mac auto-update would also need a `zip` target and `latest-mac.yml`; until then the Mac app only shows a "new version" notice.

## One-click release (Release Drama Studio.bat)

Double-click **Release Drama Studio.bat** in the repository root. A window shows the version on `main`, the next version (patch, minor or major), the Unreleased notes from `CHANGELOG.md` and any open pull requests that are not included. Nothing happens until you click **Build and release** and confirm. It then:

1. bumps the version on `release/vX.Y.Z` in a temporary worktree made from `origin/main` (your checkout is not touched),
2. opens a pull request, waits for the required checks and merges it (admin merge, because `main` requires a pull request),
3. tags the merge commit and waits for the **Release Desktop Builds** workflow,
4. writes the release notes from the CHANGELOG,
5. asks again before publishing: publishing reaches every installed copy through auto-update and is announced on Discord.

Needs git, node and the GitHub CLI signed in (`gh auth login`). Tick **Dry run** to try it without pushing anything; `scripts/release-ui.ps1 -SelfTest` does a dry run without the window.

## Safe Test Run

If you want to test the workflow without touching a real release, use a throwaway tag:

```bash
git tag -a v0.1.11-ci-test -m "Test GitHub Actions release workflow"
git push origin refs/tags/v0.1.11-ci-test
```

Then watch the Actions run and inspect the draft release GitHub creates.

## Clean Up A Test Run

1. Delete the test release on GitHub.
2. Delete the remote test tag:

```bash
git push origin :refs/tags/v0.1.11-ci-test
```

3. Delete the local test tag:

```bash
git tag -d v0.1.11-ci-test
```

## If A Release Fails

- If Windows fails, open the failed job and read the last step first.
- If macOS fails, check secrets and notarization first.
- For macOS secrets and troubleshooting, read `docs/CI_SECRETS.md`.

## Rules

- Do not commit secrets, certificates, `.p12` files, passwords, or API keys.
- Do not invent a different Mac release flow unless the user asks for it.
- For release work, prefer the GitHub Actions workflow over manual local packaging.
