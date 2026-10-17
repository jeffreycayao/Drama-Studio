# Browser extensions

Browser extensions that work alongside the Drama Studio desktop app. The plan,
the required changes and the desktop link are in
[`docs/PLAN_BROWSER_EXTENSIONS.md`](../docs/PLAN_BROWSER_EXTENSIONS.md).

| Folder | What it is |
| --- | --- |
| [`ds-chrome-automator/`](ds-chrome-automator/README.md) | WXT/Vue MV3 batch automator for Grok Imagine. It is its own npm-workspaces root: run `npm ci` and its scripts from that folder, never from the app root. |
| [`ds-long-prompt-helper/`](ds-long-prompt-helper/README.md) | Plain MV3 extension that fills long prompts into AI chat sites from a `#` link. Load it unpacked; there is no build step. |

Both still carry their original names and are not yet part of a Drama Studio
release. They will be merged into one **Drama Studio Companion** extension.

Never commit `node_modules`, `.output`, `.wxt`, `dist`, `.vercel` or real
`.env` files from these folders.
