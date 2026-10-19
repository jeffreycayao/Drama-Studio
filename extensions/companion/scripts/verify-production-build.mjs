import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  LEGACY_IDENTITY_PATTERN,
  OUTPUT_ROOT,
  PROJECT_ROOT,
  isMainModule,
  isTextFile,
  readJson,
  readPackageMetadata,
  toPosixPath,
  walkFiles,
} from './lib/release-common.mjs';
import { extensionIdFromPublicKey } from './lib/extension-identity.mjs';
import { assertNoFindings, scanText } from './lib/security-scanner.mjs';

export const EXPECTED_EXTENSION_NAME = 'Drama Studio™ Companion';

const forbiddenArtifactPatterns = [
  /(?:^|\/)\.env(?:\.|$)/iu,
  /(?:^|\/)\.git(?:\/|$)/iu,
  /(?:^|\/)node_modules(?:\/|$)/iu,
  /(?:^|\/)(?:__tests__|tests?)(?:\/|$)/iu,
  /(?:^|\/)src(?:\/|$)/iu,
  /(?:^|\/)(?:package(?:-lock)?\.json)$/iu,
  /\.(?:map|ts|tsx|vue)$/iu,
];

/** The desktop app's three families (see src/brand/fonts.css). */
const requiredFontFiles = [
  ['Inter Variable', 'inter-latin-wght-normal'],
  ['Sora Variable', 'sora-latin-wght-normal'],
  ['JetBrains Mono Variable', 'jetbrains-mono-latin-wght-normal'],
];

/** Drama Studio tokens the side panel must carry (src/brand/tokens.css). */
const requiredTokens = [
  ['charcoal surface', /--sf-dark-800:39 35 27/u],
  ['cream text', /--sf-text-primary:246 241 230/u],
  ['lime accent', /--sf-accent:213 250 0/u],
  ['charcoal on lime', /--sf-on-accent:30 27 21/u],
  ['olive decoration', /--sf-accent-muted:104 115 35/u],
];

const requiredIconAssets = new Map([
  [16, '/icon/16.png'],
  [32, '/icon/32.png'],
  [48, '/icon/48.png'],
  [128, '/icon/128.png'],
]);

export const EXPECTED_HOST_PERMISSIONS = [
  'https://*.grok.com/*',
  'https://grok.com/*',
  'https://imgen.x.ai/*',
  'https://vidgen.x.ai/*',
];
export const EXPECTED_PERMISSIONS = [
  'contextMenus',
  'downloads',
  'sidePanel',
  'storage',
  'tabs',
];
export const EXPECTED_OPTIONAL_PERMISSIONS = ['nativeMessaging'];
// Result hosts of the AI sites besides Grok, asked for one site at a time
// when the person first sends a result to Drama Studio.
export const EXPECTED_OPTIONAL_HOST_PERMISSIONS = [
  'https://*.cdn-luma.com/*',
  'https://*.googleusercontent.com/*',
  'https://*.hailuoai.com/*',
  'https://*.hailuoai.video/*',
  'https://*.ideogram.ai/*',
  'https://*.kling.ai/*',
  'https://*.klingai.com/*',
  'https://*.leonardo.ai/*',
  'https://*.lumalabs.ai/*',
  'https://*.oaiusercontent.com/*',
  'https://*.pika.art/*',
  'https://*.runwayml.cloud/*',
  'https://*.runwayml.com/*',
  'https://cdn.leonardo.ai/*',
  'https://cdn.midjourney.com/*',
  'https://chatgpt.com/*',
  'https://hailuoai.video/*',
  'https://ideogram.ai/*',
  'https://flow.google.com/*',
  'https://labs.google/*',
  'https://pika.art/*',
  'https://storage.googleapis.com/*',
  'https://*.suno.ai/*',
  'https://*.suno.com/*',
  'https://suno.com/*',
];

const tablerLicensePath = 'licenses/TABLER-LICENSE.txt';
const tablerLicenseSha256 =
  'b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db';

function sortedEqual(actual, expected) {
  const left = Array.isArray(actual) ? [...actual].sort() : [];
  const right = [...expected].sort();
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function compactCss(textFiles) {
  return textFiles
    .filter(({ relativeFile }) => relativeFile.endsWith('.css'))
    .map(({ source }) => source)
    .join('\n')
    .replace(/[\r\n\t]+/gu, '')
    .replace(/\s*([:;,{}])\s*/gu, '$1')
    .toLowerCase();
}

function assertThirdPartyNotices(relativeFiles, textFiles) {
  if (!relativeFiles.includes('THIRD_PARTY_NOTICES.md')) {
    throw new Error('Production output is missing THIRD_PARTY_NOTICES.md');
  }
  if (!relativeFiles.includes(tablerLicensePath)) {
    throw new Error(`Production output is missing ${tablerLicensePath}`);
  }
  const notice = textFiles.find(
    ({ relativeFile }) => relativeFile === 'THIRD_PARTY_NOTICES.md',
  )?.source;
  for (const credit of [
    'Inter',
    'Sora',
    'JetBrains Mono',
    '@tabler/icons-vue',
  ]) {
    if (!notice?.includes(credit)) {
      throw new Error(`Third-party notices do not credit ${credit}`);
    }
  }
  const license = textFiles.find(
    ({ relativeFile }) => relativeFile === tablerLicensePath,
  )?.source;
  if (
    !license ||
    createHash('sha256').update(license).digest('hex') !== tablerLicenseSha256
  ) {
    throw new Error(
      'Production Tabler license does not match the pinned notice',
    );
  }
}

function assertBundledTypography(relativeFiles, textFiles) {
  const fontFiles = relativeFiles.filter((file) => /\.woff2?$/iu.test(file));
  const nonWoff2 = relativeFiles.filter((file) =>
    /\.(?:eot|otf|ttf|woff)$/iu.test(file),
  );
  if (nonWoff2.length > 0) {
    throw new Error(
      `Production output contains non-WOFF2 fonts:\n${nonWoff2.join('\n')}`,
    );
  }
  const css = compactCss(textFiles);
  for (const [family, filePrefix] of requiredFontFiles) {
    if (!fontFiles.some((file) => path.basename(file).startsWith(filePrefix))) {
      throw new Error(`Production output is missing the ${family} font file`);
    }
    if (!css.includes(family.toLowerCase())) {
      throw new Error(`Production CSS does not declare ${family}`);
    }
  }
  if (fontFiles.length !== requiredFontFiles.length) {
    throw new Error(
      `Expected exactly ${requiredFontFiles.length} bundled fonts (latin subset); found ${fontFiles.length}`,
    );
  }
  if (/url\(\s*['"]?(?:https?:)?\/\//u.test(css)) {
    throw new Error('Production CSS references a remote asset');
  }
  return fontFiles.length;
}

function assertDramaStudioTheme(textFiles) {
  const css = compactCss(textFiles);
  const missing = requiredTokens
    .filter(([, pattern]) => !pattern.test(css))
    .map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(
      `Production CSS is missing Drama Studio tokens: ${missing.join(', ')}`,
    );
  }
}

/**
 * The Store package has no `key` (the Chrome Web Store sets the ID). The
 * unpacked build carries the Store public key from store/identity.json, so it
 * gets the Store ID that Drama Studio accepts.
 */
export function assertManifestIdentity(manifest, { storeIdentity, storeKey }) {
  if (!storeKey) {
    if (Object.hasOwn(manifest, 'key')) {
      throw new Error(
        'The Store package must not contain a key: the Chrome Web Store sets the extension ID',
      );
    }
    return;
  }
  if (manifest.key !== storeIdentity?.publicKey) {
    throw new Error(
      'The unpacked build must carry the Store public key from store/identity.json',
    );
  }
  const extensionId = extensionIdFromPublicKey(manifest.key);
  if (extensionId !== storeIdentity.extensionId) {
    throw new Error(
      `The unpacked build's key gives ID ${extensionId}, not the Store ID ${String(storeIdentity.extensionId)}`,
    );
  }
}

export function assertManifestPolicy(manifest, packageVersion) {
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
  if (manifest.name !== EXPECTED_EXTENSION_NAME) {
    throw new Error(
      `Generated manifest name must be ${EXPECTED_EXTENSION_NAME}; received ${String(manifest.name)}`,
    );
  }
  // Chrome Web Store listing limits.
  if (
    typeof manifest.description !== 'string' ||
    manifest.description.length > 132
  ) {
    throw new Error(
      `Manifest description must be 132 characters or fewer for the Chrome Web Store (${String(manifest.description?.length)}).`,
    );
  }
  if (manifest.name.length > 75) {
    throw new Error(
      'Manifest name must be 75 characters or fewer for the Chrome Web Store.',
    );
  }
  if (manifest.action?.default_title !== EXPECTED_EXTENSION_NAME) {
    throw new Error(
      `Generated action title must be ${EXPECTED_EXTENSION_NAME}; received ${String(manifest.action?.default_title)}`,
    );
  }
  for (const [size, expectedPath] of requiredIconAssets) {
    if (manifest.icons?.[String(size)] !== expectedPath) {
      throw new Error(
        `Generated manifest icon ${size} must be ${expectedPath}`,
      );
    }
    if (manifest.action?.default_icon?.[String(size)] !== expectedPath) {
      throw new Error(`Generated action icon ${size} must be ${expectedPath}`);
    }
  }
  if (!sortedEqual(manifest.host_permissions, EXPECTED_HOST_PERMISSIONS)) {
    throw new Error(
      `Host permissions differ from the audited set: ${String(manifest.host_permissions)}`,
    );
  }
  if (!sortedEqual(manifest.permissions, EXPECTED_PERMISSIONS)) {
    throw new Error(
      `Permissions differ from the audited set: ${String(manifest.permissions)}`,
    );
  }
  if (
    !sortedEqual(manifest.optional_permissions, EXPECTED_OPTIONAL_PERMISSIONS)
  ) {
    throw new Error(
      `Optional permissions differ from the audited set: ${String(manifest.optional_permissions)}`,
    );
  }

  if (
    !sortedEqual(
      manifest.optional_host_permissions,
      EXPECTED_OPTIONAL_HOST_PERMISSIONS,
    )
  ) {
    throw new Error(
      `Optional host permissions differ from the audited set: ${String(manifest.optional_host_permissions)}`,
    );
  }

  const policy = manifest.content_security_policy?.extension_pages;
  if (typeof policy !== 'string') {
    throw new Error(
      'Generated manifest is missing content_security_policy.extension_pages',
    );
  }
  if (/unsafe-(?:eval|inline)|https?:|\*/iu.test(policy)) {
    throw new Error(`Unsafe extension page content security policy: ${policy}`);
  }
  if (!/script-src\s+'self'/u.test(policy)) {
    throw new Error(`Extension page CSP must constrain scripts: ${policy}`);
  }

  const scripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : [];
  const matches = scripts.flatMap((script) => script.matches ?? []);
  if (
    matches.length === 0 ||
    matches.some((match) => !/^https:\/\/[^*]/u.test(match))
  ) {
    throw new Error(
      `Content scripts must match exact https hosts only: ${matches.join(', ')}`,
    );
  }
  if (scripts.some((script) => script.all_frames === true)) {
    throw new Error('Content scripts must run in the top frame only');
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
      throw new Error(`Production icon is not a valid PNG: ${relativePath}`);
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
  storeKey = false,
} = {}) {
  const packageMetadata = await readPackageMetadata(projectRoot);
  const files = await walkFiles(outputRoot);
  if (files.length === 0) {
    throw new Error(`Production output is empty: ${outputRoot}`);
  }

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

  const javascriptFiles = relativeFiles.filter((file) => file.endsWith('.js'));
  if (javascriptFiles.length === 0)
    throw new Error('No JavaScript output found');

  const findings = [];
  const legacyFiles = [];
  const textFiles = [];
  for (const file of files.filter(isTextFile)) {
    const source = await readFile(file, 'utf8');
    const relativeFile = toPosixPath(path.relative(outputRoot, file));
    if (
      !relativeFile.startsWith('licenses/') &&
      LEGACY_IDENTITY_PATTERN.test(source)
    ) {
      legacyFiles.push(relativeFile);
    }
    textFiles.push({ relativeFile, source });
    findings.push(
      ...scanText(source, {
        file: toPosixPath(path.relative(projectRoot, file)),
      }),
    );
  }
  assertNoFindings(findings, 'Production output security scan');
  if (legacyFiles.length > 0) {
    throw new Error(
      `Production output contains old product names:\n${legacyFiles.join('\n')}`,
    );
  }

  const fontFiles = assertBundledTypography(relativeFiles, textFiles);
  assertThirdPartyNotices(relativeFiles, textFiles);
  assertDramaStudioTheme(textFiles);

  const manifest = await readJson(path.join(outputRoot, 'manifest.json'));
  assertManifestPolicy(manifest, packageMetadata.version);
  assertManifestIdentity(manifest, {
    storeKey,
    storeIdentity: storeKey
      ? await readJson(path.join(projectRoot, 'store', 'identity.json'))
      : null,
  });
  await assertIconAssets(outputRoot);

  return {
    files: relativeFiles.length,
    fontFiles,
    javascriptFiles: javascriptFiles.length,
    version: packageMetadata.version,
  };
}

if (isMainModule(import.meta.url)) {
  // --unpacked checks `wxt build --mode unpacked` (npm run build:unpacked).
  const unpacked = process.argv.includes('--unpacked');
  const result = await verifyProductionBuild({
    outputRoot: unpacked ? `${OUTPUT_ROOT}-unpacked` : OUTPUT_ROOT,
    storeKey: unpacked,
  });
  process.stdout.write(
    `Verified ${EXPECTED_EXTENSION_NAME} ${result.version}${unpacked ? ' (unpacked, Store ID)' : ''}: ${result.files} files, ${result.javascriptFiles} JavaScript files, ${result.fontFiles} bundled fonts, Drama Studio name, icons and theme tokens, audited permissions, strict CSP, third-party notices, and no source maps, secrets, old product names or remote code.\n`,
  );
}
