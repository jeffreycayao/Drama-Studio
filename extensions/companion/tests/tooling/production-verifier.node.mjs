import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import {
  EXPECTED_EXTENSION_NAME,
  EXPECTED_HOST_PERMISSIONS,
  EXPECTED_OPTIONAL_PERMISSIONS,
  EXPECTED_PERMISSIONS,
  verifyProductionBuild,
} from '../../scripts/verify-production-build.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const tablerLicense = await readFile(
  path.join(projectRoot, 'public', 'licenses', 'TABLER-LICENSE.txt'),
  'utf8',
);
const notices = await readFile(
  path.join(projectRoot, 'public', 'THIRD_PARTY_NOTICES.md'),
  'utf8',
);

const TOKENS_CSS = `:root{--sf-dark-800: 39 35 27;--sf-text-primary: 246 241 230;--sf-accent: 213 250 0;--sf-on-accent: 30 27 21;--sf-accent-muted: 104 115 35}`;
const FONTS_CSS = [
  ['Inter Variable', 'inter-latin-wght-normal-AbCd1234.woff2'],
  ['Sora Variable', 'sora-latin-wght-normal-AbCd1234.woff2'],
  [
    'JetBrains Mono Variable',
    'jetbrains-mono-latin-wght-normal-AbCd1234.woff2',
  ],
]
  .map(
    ([family, file]) =>
      `@font-face{font-family:"${family}";src:url(/assets/${file}) format("woff2-variations")}`,
  )
  .join('');

function png(size) {
  const data = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(size, 16);
  data.writeUInt32BE(size, 20);
  return data;
}

function manifest(overrides = {}) {
  const icons = {
    16: '/icon/16.png',
    32: '/icon/32.png',
    48: '/icon/48.png',
    128: '/icon/128.png',
  };
  return {
    manifest_version: 3,
    name: EXPECTED_EXTENSION_NAME,
    version: '1.2.3',
    icons,
    action: { default_title: EXPECTED_EXTENSION_NAME, default_icon: icons },
    permissions: [...EXPECTED_PERMISSIONS],
    optional_permissions: [...EXPECTED_OPTIONAL_PERMISSIONS],
    host_permissions: [...EXPECTED_HOST_PERMISSIONS],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' data:;",
    },
    content_scripts: [
      {
        matches: ['https://grok.com/*'],
        all_frames: false,
        js: ['content-scripts/grok.js'],
      },
      {
        matches: ['https://claude.ai/*'],
        all_frames: false,
        js: ['content-scripts/prompt-fill.js'],
      },
    ],
    ...overrides,
  };
}

async function fixture(
  t,
  {
    manifestOverrides = {},
    css = TOKENS_CSS + FONTS_CSS,
    extraFiles = {},
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-companion-verify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, '.output', 'chrome-mv3');
  const files = {
    'manifest.json': JSON.stringify(manifest(manifestOverrides)),
    'background.js': 'console.log("ok");',
    'content-scripts/grok.js': 'void 0;',
    'content-scripts/prompt-fill.js': 'void 0;',
    'assets/sidepanel-AbCd1234.css': css,
    'assets/inter-latin-wght-normal-AbCd1234.woff2': 'font',
    'assets/sora-latin-wght-normal-AbCd1234.woff2': 'font',
    'assets/jetbrains-mono-latin-wght-normal-AbCd1234.woff2': 'font',
    'THIRD_PARTY_NOTICES.md': notices,
    'licenses/TABLER-LICENSE.txt': tablerLicense,
    ...extraFiles,
  };
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(output, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  for (const size of [16, 32, 48, 128]) {
    await mkdir(path.join(output, 'icon'), { recursive: true });
    await writeFile(path.join(output, 'icon', `${size}.png`), png(size));
  }
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'drama-studio-companion', version: '1.2.3' }),
  );
  return { projectRoot: root, outputRoot: output };
}

test('accepts a Drama Studio build', async (t) => {
  const result = await verifyProductionBuild(await fixture(t));
  assert.equal(result.version, '1.2.3');
  assert.equal(result.fontFiles, 3);
});

test('rejects old product names in shipped files', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        extraFiles: { 'background.js': 'const name = "Grok Automator™";' },
      }),
    ),
    /old product names/u,
  );
});

test('allows third-party licence files to mention anyone', async (t) => {
  await assert.doesNotReject(
    verifyProductionBuild(
      await fixture(t, {
        extraFiles: {
          'licenses/OTHER.txt': 'Copyright Paks Tools contributors',
        },
      }),
    ),
  );
});

test('rejects a build without the Drama Studio tokens', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, { css: ':root{--gold:#d4af37}' + FONTS_CSS }),
    ),
    /Drama Studio tokens/u,
  );
});

test('rejects a missing font family', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, { css: TOKENS_CSS + FONTS_CSS.replace('Sora', 'Gone') }),
    ),
    /Sora Variable/u,
  );
});

test('rejects remote CSS assets', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        css:
          TOKENS_CSS +
          FONTS_CSS +
          'body{background:url(https://cdn.example/x.png)}',
      }),
    ),
    /remote/u,
  );
});

test('rejects permissions outside the audited set', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        manifestOverrides: {
          permissions: [...EXPECTED_PERMISSIONS, 'cookies'],
        },
      }),
    ),
    /Permissions differ/u,
  );
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        manifestOverrides: {
          host_permissions: [...EXPECTED_HOST_PERMISSIONS, '<all_urls>'],
        },
      }),
    ),
    /Host permissions differ/u,
  );
});

test('rejects wildcard or all-frames content scripts', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        manifestOverrides: {
          content_scripts: [{ matches: ['https://*/*'], js: ['x.js'] }],
        },
      }),
    ),
    /exact https hosts/u,
  );
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        manifestOverrides: {
          content_scripts: [
            {
              matches: ['https://claude.ai/*'],
              all_frames: true,
              js: ['x.js'],
            },
          ],
        },
      }),
    ),
    /top frame/u,
  );
});

test('rejects the wrong extension name', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, { manifestOverrides: { name: 'Something Else' } }),
    ),
    /manifest name/u,
  );
});

test('rejects source maps and unsafe CSP', async (t) => {
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, { extraFiles: { 'background.js.map': '{}' } }),
    ),
    /Forbidden release artifacts/u,
  );
  await assert.rejects(
    verifyProductionBuild(
      await fixture(t, {
        manifestOverrides: {
          content_security_policy: {
            extension_pages: "script-src 'self' 'unsafe-eval';",
          },
        },
      }),
    ),
    /Unsafe extension page/u,
  );
});
