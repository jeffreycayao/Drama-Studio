import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  LEGAL_BANNER,
  PROJECT_ROOT,
  expectedZipName,
  isMainModule,
  isTextFile,
  readPackageMetadata,
  toPosixPath,
  walkFiles,
} from './lib/release-common.mjs';
import { assertNoFindings, scanText } from './lib/security-scanner.mjs';
import { containsForbiddenSourceMarker } from './lib/source-boundaries.mjs';
import { readDeterministicZip } from './lib/zip-reader.mjs';
import { verifyProductionBuild } from './verify-production-build.mjs';

function parseManifest(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid manifest JSON in ${label}: ${error.message}`, {
      cause: error,
    });
  }
}

export async function verifyReleaseZip({ projectRoot = PROJECT_ROOT } = {}) {
  const outputRoot = path.join(projectRoot, '.output', 'chrome-mv3');
  const packageMetadata = await readPackageMetadata(projectRoot);
  await verifyProductionBuild({ projectRoot, outputRoot });

  const outputDirectory = path.join(projectRoot, '.output');
  const expectedName = expectedZipName(packageMetadata);
  const zipCandidates = (await readdir(outputDirectory))
    .filter((name) => name.toLowerCase().endsWith('.zip'))
    .sort();
  if (zipCandidates.length !== 1 || zipCandidates[0] !== expectedName) {
    throw new Error(
      `Expected exactly ${expectedName} in .output; found: ${zipCandidates.join(', ') || '<none>'}`,
    );
  }

  const zipPath = path.join(outputDirectory, expectedName);
  const archiveBuffer = await readFile(zipPath);
  const archiveEntries = readDeterministicZip(archiveBuffer);
  const archiveByName = new Map(
    archiveEntries.map((entry) => [entry.name, entry]),
  );

  const unpackedFiles = await walkFiles(outputRoot);
  const unpackedNames = unpackedFiles
    .map((file) => toPosixPath(path.relative(outputRoot, file)))
    .sort();
  const archiveNames = archiveEntries.map((entry) => entry.name);
  if (
    unpackedNames.length !== archiveNames.length ||
    unpackedNames.some((name, index) => name !== archiveNames[index])
  ) {
    const onlyUnpacked = unpackedNames.filter(
      (name) => !archiveByName.has(name),
    );
    const unpackedSet = new Set(unpackedNames);
    const onlyArchive = archiveNames.filter((name) => !unpackedSet.has(name));
    throw new Error(
      `ZIP file tree differs from unpacked output. Only unpacked: ${onlyUnpacked.join(', ') || '<none>'}; only ZIP: ${onlyArchive.join(', ') || '<none>'}`,
    );
  }

  for (const file of unpackedFiles) {
    const name = toPosixPath(path.relative(outputRoot, file));
    const unpackedData = await readFile(file);
    if (!unpackedData.equals(archiveByName.get(name).data)) {
      throw new Error(`ZIP content differs from unpacked output: ${name}`);
    }
  }

  const manifestEntry = archiveByName.get('manifest.json');
  if (!manifestEntry) throw new Error('ZIP root manifest.json is missing');
  const manifest = parseManifest(manifestEntry.data, expectedName);
  if (manifest.version !== packageMetadata.version) {
    throw new Error(
      `ZIP manifest version ${String(manifest.version)} does not match package ${packageMetadata.version}`,
    );
  }
  if (manifest.manifest_version !== 3) {
    throw new Error(
      `ZIP does not contain a Manifest V3 extension: ${String(manifest.manifest_version)}`,
    );
  }
  if (Object.hasOwn(manifest, 'key')) {
    throw new Error(
      'ZIP manifest must not contain a public key while the new extension identity is pending',
    );
  }

  const findings = [];
  const markerEntries = [];
  let javascriptFiles = 0;
  for (const entry of archiveEntries) {
    if (entry.name.endsWith('.js')) {
      javascriptFiles += 1;
      if (!entry.data.toString('utf8').startsWith(LEGAL_BANNER)) {
        throw new Error(
          `Exact required legal banner is missing from ZIP entry ${entry.name}`,
        );
      }
    }
    if (!isTextFile(entry.name)) continue;
    const text = entry.data.toString('utf8');
    if (containsForbiddenSourceMarker(text)) markerEntries.push(entry.name);
    findings.push(...scanText(text, { file: `${expectedName}:${entry.name}` }));
  }
  if (javascriptFiles === 0)
    throw new Error('ZIP does not contain JavaScript files');
  assertNoFindings(findings, 'Release ZIP security scan');
  if (markerEntries.length > 0) {
    throw new Error(
      `Release ZIP contains recovery source-path markers:\n${markerEntries.join('\n')}`,
    );
  }

  return {
    entries: archiveEntries.length,
    javascriptFiles,
    path: zipPath,
    sha256: createHash('sha256').update(archiveBuffer).digest('hex'),
    version: packageMetadata.version,
  };
}

if (isMainModule(import.meta.url)) {
  const result = await verifyReleaseZip();
  process.stdout.write(
    `Verified deterministic release ZIP ${result.path}\nVersion: ${result.version}\nEntries: ${result.entries}\nJavaScript banners: ${result.javascriptFiles}\nSHA-256: ${result.sha256}\n`,
  );
}
