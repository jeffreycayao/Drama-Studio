import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const libraryDirectory = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(libraryDirectory, '..', '..');
export const OUTPUT_ROOT = path.join(PROJECT_ROOT, '.output', 'chrome-mv3');

export const LEGAL_BANNER = `/*!
 * COPYRIGHT (c) 2026 PAKS LLC. ALL RIGHTS RESERVED.
 * Taipei, Taiwan
 *
 * Official Channels:
 * - Facebook: https://www.facebook.com/sys0001x
 * - Instagram / X / TikTok: @sys0001x
 *
 * WARNING: PROTECTED BY INTERNATIONAL COPYRIGHT AND INTELLECTUAL PROPERTY LAWS.
 *
 * This extension bundle consists of strictly proprietary, classified, and
 * confidential software exclusively owned by PAKS LLC.
 *
 * ANY UNAUTHORIZED COPYING, DISTRIBUTION, REVERSE ENGINEERING, DECOMPILATION,
 * MODIFICATION, RESALE, SUBLICENSING, OR COMMERCIAL EXPLOITATION OF THIS SOFTWARE,
 * IN WHOLE OR IN PART, IS ABSOLUTELY PROHIBITED AND WILL BE PROSECUTED.
 *
 * VIOLATORS WILL BE HELD LIABLE TO THE FULLEST EXTENT OF THE LAW, INCLUDING
 * BUT NOT LIMITED TO SEVERE CIVIL DAMAGES, STATUTORY INJUNCTIONS, AND CRIMINAL
 * PENALTIES. WE ACTIVE MONITOR AND ENFORCE ALL INTELLECTUAL PROPERTY RIGHTS.
 */`;

export const TEXT_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.md',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
]);

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

export function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export async function readJson(file) {
  const source = await readFile(file, 'utf8');
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error.message}`, {
      cause: error,
    });
  }
}

export async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in release inputs: ${absolutePath}`,
      );
    }
    if (entry.isDirectory()) files.push(...(await walkFiles(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
    else
      throw new Error(
        `Unsupported filesystem entry in release inputs: ${absolutePath}`,
      );
  }

  return files;
}

export function isTextFile(file) {
  const basename = path.basename(file).toLowerCase();
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    TEXT_FILE_EXTENSIONS.has(path.extname(basename))
  );
}

export function validateExtensionVersion(version) {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+){0,3}$/u.test(version)) {
    throw new Error(
      `Package version is not a Chrome extension version: ${String(version)}`,
    );
  }

  const components = version.split('.').map(Number);
  if (components.every((component) => component === 0)) {
    throw new Error('Chrome extension version must not be all zeroes');
  }
  if (components.some((component) => component > 65_535)) {
    throw new Error(
      `Chrome extension version component exceeds 65535: ${version}`,
    );
  }

  return version;
}

export async function readPackageMetadata(projectRoot = PROJECT_ROOT) {
  const packageFile = path.join(projectRoot, 'package.json');
  const packageJson = await readJson(packageFile);
  if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
    throw new Error(`${packageFile} does not contain a package name`);
  }
  return {
    name: packageJson.name,
    version: validateExtensionVersion(packageJson.version),
  };
}

export function expectedZipName(packageMetadata) {
  return `${packageMetadata.name}-${packageMetadata.version}-chrome.zip`;
}

export function isMainModule(metaUrl) {
  return Boolean(
    process.argv[1] &&
    path.resolve(fileURLToPath(metaUrl)) === path.resolve(process.argv[1]),
  );
}
