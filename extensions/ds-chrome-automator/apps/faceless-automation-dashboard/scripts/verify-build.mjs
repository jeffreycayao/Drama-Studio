import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputRoot = path.join(projectRoot, 'dist');
const dashboardPackage = JSON.parse(
  await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
);

if (dashboardPackage.dependencies?.['@tabler/icons-react'] !== '3.46.0') {
  throw new Error(
    'Dashboard package must pin @tabler/icons-react to version 3.46.0.',
  );
}

if (
  dashboardPackage.dependencies?.['lucide-react'] !== undefined ||
  dashboardPackage.devDependencies?.['lucide-react'] !== undefined
) {
  throw new Error('Dashboard package must not depend on lucide-react.');
}

const sourceArtifactPattern = /\.(?:map|ts|tsx|jsx|vue)$/iu;
const nonWoff2FontPattern = /\.(?:eot|otf|ttf|woff)$/iu;
const executableTextExtensions = new Set(['.css', '.html', '.js', '.svg']);
const remoteRuntimePatterns = [
  /<script[^>]+src=["'](?:https?:)?\/\//iu,
  /<link(?=[^>]+\brel=["']stylesheet["'])(?=[^>]+\bhref=["'](?:https?:)?\/\/)[^>]*>/iu,
  /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//iu,
  /url\(\s*["']?(?:https?:)?\/\//iu,
  /fonts\.(?:googleapis|gstatic)\.com/iu,
];

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in output: ${absolutePath}`,
      );
    }
    if (entry.isDirectory()) files.push(...(await walkFiles(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
    else throw new Error(`Unsupported output entry: ${absolutePath}`);
  }

  return files;
}

const files = await walkFiles(outputRoot);
if (files.length === 0)
  throw new Error(`Production output is empty: ${outputRoot}`);

const relativeFiles = files.map((file) =>
  path.relative(outputRoot, file).split(path.sep).join('/'),
);
const forbiddenSourceArtifacts = relativeFiles.filter((file) =>
  sourceArtifactPattern.test(file),
);
if (forbiddenSourceArtifacts.length > 0) {
  throw new Error(
    `Production output contains source artifacts:\n${forbiddenSourceArtifacts.join('\n')}`,
  );
}

const unintendedServerArtifacts = relativeFiles.filter(
  (file) => /^api(?:\/|$)/iu.test(file) || /(?:^|\/)api\/index\./iu.test(file),
);
if (unintendedServerArtifacts.length > 0) {
  throw new Error(
    `Dashboard output contains an unintended server/API artifact:\n${unintendedServerArtifacts.join('\n')}`,
  );
}

const nonWoff2Fonts = relativeFiles.filter((file) =>
  nonWoff2FontPattern.test(file),
);
if (nonWoff2Fonts.length > 0) {
  throw new Error(
    `Production output contains a non-WOFF2 font:\n${nonWoff2Fonts.join('\n')}`,
  );
}

const javascriptFiles = files.filter((file) => file.endsWith('.js'));
if (javascriptFiles.length < 4) {
  throw new Error(
    `Expected entry, route, and vendor chunks; found ${javascriptFiles.length} JavaScript files.`,
  );
}

let containsTablerRuntime = false;
for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  if (!executableTextExtensions.has(extension)) continue;
  const source = await readFile(file, 'utf8');
  const finding = remoteRuntimePatterns.find((pattern) => pattern.test(source));
  if (finding) {
    throw new Error(
      `Production output references a remote runtime or font asset in ${path.relative(outputRoot, file)}`,
    );
  }
  if (/\btabler-icon\b/iu.test(source)) containsTablerRuntime = true;
  if (/\blucide(?:-react|-icon)?\b/iu.test(source)) {
    throw new Error(
      `Production output contains a legacy Lucide marker in ${path.relative(outputRoot, file)}`,
    );
  }
}

if (!containsTablerRuntime) {
  throw new Error('Production output is missing the Tabler icon runtime.');
}

const woff2Files = relativeFiles.filter((file) => file.endsWith('.woff2'));
for (const family of ['instrument-serif', 'manrope', 'ibm-plex-mono']) {
  if (!woff2Files.some((file) => file.toLowerCase().includes(family))) {
    throw new Error(
      `Production output is missing local ${family} WOFF2 assets.`,
    );
  }
}

const noticePath = path.join(outputRoot, 'THIRD_PARTY_NOTICES.txt');
const notice = await readFile(noticePath, 'utf8');
for (const requiredNotice of [
  'Instrument Serif',
  'Manrope',
  'IBM Plex Mono',
  'SIL Open Font License',
  '@tabler/icons-react 3.46.0',
  'Copyright (c) 2020-2026 Paweł Kuna',
  'MIT License',
]) {
  if (!notice.includes(requiredNotice)) {
    throw new Error(`Third-party notices are missing ${requiredNotice}.`);
  }
}

process.stdout.write(
  `Verified dashboard production build: ${relativeFiles.length} files, ${javascriptFiles.length} minified chunks, Tabler icons, ${woff2Files.length} local WOFF2 assets, no unintended API function, Lucide markers, source maps, or remote runtime/font assets.\n`,
);
