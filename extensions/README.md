# Browser extension

[`companion/`](companion/README.md) is **Drama Studio™ Companion**, the
browser extension that works alongside the Drama Studio desktop app: Grok
Imagine batches that stop at any limit, safe prompt fill for AI chat sites, and
the client side of the desktop link.

It is its own npm project: run `npm ci` and its scripts from `companion/`,
never from the app root. The plan, decisions and open work are in
[`docs/PLAN_BROWSER_EXTENSIONS.md`](../docs/PLAN_BROWSER_EXTENSIONS.md).

Never commit `node_modules`, `.output`, `.wxt`, `coverage` or real `.env`
files from this folder.
