# Security Policy

## Supported versions

Security fixes go into the latest Drama Studio release and the matching Drama Studio Companion version (they share one version number). Please check that a problem still happens on the latest release before reporting it.

## Reporting a vulnerability

**Do not report security problems in public issues, discussions, pull requests, Discord, screenshots or social posts.**

Report them privately, in either of these ways:

1. **GitHub private vulnerability reporting:** on the repository's **Security** tab, click **Report a vulnerability**.
2. **Email:** hi@jepoy.dev, with "Drama Studio security" in the subject.

Please include:

- what the problem is and what an attacker could do with it;
- the affected version or commit, and platform (Windows, macOS or Linux; Chrome or Edge for the Companion);
- clear steps to reproduce, or a minimal proof of concept;
- whether secrets, API keys or private user data may be exposed. Say that first.

Do not include real API keys, personal media or other people's data in a report.

## What happens next

- We aim to acknowledge a report within **5 working days** and to share a first assessment within **14 days**.
- We will keep you updated, agree on a disclosure date with you, and credit you in the release notes unless you prefer not to be named.
- Please give us reasonable time to release a fix before you disclose details publicly.

## Scope

High-priority areas include:

- Local file access, project folders and path handling.
- Electron IPC, preload and bridge behaviour, sandboxing and the Content Security Policy.
- The local MCP server (`127.0.0.1:19790`) and the AI Assistant's tool access.
- API key and credential storage (keys entered by users must stay on their computer and go only to the provider they chose).
- Imported packs (`.dspack`), workflow JSON, stock, sound-effect and Discover catalogs, and anything else the app downloads.
- The Drama Studio Companion browser extension and its native-messaging link to the desktop app.
- Packaging, code signing and release artifacts.

Out of scope: problems that need an attacker who already controls your user account or machine, bugs in ComfyUI or in AI sites themselves, and missing hardening that has no demonstrated impact.

## For contributors

Never commit secrets, `.env` files, certificates, signing material or key files (for example `*_keys.txt`). If you accidentally commit one, tell a maintainer privately straight away. Removing it in a later commit is not enough: the secret must be revoked or rotated. See [CONTRIBUTING.md](CONTRIBUTING.md) for the security review every AI-assisted change needs before merge.
