import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolutePath)));
    if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name))
      files.push(absolutePath);
  }
  return files;
}

describe('admin console security policy', () => {
  it('contains no provider secret, secret-like public variable or browser token persistence', async () => {
    const files = await sourceFiles(path.join(projectRoot, 'src'));
    const source = (
      await Promise.all(files.map((file) => readFile(file, 'utf8')))
    ).join('\n');

    expect(source).not.toMatch(
      /\bVITE_[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD)\b/u,
    );
    expect(source).not.toMatch(/\b(?:sk_live_|rk_live_|whsec_)[A-Za-z0-9_-]+/u);
    expect(source).not.toMatch(/\bGOOGLE_CLIENT_SECRET\b/u);
    expect(source).not.toMatch(/\bSTRIPE_SECRET_KEY\b/u);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\b/u);
  });

  it('requires role verification and per-session CSRF for admin mutations', async () => {
    const api = await readFile(
      path.join(projectRoot, 'src', 'admin', 'api.ts'),
      'utf8',
    );
    const gate = await readFile(
      path.join(projectRoot, 'src', 'admin', 'AdminGate.tsx'),
      'utf8',
    );

    expect(gate).toContain("state.status === 'authorized'");
    expect(gate).toContain('<Outlet />');
    expect(api).toContain("role: z.literal('admin')");
    expect(api).toContain("headers.set('X-Faceless-CSRF', csrfToken)");
    expect(api).toContain("credentials: 'include'");
    expect(api).toContain("redirect: 'error'");
  });

  it('registers every requested admin route behind the shared gate', async () => {
    const router = await readFile(
      path.join(projectRoot, 'src', 'app', 'router.tsx'),
      'utf8',
    );

    for (const route of [
      "path: '/admin'",
      "path: 'platform'",
      "path: 'users'",
      "path: 'entitlements'",
      "path: 'audit'",
      "path: 'guides'",
      "path: 'guides/new'",
      "path: 'guides/:slug/edit'",
    ]) {
      expect(router).toContain(route);
    }
  });

  it('uses shared structured guide contracts and never injects guide markup', async () => {
    const api = await readFile(
      path.join(projectRoot, 'src', 'admin', 'api.ts'),
      'utf8',
    );
    const guidePage = await readFile(
      path.join(projectRoot, 'src', 'pages', 'GuidePage.tsx'),
      'utf8',
    );
    const guideEditor = await readFile(
      path.join(projectRoot, 'src', 'pages', 'admin', 'GuideEditorPage.tsx'),
      'utf8',
    );
    const router = await readFile(
      path.join(projectRoot, 'src', 'app', 'router.tsx'),
      'utf8',
    );

    expect(api).toContain("from '@faceless-automations/platform-contracts'");
    expect(api).toContain('createGuideRequestSchema');
    expect(api).toContain('updateGuideRequestSchema');
    expect(router).toContain("path: '/guide/:slug'");
    expect(`${guidePage}\n${guideEditor}`).not.toContain(
      'dangerouslySetInnerHTML',
    );
    expect(`${guidePage}\n${guideEditor}`).not.toMatch(/\binnerHTML\b/u);
  });

  it('binds development networking to the exact configured API origin', async () => {
    const viteConfig = await readFile(
      path.join(projectRoot, 'vite.config.ts'),
      'utf8',
    );
    const publicEnvironment = await readFile(
      path.join(projectRoot, 'src', 'config', 'public-env.ts'),
      'utf8',
    );

    expect(viteConfig).toContain('host: true');
    expect(viteConfig).toContain('port: 5173');
    expect(viteConfig).toContain('strictPort: true');
    expect(viteConfig).toContain('PLATFORM_DEV_API_TARGET');
    expect(viteConfig).toContain("'/v1'");
    expect(viteConfig).toContain("'/health'");
    expect(viteConfig).toContain('changeOrigin: true');
    expect(viteConfig).toContain("connect-src 'self'");
    expect(viteConfig).toContain('VITE_PLATFORM_API_ORIGIN');
    expect(publicEnvironment).toContain('isPrivateIpv4');
    expect(publicEnvironment).toContain('allowInsecureDevelopment');
    expect(publicEnvironment).toContain('https://paks-tools.vercel.app');
  });
});
