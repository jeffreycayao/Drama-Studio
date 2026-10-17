import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import { LEGAL_BANNER } from '../../scripts/lib/release-common.mjs';
import { renderVersionBadge } from '../../scripts/lib/version-badge.mjs';
import { verifyProductionBuild } from '../../scripts/verify-production-build.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const tablerLicense = await readFile(
  path.join(projectRoot, 'public', 'licenses', 'TABLER-LICENSE.txt'),
  'utf8',
);
const shieldsBadgeMakerLicense = await readFile(
  path.join(projectRoot, 'public', 'licenses', 'SHIELDS-BADGE-MAKER-MIT.txt'),
  'utf8',
);
const footerCopyright = '© 2026 PAKS LLC. ALL RIGHTS RESERVED.';

const fontFixtures = [
  ['Instrument Serif', 400, 'instrument-serif-latin-400-normal-AbCd1234.woff2'],
  ...[400, 500, 600, 700, 800].map((weight) => [
    'Manrope',
    weight,
    `manrope-latin-${weight}-normal-AbCd1234.woff2`,
  ]),
  ...[500, 600].map((weight) => [
    'IBM Plex Mono',
    weight,
    `ibm-plex-mono-latin-${weight}-normal-AbCd1234.woff2`,
  ]),
];

function productionCssFixture() {
  return [
    ...fontFixtures.map(
      ([family, weight, file]) =>
        `@font-face{font-family:"${family}";font-weight:${weight};src:url("./${file}")}`,
    ),
    ':root{--gold:#d4af37;--gold-strong:#b8860b;--charcoal:#1c1c1c;--black:#0a0a0a;--white:#fff;--muted-white:#f5f5f5;--border-light:#d6d6d6;--font-display:"Instrument Serif",Georgia,serif;--font-body:Manrope,Arial,sans-serif;--font-meta:"IBM Plex Mono",Consolas,monospace}',
    'body{font-family:var(--font-body)}',
    '.reference-header__identity h1{font-family:var(--font-display)}',
    '.brand-row h1 small,.version-pill{font-family:var(--font-meta)}',
    'button:focus-visible{outline:2px solid var(--gold)}',
    '.main-tabs button.active{border-color:var(--gold);color:var(--gold)}',
    '.control-actions .primary-action{background:var(--gold);color:var(--black)}',
  ].join('');
}

function pngHeader(size) {
  const data = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(data, 0);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(size, 16);
  data.writeUInt32BE(size, 20);
  return data;
}

async function createFixture() {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), 'production-verifier-'),
  );
  const outputRoot = path.join(projectRoot, '.output', 'chrome-mv3');
  const assetsRoot = path.join(outputRoot, 'assets');
  const chunksRoot = path.join(outputRoot, 'chunks');
  const iconsRoot = path.join(outputRoot, 'icon');
  const licensesRoot = path.join(outputRoot, 'licenses');
  const badgesRoot = path.join(outputRoot, 'badges');
  await Promise.all([
    mkdir(assetsRoot, { recursive: true }),
    mkdir(chunksRoot, { recursive: true }),
    mkdir(iconsRoot, { recursive: true }),
    mkdir(licensesRoot, { recursive: true }),
    mkdir(badgesRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.2.3' }),
    ),
    writeFile(
      path.join(outputRoot, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Grok Automator™',
        version: '1.2.3',
        icons: {
          16: '/icon/16.png',
          32: '/icon/32.png',
          48: '/icon/48.png',
          128: '/icon/128.png',
        },
        action: {
          default_title: 'Grok Automator™',
          default_icon: {
            16: '/icon/16.png',
            32: '/icon/32.png',
            48: '/icon/48.png',
            128: '/icon/128.png',
          },
        },
        host_permissions: [
          'https://grok.com/*',
          'https://*.grok.com/*',
          'https://imgen.x.ai/*',
          'https://vidgen.x.ai/*',
          'https://paks-api.vercel.app/*',
        ],
        content_security_policy: {
          extension_pages:
            "script-src 'self'; object-src 'self'; img-src 'self' data:;",
        },
      }),
    ),
    writeFile(
      path.join(chunksRoot, 'sidepanel-AbCd1234.js'),
      `${LEGAL_BANNER}\nconst footer = ${JSON.stringify(footerCopyright)};`,
    ),
    writeFile(
      path.join(assetsRoot, 'sidepanel-AbCd1234.css'),
      productionCssFixture(),
    ),
    ...fontFixtures.map(([, , file]) =>
      writeFile(path.join(assetsRoot, file), file),
    ),
    writeFile(
      path.join(outputRoot, 'THIRD_PARTY_NOTICES.md'),
      '# Third-party notices\n\n- **Tabler Icons for Vue** (`@tabler/icons-vue` 3.46.0).\n- **Shields badge-maker** (`badge-maker` 6.0.0).',
    ),
    writeFile(path.join(licensesRoot, 'TABLER-LICENSE.txt'), tablerLicense),
    writeFile(
      path.join(licensesRoot, 'SHIELDS-BADGE-MAKER-MIT.txt'),
      shieldsBadgeMakerLicense,
    ),
    writeFile(
      path.join(badgesRoot, 'version.svg'),
      renderVersionBadge('1.2.3'),
    ),
    ...[16, 32, 48, 128].map((size) =>
      writeFile(path.join(iconsRoot, `${size}.png`), pngHeader(size)),
    ),
    writeFile(
      path.join(outputRoot, 'index.html'),
      '<main>fixture</main><script src="chunks/sidepanel-AbCd1234.js"></script>',
    ),
  ]);
  return { projectRoot, outputRoot };
}

test('accepts a clean, bannered Manifest V3 output tree', async () => {
  const fixture = await createFixture();
  try {
    const result = await verifyProductionBuild(fixture);
    assert.equal(result.version, '1.2.3');
    assert.equal(result.javascriptFiles, 1);
    assert.equal(result.hashedChunks, 1);
    assert.equal(result.fontFiles, 8);
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a stale locally bundled version shield', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'badges', 'version.svg'),
      renderVersionBadge('1.2.2'),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /badges\/version\.svg does not match package version 1\.2\.3/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a stale versioned shield alongside the canonical badge', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'badges', 'grok-automator-1.2.2.svg'),
      renderVersionBadge('1.2.2'),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /must contain exactly badges\/version\.svg/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects built output without the exact application footer copyright', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'chunks', 'sidepanel-AbCd1234.js'),
      `${LEGAL_BANNER}\nconst ready = true;`,
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /missing the exact application footer copyright/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects extension image CSP that permits blob URLs', async () => {
  const fixture = await createFixture();
  try {
    const manifestPath = path.join(fixture.outputRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.content_security_policy.extension_pages =
      "script-src 'self'; object-src 'self'; img-src 'self' data: blob:;";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyProductionBuild(fixture),
      /must constrain images to 'self' and data: only/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a bundled manifest public key', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        version: '1.2.3',
        host_permissions: [
          'https://grok.com/*',
          'https://*.grok.com/*',
          'https://imgen.x.ai/*',
          'https://vidgen.x.ai/*',
          'https://paks-api.vercel.app/*',
        ],
        key: 'public-extension-identity',
        content_security_policy: {
          extension_pages: "script-src 'self'; object-src 'self';",
        },
      }),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /must not contain a public key/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a stale customer-facing extension name', async () => {
  const fixture = await createFixture();
  try {
    const manifestPath = path.join(fixture.outputRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.name = 'Grok Automation';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyProductionBuild(fixture),
      /manifest name must be exactly Grok Automator™/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects an incorrectly sized extension icon', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'icon', '48.png'),
      pngHeader(32),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /icon icon\/48\.png must be 48x48; received 32x32/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects production host-permission drift', async () => {
  const fixture = await createFixture();
  try {
    const manifestPath = path.join(fixture.outputRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions.push('http://192.168.1.20/*');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyProductionBuild(fixture),
      /host permissions do not match the audited production set/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects missing typography notices', async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.outputRoot, 'THIRD_PARTY_NOTICES.md'));
    await assert.rejects(
      verifyProductionBuild(fixture),
      /missing THIRD_PARTY_NOTICES\.md/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a missing Tabler license', async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.outputRoot, 'licenses', 'TABLER-LICENSE.txt'));
    await assert.rejects(
      verifyProductionBuild(fixture),
      /missing licenses\/TABLER-LICENSE\.txt/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a missing Shields badge-maker license', async () => {
  const fixture = await createFixture();
  try {
    await rm(
      path.join(fixture.outputRoot, 'licenses', 'SHIELDS-BADGE-MAKER-MIT.txt'),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /missing licenses\/SHIELDS-BADGE-MAKER-MIT\.txt/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects remote font assets in production CSS', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'assets', 'sidepanel-AbCd1234.css'),
      '@font-face{font-family:"Instrument Serif";src:url("https://fonts.example.test/font.woff2")} Manrope IBM Plex Mono',
    );
    await assert.rejects(verifyProductionBuild(fixture), /remote-font-asset/u);
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects non-WOFF2 font assets', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'assets', 'legacy-font-AbCd1234.woff'),
      'legacy font',
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /contains non-WOFF2 font assets/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a missing required local font weight', async () => {
  const fixture = await createFixture();
  try {
    await rm(
      path.join(
        fixture.outputRoot,
        'assets',
        'manrope-latin-800-normal-AbCd1234.woff2',
      ),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /Expected exactly 8 locally bundled WOFF2 assets/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects legacy mint values in the production theme', async () => {
  const fixture = await createFixture();
  try {
    const cssPath = path.join(
      fixture.outputRoot,
      'assets',
      'sidepanel-AbCd1234.css',
    );
    const css = await readFile(cssPath, 'utf8');
    await writeFile(cssPath, css.replace('#d4af37', '#34d399'));
    await assert.rejects(
      verifyProductionBuild(fixture),
      /legacy mint\/blue theme values/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects a gold primary action without dark text', async () => {
  const fixture = await createFixture();
  try {
    const cssPath = path.join(
      fixture.outputRoot,
      'assets',
      'sidepanel-AbCd1234.css',
    );
    const css = await readFile(cssPath, 'utf8');
    await writeFile(
      cssPath,
      css.replace(
        '.control-actions .primary-action{background:var(--gold);color:var(--black)}',
        '.control-actions .primary-action{background:var(--gold);color:var(--white)}',
      ),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /gold primary action with dark text/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects legacy publisher identity strings in built output', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'index.html'),
      '<main>legacy publisher domain</main>',
    );
    await writeFile(
      path.join(fixture.outputRoot, 'legacy.md'),
      ['configs.', 'kyl', 'eng', 'uyen', '.me'].join(''),
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /legacy publisher identity strings/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects the prior legal-owner signature in built output', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'index.html'),
      `<footer>${['CHRÌS', 'DIGÌTÀLS'].join(' ')}</footer>`,
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /legacy publisher identity strings/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects production output without a hashed JavaScript chunk', async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.outputRoot, 'chunks'), {
      recursive: true,
      force: true,
    });
    await writeFile(
      path.join(fixture.outputRoot, 'background.js'),
      `${LEGAL_BANNER}\nconst ready = true;`,
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /missing a hashed JavaScript chunk/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('rejects recovery markers embedded in built output', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.outputRoot, 'index.html'),
      '<!-- src/recovered/old-module.ts -->',
    );
    await assert.rejects(
      verifyProductionBuild(fixture),
      /contains recovery source-path markers/u,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});
