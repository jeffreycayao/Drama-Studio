import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceFiles = [
  'src/admin/AdminGate.tsx',
  'src/admin/AdminShell.tsx',
  'src/admin/AdminUi.tsx',
  'src/components/AutomationPreview.tsx',
  'src/pages/AuthPage.tsx',
  'src/pages/ExtensionAuthPage.tsx',
  'src/pages/GuidePage.tsx',
  'src/pages/LandingPage.tsx',
  'src/pages/admin/AuditPage.tsx',
  'src/pages/admin/EntitlementsPage.tsx',
  'src/pages/admin/GuideEditorPage.tsx',
  'src/pages/admin/GuidesPage.tsx',
  'src/pages/admin/OverviewPage.tsx',
  'src/pages/admin/PlatformPage.tsx',
  'src/pages/admin/UsersPage.tsx',
] as const;

describe('dashboard icon policy', () => {
  it('pins Tabler React icons and excludes the legacy Lucide dependency', async () => {
    const dashboardPackage = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(dashboardPackage.dependencies?.['@tabler/icons-react']).toBe(
      '3.46.0',
    );
    expect(dashboardPackage.dependencies?.['lucide-react']).toBeUndefined();
    expect(dashboardPackage.devDependencies?.['lucide-react']).toBeUndefined();
  });

  it('uses static named Tabler imports for every generic interface icon', async () => {
    const sources = await Promise.all(
      sourceFiles.map(async (file) => ({
        file,
        source: await readFile(path.join(projectRoot, file), 'utf8'),
      })),
    );

    for (const { file, source } of sources) {
      expect(source, file).not.toContain('lucide-react');
      expect(source, file).not.toMatch(
        /import\s+(?:\*\s+as|[A-Za-z_$][\w$]*)\s+from\s+['"]@tabler\/icons-react['"]/u,
      );
      expect(source, file).not.toMatch(
        /import\s*\(\s*['"]@tabler\/icons-react['"]\s*\)/u,
      );
      expect(source, file).toMatch(
        /import\s*\{[\s\S]*?\}\s*from\s*['"]@tabler\/icons-react['"]/u,
      );
    }

    const automationPreview = sources.find(
      ({ file }) => file === 'src/components/AutomationPreview.tsx',
    )?.source;
    expect(automationPreview).not.toContain('<svg');
  });

  it('retains the reviewed icon sizing and stroke visual contract', async () => {
    const styles = await readFile(
      path.join(projectRoot, 'src', 'styles', 'app.css'),
      'utf8',
    );

    expect(styles).toMatch(
      /\.arrow-icon\s*\{[^}]*width:\s*19px;[^}]*height:\s*19px;[^}]*stroke:\s*currentColor;[^}]*stroke-width:\s*1\.7;/su,
    );
    expect(styles).toMatch(
      /\.flow-node svg\s*\{[^}]*width:\s*25px;[^}]*height:\s*25px;[^}]*stroke:\s*#efefef;[^}]*stroke-width:\s*1\.5;/su,
    );
    expect(styles).toMatch(
      /\.back-link \.arrow-icon\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.flow-node svg\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/u,
    );
  });

  it('ships the complete Tabler MIT notice with the dashboard', async () => {
    const notice = await readFile(
      path.join(projectRoot, 'public', 'THIRD_PARTY_NOTICES.txt'),
      'utf8',
    );

    expect(notice).toContain('@tabler/icons-react 3.46.0');
    expect(notice).toContain('Copyright (c) 2020-2026 Paweł Kuna');
    expect(notice).toContain('MIT License');
    expect(notice).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
    );
  });
});
