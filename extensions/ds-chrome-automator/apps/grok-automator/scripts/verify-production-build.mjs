import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  LEGAL_BANNER,
  OUTPUT_ROOT,
  PROJECT_ROOT,
  isMainModule,
  isTextFile,
  readJson,
  readPackageMetadata,
  toPosixPath,
  walkFiles,
} from './lib/release-common.mjs';
import { assertNoFindings, scanText } from './lib/security-scanner.mjs';
import { containsForbiddenSourceMarker } from './lib/source-boundaries.mjs';
import {
  renderVersionBadge,
  VERSION_BADGE_RELATIVE_PATH,
} from './lib/version-badge.mjs';

const forbiddenArtifactPatterns = [
  /(?:^|\/)\.env(?:\.|$)/iu,
  /(?:^|\/)\.git(?:\/|$)/iu,
  /(?:^|\/)node_modules(?:\/|$)/iu,
  /(?:^|\/)(?:__tests__|tests?)(?:\/|$)/iu,
  /(?:^|\/)src(?:\/|$)/iu,
  /(?:^|\/)(?:package(?:-lock)?\.json)$/iu,
  /\.(?:map|ts|tsx|vue)$/iu,
];

const requiredFontFamilies = ['Instrument Serif', 'Manrope', 'IBM Plex Mono'];
const requiredFontFaces = [
  {
    family: 'Instrument Serif',
    weight: 400,
    filePrefix: 'instrument-serif-latin-400-normal-',
  },
  ...[400, 500, 600, 700, 800].map((weight) => ({
    family: 'Manrope',
    weight,
    filePrefix: `manrope-latin-${weight}-normal-`,
  })),
  ...[500, 600].map((weight) => ({
    family: 'IBM Plex Mono',
    weight,
    filePrefix: `ibm-plex-mono-latin-${weight}-normal-`,
  })),
];
const hashedChunkPattern = /^chunks\/[^/]+-[A-Za-z0-9_-]{8,}\.js$/u;
const hashedWoff2Pattern = /-[A-Za-z0-9_-]{8,}\.woff2$/u;
const expectedExtensionName = 'Grok Automator™';
const requiredIconAssets = new Map([
  [16, '/icon/16.png'],
  [32, '/icon/32.png'],
  [48, '/icon/48.png'],
  [128, '/icon/128.png'],
]);
const forbiddenLegacyThemePattern =
  /--mint\b|#(?:34d399|00d492|10b981|4ade80|1447e6|3b82f6|15803d|86efac)\b/iu;
const legacyIdentityPattern = new RegExp(
  `(?:${['kyl', 'eng', 'uyen'].join('')}|${['trg', 'kyl', 'e'].join('')}|${[
    'chrìs',
    'digìtàls',
  ].join('\\s+')})`,
  'iu',
);
const tablerLicensePath = 'licenses/TABLER-LICENSE.txt';
const tablerLicenseSha256 =
  'b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db';
const shieldsBadgeMakerLicensePath = 'licenses/SHIELDS-BADGE-MAKER-MIT.txt';
const shieldsBadgeMakerLicenseSha256 =
  '5268b2493c440dbbc9f858b59825087d49aabc85b6b2ad0d4dc30f0436e3023a';
const footerCopyright = '© 2026 PAKS LLC. ALL RIGHTS RESERVED.';

function assertThirdPartyNotices(relativeFiles, textFiles) {
  if (!relativeFiles.includes(tablerLicensePath)) {
    throw new Error(`Production output is missing ${tablerLicensePath}`);
  }

  const notice = textFiles.find(
    ({ relativeFile }) => relativeFile === 'THIRD_PARTY_NOTICES.md',
  )?.source;
  const license = textFiles.find(
    ({ relativeFile }) => relativeFile === tablerLicensePath,
  )?.source;
  if (!notice || !/@tabler\/icons-vue` 3\.46\.0/u.test(notice)) {
    throw new Error(
      'Production third-party notices are missing @tabler/icons-vue 3.46.0',
    );
  }
  if (/Lucide/iu.test(notice)) {
    throw new Error('Production third-party notices still reference Lucide');
  }
  if (
    !license ||
    createHash('sha256').update(license).digest('hex') !== tablerLicenseSha256
  ) {
    throw new Error(
      'Production Tabler license does not match the pinned notice',
    );
  }

  if (!relativeFiles.includes(shieldsBadgeMakerLicensePath)) {
    throw new Error(
      `Production output is missing ${shieldsBadgeMakerLicensePath}`,
    );
  }
  if (!/`badge-maker` 6\.0\.0/u.test(notice)) {
    throw new Error(
      'Production third-party notices are missing badge-maker 6.0.0',
    );
  }
  const shieldsLicense = textFiles.find(
    ({ relativeFile }) => relativeFile === shieldsBadgeMakerLicensePath,
  )?.source;
  if (
    !shieldsLicense ||
    createHash('sha256').update(shieldsLicense).digest('hex') !==
      shieldsBadgeMakerLicenseSha256
  ) {
    throw new Error(
      'Production Shields badge-maker license does not match the pinned MIT notice',
    );
  }
}

function assertVersionBadgeAndFooter(relativeFiles, textFiles, version) {
  const badgeFiles = relativeFiles.filter((file) => file.startsWith('badges/'));
  if (
    badgeFiles.length !== 1 ||
    badgeFiles[0] !== VERSION_BADGE_RELATIVE_PATH
  ) {
    throw new Error(
      `Production output must contain exactly ${VERSION_BADGE_RELATIVE_PATH}; found ${badgeFiles.join(', ') || 'none'}`,
    );
  }

  const badge = textFiles.find(
    ({ relativeFile }) => relativeFile === VERSION_BADGE_RELATIVE_PATH,
  )?.source;
  if (badge !== renderVersionBadge(version)) {
    throw new Error(
      `Production ${VERSION_BADGE_RELATIVE_PATH} does not match package version ${version}`,
    );
  }

  const footerFiles = textFiles.filter(({ source }) =>
    source.includes(footerCopyright),
  );
  if (footerFiles.length === 0) {
    throw new Error(
      `Production output is missing the exact application footer copyright: ${footerCopyright}`,
    );
  }
}

function assertBundledTypography(relativeFiles, textFiles) {
  const nonWoff2Fonts = relativeFiles.filter((file) =>
    /\.(?:eot|otf|ttf|woff)$/iu.test(file),
  );
  if (nonWoff2Fonts.length > 0) {
    throw new Error(
      `Production output contains non-WOFF2 font assets:\n${nonWoff2Fonts.join('\n')}`,
    );
  }
  const fontFiles = relativeFiles.filter((file) => file.endsWith('.woff2'));
  if (fontFiles.length !== requiredFontFaces.length) {
    throw new Error(
      `Expected exactly ${requiredFontFaces.length} locally bundled WOFF2 assets; found ${fontFiles.length}`,
    );
  }
  const unhashedFonts = fontFiles.filter(
    (file) => !hashedWoff2Pattern.test(path.basename(file)),
  );
  if (unhashedFonts.length > 0) {
    throw new Error(
      `Bundled WOFF2 assets must use hashed production names:\n${unhashedFonts.join('\n')}`,
    );
  }
  if (!relativeFiles.includes('THIRD_PARTY_NOTICES.md')) {
    throw new Error('Production output is missing THIRD_PARTY_NOTICES.md');
  }

  const css = textFiles
    .filter(({ relativeFile }) => relativeFile.endsWith('.css'))
    .map(({ source }) => source)
    .join('\n');
  if (!css.includes('@font-face')) {
    throw new Error('Production CSS is missing local @font-face declarations');
  }
  const missingFamilies = requiredFontFamilies.filter(
    (family) => !css.includes(family),
  );
  if (missingFamilies.length > 0) {
    throw new Error(
      `Production CSS is missing required font families: ${missingFamilies.join(', ')}`,
    );
  }

  const referencedFontFiles = [
    ...css.matchAll(
      /url\(\s*['"]?([^)'"]+\.woff2(?:[?#][^)'"]*)?)['"]?\s*\)/giu,
    ),
  ].map((match) => match[1].trim());
  if (referencedFontFiles.length !== requiredFontFaces.length) {
    throw new Error(
      `Production CSS must reference exactly ${requiredFontFaces.length} bundled WOFF2 assets`,
    );
  }
  const outputFontBasenames = new Set(
    fontFiles.map((file) => path.basename(file)),
  );
  const unbundledReferences = referencedFontFiles.filter((reference) => {
    if (/^(?:https?:|data:|\/\/)/iu.test(reference)) return true;
    const pathOnly = reference.split(/[?#]/u, 1)[0];
    return !outputFontBasenames.has(path.basename(pathOnly));
  });
  if (unbundledReferences.length > 0) {
    throw new Error(
      `Production CSS contains non-local or missing font references:\n${unbundledReferences.join('\n')}`,
    );
  }

  const referencedBasenames = new Set(
    referencedFontFiles.map((reference) =>
      path.basename(reference.split(/[?#]/u, 1)[0]),
    ),
  );
  const orphanedFonts = fontFiles.filter(
    (file) => !referencedBasenames.has(path.basename(file)),
  );
  if (orphanedFonts.length > 0) {
    throw new Error(
      `Bundled WOFF2 assets are not referenced by production CSS:\n${orphanedFonts.join('\n')}`,
    );
  }

  const missingFaces = requiredFontFaces.filter(
    ({ family, weight, filePrefix }) => {
      const escapedFamily = family.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const escapedPrefix = filePrefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return !new RegExp(
        `@font-face\\s*\\{(?=[^}]*font-family:["']?${escapedFamily}["']?)(?=[^}]*font-weight:${weight})(?=[^}]*url\\([^)]*${escapedPrefix}[^)]*\\.woff2)[^}]*\\}`,
        'iu',
      ).test(css);
    },
  );
  if (missingFaces.length > 0) {
    throw new Error(
      `Production CSS is missing required local font faces: ${missingFaces
        .map(({ family, weight }) => `${family} ${weight}`)
        .join(', ')}`,
    );
  }

  return fontFiles.length;
}

function assertSys001xTheme(textFiles) {
  const css = textFiles
    .filter(({ relativeFile }) => relativeFile.endsWith('.css'))
    .map(({ source }) => source)
    .join('\n');
  const compactCss = css
    .replace(/[\r\n\t]+/gu, '')
    .replace(/\s*([:;,{}])\s*/gu, '$1')
    .toLowerCase();

  if (forbiddenLegacyThemePattern.test(compactCss)) {
    throw new Error('Production CSS contains legacy mint/blue theme values');
  }

  const requiredTokens = [
    ['gold', /--gold:#d4af37/u],
    ['deep gold', /--gold-strong:#b8860b/u],
    ['charcoal', /--charcoal:#1c1c1c/u],
    ['black', /--black:#0a0a0a/u],
    ['white', /--white:#(?:fff|ffffff)/u],
    ['muted white', /--muted-white:#f5f5f5/u],
    ['border gray', /--border-light:#d6d6d6/u],
  ];
  const missingTokens = requiredTokens
    .filter(([, pattern]) => !pattern.test(compactCss))
    .map(([label]) => label);
  if (missingTokens.length > 0) {
    throw new Error(
      `Production CSS is missing SYS001X theme tokens: ${missingTokens.join(', ')}`,
    );
  }

  const requiredRoleRules = [
    [
      'gold keyboard focus',
      /:focus-visible[^{}]*\{[^}]*outline:[^;}]*var\(--gold\)/u,
    ],
    [
      'gold active navigation',
      /\.main-tabs button\.active\{[^}]*border-color:var\(--gold\)[^}]*color:var\(--gold\)/u,
    ],
    [
      'gold primary action with dark text',
      /\.control-actions \.primary-action\{[^}]*background:var\(--gold\)[^}]*color:var\(--black\)/u,
    ],
    ['Manrope body role', /body\{[^}]*font-family:var\(--font-body\)/u],
    [
      'Instrument Serif display role',
      /\.reference-header__identity h1\{[^}]*font-family:var\(--font-display\)/u,
    ],
    [
      'IBM Plex Mono metadata role',
      /\.version-pill\{[^}]*font-family:var\(--font-meta\)/u,
    ],
  ];
  const missingRoleRules = requiredRoleRules
    .filter(([, pattern]) => !pattern.test(compactCss))
    .map(([label]) => label);
  if (missingRoleRules.length > 0) {
    throw new Error(
      `Production CSS is missing SYS001X semantic roles: ${missingRoleRules.join(', ')}`,
    );
  }
}

function assertManifestPolicy(manifest, packageVersion) {
  if (manifest.version !== packageVersion) {
    throw new Error(
      `Generated manifest version ${String(manifest.version)} does not match package ${packageVersion}`,
    );
  }
  if (manifest.manifest_version !== 3) {
    throw new Error(
      `Expected Manifest V3, received ${String(manifest.manifest_version)}`,
    );
  }
  if (Object.hasOwn(manifest, 'key')) {
    throw new Error(
      'Generated manifest must not contain a public key while the new extension identity is pending',
    );
  }
  if (manifest.name !== expectedExtensionName) {
    throw new Error(
      `Generated manifest name must be exactly ${expectedExtensionName}; received ${String(manifest.name)}`,
    );
  }
  if (manifest.action?.default_title !== expectedExtensionName) {
    throw new Error(
      `Generated action title must be exactly ${expectedExtensionName}; received ${String(manifest.action?.default_title)}`,
    );
  }
  for (const [size, expectedPath] of requiredIconAssets) {
    if (manifest.icons?.[String(size)] !== expectedPath) {
      throw new Error(
        `Generated manifest icon ${size} must reference ${expectedPath}; received ${String(manifest.icons?.[String(size)])}`,
      );
    }
    if (manifest.action?.default_icon?.[String(size)] !== expectedPath) {
      throw new Error(
        `Generated action icon ${size} must reference ${expectedPath}; received ${String(manifest.action?.default_icon?.[String(size)])}`,
      );
    }
  }

  const expectedHostPermissions = [
    'https://grok.com/*',
    'https://*.grok.com/*',
    'https://imgen.x.ai/*',
    'https://vidgen.x.ai/*',
    'https://paks-api.vercel.app/*',
  ];
  const actualHostPermissions = Array.isArray(manifest.host_permissions)
    ? [...manifest.host_permissions].sort()
    : [];
  const expectedSorted = [...expectedHostPermissions].sort();
  if (
    actualHostPermissions.length !== expectedSorted.length ||
    actualHostPermissions.some(
      (permission, index) => permission !== expectedSorted[index],
    )
  ) {
    throw new Error(
      `Generated manifest host permissions do not match the audited production set: ${actualHostPermissions.join(', ')}`,
    );
  }

  const extensionPolicy = manifest.content_security_policy?.extension_pages;
  if (typeof extensionPolicy !== 'string') {
    throw new Error(
      'Generated manifest is missing content_security_policy.extension_pages',
    );
  }
  if (/unsafe-(?:eval|inline)|https?:|\*/iu.test(extensionPolicy)) {
    throw new Error(
      `Unsafe extension page content security policy: ${extensionPolicy}`,
    );
  }
  if (!/script-src\s+'self'/u.test(extensionPolicy)) {
    throw new Error(
      `Extension page CSP must constrain scripts to 'self': ${extensionPolicy}`,
    );
  }
  if (!/(?:^|;)\s*img-src\s+'self'\s+data:\s*(?:;|$)/u.test(extensionPolicy)) {
    throw new Error(
      `Extension page CSP must constrain images to 'self' and data: only: ${extensionPolicy}`,
    );
  }
}

async function assertIconAssets(outputRoot) {
  const pngSignature = '89504e470d0a1a0a';
  for (const [size, manifestPath] of requiredIconAssets) {
    const relativePath = manifestPath.replace(/^\//u, '');
    const data = await readFile(path.join(outputRoot, relativePath));
    if (
      data.length < 24 ||
      data.subarray(0, 8).toString('hex') !== pngSignature ||
      data.subarray(12, 16).toString('ascii') !== 'IHDR'
    ) {
      throw new Error(
        `Production icon is not a valid PNG header: ${relativePath}`,
      );
    }
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (width !== size || height !== size) {
      throw new Error(
        `Production icon ${relativePath} must be ${size}x${size}; received ${width}x${height}`,
      );
    }
  }
}

export async function verifyProductionBuild({
  projectRoot = PROJECT_ROOT,
  outputRoot = path.join(projectRoot, '.output', 'chrome-mv3'),
} = {}) {
  const packageMetadata = await readPackageMetadata(projectRoot);
  const files = await walkFiles(outputRoot);
  if (files.length === 0)
    throw new Error(`Production output is empty: ${outputRoot}`);

  const relativeFiles = files.map((file) =>
    toPosixPath(path.relative(outputRoot, file)),
  );
  const forbiddenArtifacts = relativeFiles.filter((file) =>
    forbiddenArtifactPatterns.some((pattern) => pattern.test(file)),
  );
  if (forbiddenArtifacts.length > 0) {
    throw new Error(
      `Forbidden release artifacts found:\n${forbiddenArtifacts.join('\n')}`,
    );
  }

  const javascriptFiles = files.filter(
    (file) => path.extname(file).toLowerCase() === '.js',
  );
  if (javascriptFiles.length === 0)
    throw new Error('No JavaScript output found');

  const findings = [];
  const sourceMarkerFiles = [];
  const legacyIdentityFiles = [];
  const textFiles = [];
  for (const file of files.filter(isTextFile)) {
    const source = await readFile(file, 'utf8');
    const displayFile = toPosixPath(path.relative(projectRoot, file));
    if (containsForbiddenSourceMarker(source))
      sourceMarkerFiles.push(displayFile);
    if (legacyIdentityPattern.test(source))
      legacyIdentityFiles.push(displayFile);
    textFiles.push({
      relativeFile: toPosixPath(path.relative(outputRoot, file)),
      source,
    });
    findings.push(...scanText(source, { file: displayFile }));
  }
  assertNoFindings(findings, 'Production output security scan');
  if (sourceMarkerFiles.length > 0) {
    throw new Error(
      `Production output contains recovery source-path markers:\n${sourceMarkerFiles.join('\n')}`,
    );
  }
  if (legacyIdentityFiles.length > 0) {
    throw new Error(
      `Production output contains legacy publisher identity strings:\n${legacyIdentityFiles.join('\n')}`,
    );
  }

  const hashedChunks = relativeFiles.filter((file) =>
    hashedChunkPattern.test(file),
  );
  if (hashedChunks.length === 0) {
    throw new Error('Production output is missing a hashed JavaScript chunk');
  }
  const fontFiles = assertBundledTypography(relativeFiles, textFiles);
  assertThirdPartyNotices(relativeFiles, textFiles);
  assertSys001xTheme(textFiles);
  assertVersionBadgeAndFooter(
    relativeFiles,
    textFiles,
    packageMetadata.version,
  );

  for (const file of javascriptFiles) {
    const source = await readFile(file, 'utf8');
    if (!source.startsWith(LEGAL_BANNER)) {
      throw new Error(`Exact required legal banner is missing from ${file}`);
    }
  }

  const manifest = await readJson(path.join(outputRoot, 'manifest.json'));
  assertManifestPolicy(manifest, packageMetadata.version);
  await assertIconAssets(outputRoot);

  return {
    files: relativeFiles.length,
    fontFiles,
    hashedChunks: hashedChunks.length,
    javascriptFiles: javascriptFiles.length,
    version: packageMetadata.version,
  };
}

if (isMainModule(import.meta.url)) {
  const result = await verifyProductionBuild({ outputRoot: OUTPUT_ROOT });
  process.stdout.write(
    `Verified production build ${result.version}: ${result.files} files, ${result.javascriptFiles} exact legal banners, ${result.hashedChunks} hashed JS chunk(s), ${result.fontFiles} bundled WOFF2 assets, exact Grok Automator™ identity and PNG icon set, deterministic local version shield and exact copyright footer, SYS001X gold theme and semantic font roles, extension-local and validated data image sources only, audited HTTPS-only host permissions, no manifest key, local third-party notices, and no source maps, secrets, legacy identity strings, recovery markers, or remote executable code.\n`,
  );
}
