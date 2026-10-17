import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

describe('runtime asset policy', () => {
  it('uses no remote scripts, stylesheets, font CSS, or runtime font assets', async () => {
    const files = [
      'index.html',
      'src/main.tsx',
      'src/styles/app.css',
      'vite.config.ts',
    ];
    const source = (
      await Promise.all(
        files.map((file) => readFile(path.join(projectRoot, file), 'utf8')),
      )
    ).join('\n');

    expect(source).not.toMatch(/<script[^>]+src=["']https?:/iu);
    expect(source).not.toMatch(/<link[^>]+href=["']https?:/iu);
    expect(source).not.toMatch(/@import\s+(?:url\()?\s*["']?https?:/iu);
    expect(source).not.toMatch(/url\(\s*["']?https?:/iu);
    expect(source).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/iu);
  });

  it('imports typography only through the local brand workspace', async () => {
    const source = await readFile(
      path.join(projectRoot, 'src', 'main.tsx'),
      'utf8',
    );

    expect(source).toContain(
      "import '@faceless-automations/brand/styles.css';",
    );
  });
});
