# Paks Tools Faceless automations dashboard contributor guide

The repository-root `AGENTS.md` applies in full.

- Keep this app TypeScript strict, accessible, responsive, and host-neutral.
- Preserve Google as the only sign-in method unless the owner explicitly
  changes the authentication product decision.
- Validate all public configuration at runtime and fail closed when auth setup
  is absent or invalid.
- Never ship OAuth client secrets, cookie-signing keys, provider tokens, or
  backend credentials in this workspace.
- Never load remote scripts, font CSS, runtime font files, or CDN assets.
- Consume shared typography from `@faceless-automations/brand/styles.css`.
- Use only statically imported `@tabler/icons-react` components for product UI
  iconography. The reviewed multicolor Google provider mark and decorative
  brand artwork may remain local SVG assets.
- Keep landing and auth pages route-split. Production builds use Terser and do
  not emit source maps.
- Product-visible changes update this workspace's version, README, and
  `CHANGELOG.md`, then pass the explicit root dashboard gates.
