# Drama Studio Companion: agent notes

The repository's root `AGENTS.md` also applies (brand names, visual identity,
security rules). This file adds what is specific to the extension.

- This folder is a standalone npm project. Run `npm ci` and every script from
  here, never from the app root, and never commit `node_modules`, `.output`,
  `.wxt`, `coverage` or real `.env` files.
- `wxt.config.ts` is the manifest source of truth. Permissions and host
  permissions are pinned by `scripts/verify-production-build.mjs`; change both
  together and say why in `CHANGELOG.md`.
- Keep entrypoints thin; behaviour lives in `src/`. Runtime messages and
  anything read from a page go through Zod Mini schemas.
- Site selectors live only in `src/sites/`. Do not scatter selectors through
  the automation code.
- The batch runner must keep stopping, with no retry, on a CAPTCHA, usage
  limit, moderation message or sign-in page, and must keep the health check in
  front of every batch. Never add CAPTCHA solving, limit bypassing, account
  rotation, stealth, fingerprint changes or watermark removal.
- Prompt fill never presses Send, and fills from a plain link only after the
  person presses Fill.
- Branding: "Drama Studio™ Companion" on brand surfaces (manifest name, action
  title, side-panel header, consent bar), plain "Drama Studio" in running
  text. Use the `--sf-*` tokens from `src/brand/tokens.css` (copied from the
  desktop app's `src/index.css`), never raw colours; text on lime is charcoal.
  Fonts are the desktop app's Inter, Sora and JetBrains Mono, bundled locally.
- Icons come from `@tabler/icons-vue` as static named imports.
- Do not run live Grok activity from tests or scripts. The smoke test opens
  Grok Imagine but never presses Run. Live checks are low-volume, by hand, on
  an owner-controlled account.
- For a behaviour change: update tests and docs, bump `package.json`, add a
  `CHANGELOG.md` entry, and run `npm run ci`.
