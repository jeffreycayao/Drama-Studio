# Development guide

This workspace is the maintainable WXT/Vue source reconstruction of Grok
Automation. The root `../../AGENTS.md` also applies. Treat `entrypoints/` and
the clean modules under `src/` as the only active product source.

## Source boundaries

- Compiled distributions, decompiler output, and recovery-tool trees have been
  deleted. Do not reintroduce or import them.
- Keep WXT entrypoints thin. Put application behavior under `src/`.
- `wxt.config.ts` is the manifest source of truth; do not add a source
  `manifest.json`.
- Keep runtime messages and untrusted data behind Zod schemas.
- Use `storage` from `#imports` through centralized storage modules.
- Do not ship secrets, remote executable code, unsafe evaluation, source maps,
  or broad host permissions.
- Use only statically imported `@tabler/icons-vue` components for product UI
  iconography. Keep the SVG components local to the WXT bundle and preserve
  their license notice in the verified extension package.

## Required workflow

For product edits:

1. Update tests and documentation with the implementation.
2. Bump this workspace's `package.json` and add a `CHANGELOG.md` entry.
3. From the monorepo root, run `npm run check`.
4. From the root, run `npm run build`, `npm run verify:build`, `npm run zip`,
   and `npm run verify:zip`.
5. Load `apps/grok-automator/.output/chrome-mv3` in a disposable Chrome profile
   for behavior that unit tests cannot prove.

Preserve the exact PAKS LLC legal banner in every emitted JavaScript file. The
repository owner has explicitly replaced the legacy publisher signature from
the installed skill template; do not restore it in active source or artifacts.
Do not claim live Grok generation without a low-volume test on an authorized
account.
