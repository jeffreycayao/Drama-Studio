import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  repositoryRoot,
  vercelOrgId,
  vercelSurfaces,
} from './vercel-surfaces.mjs';

const releaseStagePrefix = 'paks-vercel-release-';
const activeCandidateEvidenceLocks = new WeakSet();
const activeSurfaceReleaseLocks = new WeakSet();
export const minimumLegacyProtocolDeployWindowMs = 30 * 24 * 60 * 60 * 1_000;
const ignoredDirectoryNames = new Set([
  '.git',
  '.output',
  '.recovery-tmp',
  '.vercel',
  '.wxt',
  'coverage',
  'dist',
  'node_modules',
]);
const rootReleaseFiles = new Set(['.nvmrc', 'package-lock.json']);
const generatedConfigName = 'vercel.json';
const sensitiveBasenames = new Set([
  '.npmrc',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
]);

const surfaceInputs = Object.freeze({
  dashboard: Object.freeze({
    exactFiles: new Set([
      'apps/faceless-automation-dashboard/index.html',
      'apps/faceless-automation-dashboard/package.json',
      'apps/faceless-automation-dashboard/scripts/verify-build.mjs',
      'apps/faceless-automation-dashboard/tsconfig.app.json',
      'apps/faceless-automation-dashboard/tsconfig.json',
      'apps/faceless-automation-dashboard/tsconfig.node.json',
      'apps/faceless-automation-dashboard/vite.config.ts',
      'packages/brand/package.json',
      'packages/brand/THIRD_PARTY_NOTICES.md',
    ]),
    directoryPrefixes: Object.freeze([
      'apps/faceless-automation-dashboard/public/',
      'apps/faceless-automation-dashboard/src/',
      'packages/brand/src/',
    ]),
    workspaces: Object.freeze([
      'apps/faceless-automation-dashboard',
      'packages/brand',
    ]),
  }),
  api: Object.freeze({
    exactFiles: new Set([
      'apps/faceless-platform-api/package.json',
      'apps/faceless-platform-api/scripts/verify-build.mjs',
      'apps/faceless-platform-api/tsconfig.build.json',
      'apps/faceless-platform-api/tsconfig.json',
      'packages/platform-contracts/package.json',
      'packages/platform-contracts/scripts/verify-build.mjs',
      'packages/platform-contracts/tsconfig.build.json',
      'packages/platform-contracts/tsconfig.json',
    ]),
    directoryPrefixes: Object.freeze([
      'api/',
      'apps/faceless-platform-api/api/',
      'apps/faceless-platform-api/db/migrations/',
      'apps/faceless-platform-api/public/',
      'apps/faceless-platform-api/src/',
      'packages/platform-contracts/src/',
    ]),
    workspaces: Object.freeze([
      'apps/faceless-platform-api',
      'packages/platform-contracts',
    ]),
  }),
});

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

export function isSensitiveReleasePath(relativePath) {
  const normalized = toPosix(relativePath);
  const segments = normalized.split('/');
  const basename = (segments.at(-1) ?? '').toLowerCase();
  if (
    basename === '.env' ||
    (basename.startsWith('.env.') &&
      !['.env.example', '.env.sample', '.env.template'].includes(basename))
  ) {
    return true;
  }
  if (sensitiveBasenames.has(basename)) return true;
  return (
    /\.(?:der|jks|key|keystore|p12|pfx|pkcs12|pem)$/iu.test(basename) ||
    /^(?:service[-_.]?account|private[-_.]?key)(?:[-_.].*)?\.json$/iu.test(
      basename,
    )
  );
}

function isTraversalDirectory(normalized, surfaceInputsForTarget) {
  if (normalized === 'apps' || normalized === 'packages') return true;
  if (
    [...surfaceInputsForTarget.exactFiles].some((file) =>
      file.startsWith(`${normalized}/`),
    )
  ) {
    return true;
  }
  return surfaceInputsForTarget.directoryPrefixes.some((prefix) => {
    const directory = prefix.slice(0, -1);
    return directory === normalized || directory.startsWith(`${normalized}/`);
  });
}

export function includeReleasePath(surface, relativePath) {
  const normalized = toPosix(relativePath);
  if (normalized === '') return true;
  const segments = normalized.split('/');
  if (
    segments.some((segment) => ignoredDirectoryNames.has(segment)) ||
    isSensitiveReleasePath(normalized)
  ) {
    return false;
  }
  const basename = segments.at(-1) ?? '';
  if (/\.(?:log|zip)$/iu.test(basename)) return false;
  if (
    normalized === generatedConfigName ||
    /^vercel(?:\.[a-z0-9_-]+)?\.json$/iu.test(normalized)
  ) {
    return false;
  }
  if (rootReleaseFiles.has(normalized)) return true;

  const allowedInputs = surfaceInputs[surface.id];
  if (allowedInputs === undefined) return false;
  if (allowedInputs.exactFiles.has(normalized)) return true;
  if (
    allowedInputs.directoryPrefixes.some((prefix) =>
      normalized.startsWith(prefix),
    )
  ) {
    return true;
  }
  return isTraversalDirectory(normalized, allowedInputs);
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeJson(nested)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(normalizeJson(value));
}

export function digestJson(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export async function readCanonicalConfig(surface) {
  const configPath = path.join(repositoryRoot, surface.canonicalConfig);
  return JSON.parse(await readFile(configPath, 'utf8'));
}

export async function assertCanonicalConfig(surface) {
  const actual = await readCanonicalConfig(surface);
  assert.deepStrictEqual(
    normalizeJson(actual),
    normalizeJson(surface.expectedConfig),
    `${surface.canonicalConfig} drifted from the reviewed ${surface.id} deployment contract.`,
  );
  return actual;
}

export async function verifyCanonicalConfigs() {
  const results = [];
  for (const surface of Object.values(vercelSurfaces)) {
    const config = await assertCanonicalConfig(surface);
    results.push({
      surface: surface.id,
      config: surface.canonicalConfig,
      digest: digestJson(config),
    });
  }

  const localLinkPath = path.join(repositoryRoot, '.vercel', 'project.json');
  try {
    const localLink = JSON.parse(await readFile(localLinkPath, 'utf8'));
    const dashboard = vercelSurfaces.dashboard;
    assert.deepStrictEqual(
      localLink,
      {
        projectId: dashboard.projectId,
        orgId: vercelOrgId,
        projectName: dashboard.projectName,
      },
      'The optional root .vercel link must remain bound to the canonical dashboard project.',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await readLegacyProtocolSunsetAt();
  return results;
}

export function validateLegacyProtocolSunset(
  value,
  now = Date.now(),
  minimumWindowMs = minimumLegacyProtocolDeployWindowMs,
) {
  const sunset = Date.parse(value);
  if (
    typeof value !== 'string' ||
    !Number.isFinite(sunset) ||
    !Number.isFinite(now) ||
    !Number.isFinite(minimumWindowMs) ||
    minimumWindowMs < 0
  ) {
    throw new Error(
      'Legacy extension protocol sunset configuration is invalid.',
    );
  }
  if (sunset - now < minimumWindowMs) {
    throw new Error(
      'Legacy extension protocol sunset must remain at least 30 days in the future before release.',
    );
  }
  return new Date(sunset).toISOString();
}

export async function readLegacyProtocolSunsetAt(
  sourceRoot = repositoryRoot,
  now = Date.now(),
) {
  const source = await readFile(
    path.join(
      sourceRoot,
      'apps',
      'faceless-platform-api',
      'src',
      'core',
      'compatibility.ts',
    ),
    'utf8',
  );
  const matches = [
    ...source.matchAll(/export const LEGACY_PROTOCOL_SUNSET_AT = '([^']+)';/gu),
  ];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(
      'Legacy extension protocol sunset must have one canonical source constant.',
    );
  }
  return validateLegacyProtocolSunset(matches[0][1], now);
}

async function walkIncludedFiles(root, surface, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (isSensitiveReleasePath(relative)) {
      throw new Error(
        `Release snapshots reject sensitive credential/key artifacts: ${toPosix(relative)}`,
      );
    }
    if (!includeReleasePath(surface, relative)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Release snapshots do not allow symbolic links: ${relative}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await walkIncludedFiles(root, surface, absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    } else {
      throw new Error(`Unsupported release entry: ${relative}`);
    }
  }
  return files;
}

function hashFile(hash, relative, contents) {
  hash.update(relative);
  hash.update('\0');
  hash.update(contents);
  hash.update('\0');
}

function generatedConfigContents(surface) {
  return `${JSON.stringify(surface.expectedConfig, null, 2)}\n`;
}

async function stagedRootPackageContents(surface, root) {
  const allowedInputs = surfaceInputs[surface.id];
  if (allowedInputs === undefined) {
    throw new Error(`No release-input contract exists for ${surface.id}.`);
  }
  const sourcePackage = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  return `${JSON.stringify(
    { ...sourcePackage, workspaces: [...allowedInputs.workspaces] },
    null,
    2,
  )}\n`;
}

export async function computeSourceDigest(surface, root = repositoryRoot) {
  const hash = createHash('sha256');
  const files = await walkIncludedFiles(root, surface);
  for (const file of files) {
    const relative = toPosix(path.relative(root, file));
    hashFile(hash, relative, await readFile(file));
  }
  hashFile(
    hash,
    'package.json',
    await stagedRootPackageContents(surface, root),
  );
  hashFile(hash, generatedConfigName, generatedConfigContents(surface));
  return hash.digest('hex');
}

async function writeProjectLink(stageRoot, surface) {
  const linkRoot = path.join(stageRoot, '.vercel');
  await mkdir(linkRoot, { recursive: true });
  await writeFile(
    path.join(linkRoot, 'project.json'),
    `${JSON.stringify({
      projectId: surface.projectId,
      orgId: vercelOrgId,
      projectName: surface.projectName,
    })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
}

export async function createReleaseStage(
  surface,
  sourceDigest,
  sourceRoot = repositoryRoot,
) {
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), releaseStagePrefix));
  try {
    const files = await walkIncludedFiles(sourceRoot, surface);
    for (const source of files) {
      const relative = path.relative(sourceRoot, source);
      const destination = path.join(stageRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    await writeFile(
      path.join(stageRoot, 'package.json'),
      await stagedRootPackageContents(surface, sourceRoot),
      { encoding: 'utf8', flag: 'wx' },
    );
    await writeFile(
      path.join(stageRoot, generatedConfigName),
      generatedConfigContents(surface),
      { encoding: 'utf8', flag: 'wx' },
    );
    const stagedDigest = await computeSourceDigest(surface, stageRoot);
    if (stagedDigest !== sourceDigest) {
      throw new Error(
        'The isolated release snapshot does not match the reviewed source tree.',
      );
    }
    await writeProjectLink(stageRoot, surface);
    return stageRoot;
  } catch (error) {
    await removeReleaseStage(stageRoot);
    throw error;
  }
}

export async function createProjectContext(surface) {
  const contextRoot = await mkdtemp(path.join(os.tmpdir(), releaseStagePrefix));
  try {
    await writeProjectLink(contextRoot, surface);
    await writeFile(
      path.join(contextRoot, generatedConfigName),
      generatedConfigContents(surface),
      { encoding: 'utf8', flag: 'wx' },
    );
    return contextRoot;
  } catch (error) {
    await removeReleaseStage(contextRoot);
    throw error;
  }
}

export async function removeReleaseStage(stageRoot) {
  const resolved = path.resolve(stageRoot);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== temporaryRoot ||
    !path.basename(resolved).startsWith(releaseStagePrefix)
  ) {
    throw new Error(
      `Refusing to remove an unrecognized release stage: ${resolved}`,
    );
  }
  await rm(resolved, { recursive: true, force: true });
}

export function parseDeploymentOutput(stdout) {
  const parsed = JSON.parse(stdout.trim());
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof parsed.id !== 'string' ||
    !/^dpl_[A-Za-z0-9]+$/u.test(parsed.id) ||
    typeof parsed.url !== 'string' ||
    parsed.url.length === 0
  ) {
    throw new Error('Vercel did not return a valid deployment identity.');
  }
  return parsed;
}

export function buildCandidateDeployArguments(surface, stageRoot, identity) {
  return [
    'deploy',
    stageRoot,
    '--target',
    'production',
    '--skip-domain',
    '--yes',
    '--format=json',
    '--meta',
    `paksSurface=${surface.id}`,
    '--meta',
    `gitCommit=${identity.gitCommit}`,
    '--meta',
    `sourceDigest=${identity.sourceDigest}`,
  ];
}

function deployedConfig(inspection) {
  if (!Array.isArray(inspection.builds) || inspection.builds.length !== 1) {
    throw new Error('Expected exactly one Vercel build for the candidate.');
  }
  const [build] = inspection.builds;
  if (build?.readyState !== 'READY') {
    throw new Error('The candidate build is not READY.');
  }
  if (build.config === null || typeof build.config !== 'object') {
    throw new Error('The candidate is missing build configuration evidence.');
  }
  return { build, vercelConfig: build.config.vercelConfig ?? {} };
}

export function deploymentFunctionInventory(inspection) {
  const outputs = Array.isArray(inspection.builds)
    ? inspection.builds.flatMap((build) =>
        Array.isArray(build.output) ? build.output : [],
      )
    : [];
  return outputs
    .filter((output) => output?.type === 'lambda' || output?.type === 'edge')
    .map((output) => output.path)
    .sort();
}

export function validateDeploymentInspection(
  surface,
  inspection,
  { requireUnaliased = true } = {},
) {
  if (inspection?.name !== surface.projectName) {
    throw new Error(
      `Deployment belongs to ${JSON.stringify(inspection?.name)}, not ${surface.projectName}.`,
    );
  }
  if (
    inspection?.target !== 'production' ||
    inspection?.readyState !== 'READY'
  ) {
    throw new Error(
      'Candidate must be an unpromoted READY production-target deployment.',
    );
  }
  if (!/^dpl_[A-Za-z0-9]+$/u.test(inspection.id ?? '')) {
    throw new Error('Candidate deployment ID is invalid.');
  }
  const aliases = Array.isArray(inspection.aliases) ? inspection.aliases : [];
  if (requireUnaliased && aliases.length > 0) {
    throw new Error(
      'Candidate already has aliases and is not safe to qualify or promote.',
    );
  }

  const { build, vercelConfig } = deployedConfig(inspection);
  for (const key of ['installCommand', 'buildCommand', 'outputDirectory']) {
    if (build.config[key] !== surface.expectedConfig[key]) {
      throw new Error(
        `Candidate ${key} does not match ${surface.canonicalConfig}.`,
      );
    }
  }
  for (const [key, emptyValue] of [
    ['functions', {}],
    ['crons', []],
    ['rewrites', []],
    ['headers', []],
  ]) {
    assert.deepStrictEqual(
      normalizeJson(vercelConfig[key] ?? emptyValue),
      normalizeJson(surface.expectedConfig[key] ?? emptyValue),
      `Candidate ${key} drifted from ${surface.canonicalConfig}.`,
    );
  }

  const functions = deploymentFunctionInventory(inspection);
  assert.deepStrictEqual(
    functions,
    [...surface.expectedFunctions].sort(),
    `Candidate function inventory does not match the ${surface.id} allowlist.`,
  );
  if (surface.id === 'dashboard' && functions.includes('api/index')) {
    throw new Error('Dashboard candidate contains the root API function.');
  }

  for (const output of Array.isArray(build.output) ? build.output : []) {
    if (
      (output?.type === 'lambda' || output?.type === 'edge') &&
      (typeof output.digest !== 'string' ||
        !output.digest.startsWith(`${surface.projectId}/`))
    ) {
      throw new Error(
        'Candidate function digest is not bound to the expected Vercel project.',
      );
    }
  }
  return {
    id: inspection.id,
    url: inspection.url,
    functions,
    aliases,
  };
}

function requireIsoTimestamp(value, label) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO-8601 timestamp.`);
  }
  return value;
}

function migrationCronForSurface(surface) {
  if (surface?.id !== 'api') {
    throw new Error(
      'Database migration is available only for the API surface.',
    );
  }
  const crons = surface.expectedConfig?.crons;
  if (
    !Array.isArray(crons) ||
    crons.length !== 1 ||
    typeof crons[0]?.path !== 'string' ||
    typeof crons[0]?.schedule !== 'string'
  ) {
    throw new Error(
      'The API migration phase requires exactly one canonical cron definition.',
    );
  }
  return crons[0];
}

function exactDeploymentHost(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing a deployment host.`);
  }
  let parsed;
  try {
    parsed = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    throw new Error(`${label} has an invalid deployment host.`);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/u.test(parsed.hostname)
  ) {
    throw new Error(`${label} is not an exact immutable Vercel host.`);
  }
  return parsed.hostname;
}

export function assertMigrationCandidateEvidence(
  surface,
  inspection,
  evidence,
  identity,
  { allowPotentialCronExposure = false } = {},
) {
  migrationCronForSurface(surface);
  const candidate = validateDeploymentInspection(surface, inspection, {
    requireUnaliased: true,
  });
  if (evidence === null || typeof evidence !== 'object') {
    throw new Error(
      'API migration requires local evidence for the exact release candidate.',
    );
  }
  const expectedEvidence = {
    schemaVersion: 1,
    surface: surface.id,
    deploymentId: candidate.id,
    deploymentUrl: candidate.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    gitCommit: identity?.gitCommit,
    sourceDigest: identity?.sourceDigest,
    migrationVersion: identity?.migrationVersion,
    configDigest: identity?.configDigest,
  };
  for (const [key, expected] of Object.entries(expectedEvidence)) {
    if (evidence[key] !== expected) {
      throw new Error(
        `API migration evidence ${key} is not bound to this release candidate.`,
      );
    }
  }
  if (evidence.promotedAt !== null) {
    throw new Error('Refusing to migrate a promoted API candidate.');
  }
  if (evidence.qualifiedAt !== null) {
    throw new Error(
      'API migration must run before qualification so readiness is measured afterward.',
    );
  }
  requireIsoTimestamp(evidence.createdAt, 'Candidate creation evidence');
  requireIsoTimestamp(evidence.validatedAt, 'Candidate validation evidence');
  for (const key of ['migrationStartedAt', 'migratedAt', 'migrationResult']) {
    if (!Object.hasOwn(evidence, key)) {
      throw new Error(
        `API migration evidence is missing the guarded ${key} field.`,
      );
    }
  }
  const cronExposure = evidence.cronExposure;
  const allowedStatuses = allowPotentialCronExposure
    ? new Set(['potential', 'provider_bound'])
    : new Set(['provider_bound']);
  if (
    cronExposure === null ||
    typeof cronExposure !== 'object' ||
    !allowedStatuses.has(cronExposure.status) ||
    cronExposure.deploymentId !== candidate.id ||
    cronExposure.deploymentUrl !== candidate.url
  ) {
    throw new Error(
      'API migration requires exact provider-bound cron exposure evidence.',
    );
  }
  requireIsoTimestamp(
    cronExposure.recordedAt,
    'Candidate cron exposure evidence',
  );
  return candidate;
}

export function validateMigrationProjectState(
  surface,
  projectState,
  candidate,
) {
  const expectedCron = migrationCronForSurface(surface);
  if (projectState === null || typeof projectState !== 'object') {
    throw new Error('Vercel returned invalid API project state.');
  }
  if (
    projectState.id !== surface.projectId ||
    projectState.name !== surface.projectName ||
    projectState.accountId !== vercelOrgId
  ) {
    throw new Error(
      'Vercel project state is not bound to the exact API project and organization.',
    );
  }
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    !/^dpl_[A-Za-z0-9]+$/u.test(candidate.id ?? '')
  ) {
    throw new Error('API migration candidate identity is invalid.');
  }
  const candidateHost = exactDeploymentHost(
    candidate.url,
    'API migration candidate',
  );
  const crons = projectState.crons;
  if (crons === null || typeof crons !== 'object') {
    throw new Error('Vercel project state is missing cron binding evidence.');
  }
  if (crons.disabledAt !== null) {
    throw new Error('The API migration cron is disabled.');
  }
  if (crons.deploymentId !== candidate.id) {
    throw new Error(
      'The API migration cron is not bound to the requested candidate deployment.',
    );
  }
  if (!Array.isArray(crons.definitions) || crons.definitions.length !== 1) {
    throw new Error(
      'The API migration cron host is ambiguous; exactly one deployed definition is required.',
    );
  }
  const [definition] = crons.definitions;
  if (
    definition?.path !== expectedCron.path ||
    definition?.schedule !== expectedCron.schedule
  ) {
    throw new Error(
      'The deployed API migration cron path or schedule does not match the canonical config.',
    );
  }
  const cronHost = exactDeploymentHost(
    definition.host,
    'API migration cron definition',
  );
  if (cronHost !== candidateHost) {
    throw new Error(
      'The API migration cron definition does not target the requested candidate host.',
    );
  }

  const production = projectState.targets?.production;
  if (production === null || typeof production !== 'object') {
    throw new Error('Vercel project state is missing the production target.');
  }
  if (production.id === candidate.id) {
    throw new Error(
      'Refusing migration because the requested candidate is already the stable production target.',
    );
  }
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(production.id ?? '') ||
    production.name !== surface.projectName ||
    production.teamId !== vercelOrgId ||
    production.target !== 'production' ||
    production.readyState !== 'READY'
  ) {
    throw new Error(
      'The existing stable API target is not an exact READY production deployment.',
    );
  }
  const productionHost = exactDeploymentHost(
    production.url,
    'Stable API deployment',
  );
  if (productionHost === candidateHost) {
    throw new Error(
      'The candidate host is ambiguously reported as the stable production host.',
    );
  }
  const stableHost = new URL(surface.stableOrigin).hostname;
  if (
    !Array.isArray(production.alias) ||
    !production.alias.includes(stableHost) ||
    production.alias.includes(candidateHost)
  ) {
    throw new Error(
      'The production target aliases do not prove a distinct stable deployment.',
    );
  }

  return {
    schemaVersion: 1,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    cronDeploymentId: candidate.id,
    cronPath: expectedCron.path,
    cronSchedule: expectedCron.schedule,
    cronHost,
    productionDeploymentId: production.id,
    productionHost,
    stableHost,
  };
}

export function validateCandidateCronExposure(
  surface,
  candidate,
  evidence,
  binding,
) {
  const exposure = evidence?.cronExposure;
  if (exposure === null || typeof exposure !== 'object') {
    throw new Error(
      'API candidate evidence is missing provider cron-exposure evidence.',
    );
  }
  const expected = {
    schemaVersion: 1,
    status: 'provider_bound',
    path: binding.cronPath,
    schedule: binding.cronSchedule,
    deploymentId: candidate.id,
    deploymentUrl: candidate.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    bindingDigest: digestJson(binding),
    productionDeploymentId: binding.productionDeploymentId,
    productionHost: binding.productionHost,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (exposure[key] !== value) {
      throw new Error(
        `API candidate cron exposure ${key} does not match the current provider binding.`,
      );
    }
  }
  requireIsoTimestamp(exposure.recordedAt, 'Candidate cron exposure evidence');
  return exposure;
}

export function validatePromotedApiProjectState(
  surface,
  projectState,
  candidate,
) {
  const expectedCron = migrationCronForSurface(surface);
  if (
    projectState === null ||
    typeof projectState !== 'object' ||
    projectState.id !== surface.projectId ||
    projectState.name !== surface.projectName ||
    projectState.accountId !== vercelOrgId
  ) {
    throw new Error(
      'Post-promotion state is not bound to the exact API project and organization.',
    );
  }
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    !/^dpl_[A-Za-z0-9]+$/u.test(candidate.id ?? '')
  ) {
    throw new Error('Post-promotion API candidate identity is invalid.');
  }
  const candidateHost = exactDeploymentHost(
    candidate.url,
    'Promoted API candidate',
  );
  const crons = projectState.crons;
  if (
    crons === null ||
    typeof crons !== 'object' ||
    crons.disabledAt !== null ||
    crons.deploymentId !== candidate.id ||
    !Array.isArray(crons.definitions) ||
    crons.definitions.length !== 1
  ) {
    throw new Error(
      'Post-promotion API cron is not exclusively bound to the promoted candidate.',
    );
  }
  const [definition] = crons.definitions;
  if (
    definition?.path !== expectedCron.path ||
    definition?.schedule !== expectedCron.schedule ||
    exactDeploymentHost(
      definition?.host,
      'Post-promotion API cron definition',
    ) !== candidateHost
  ) {
    throw new Error(
      'Post-promotion API cron path, schedule, or host is stale.',
    );
  }
  const production = projectState.targets?.production;
  if (
    production === null ||
    typeof production !== 'object' ||
    production.id !== candidate.id ||
    production.name !== surface.projectName ||
    production.teamId !== vercelOrgId ||
    production.target !== 'production' ||
    production.readyState !== 'READY' ||
    exactDeploymentHost(production.url, 'Post-promotion API target') !==
      candidateHost
  ) {
    throw new Error(
      'Post-promotion production target is not the exact READY API candidate.',
    );
  }
  const stableHost = new URL(surface.stableOrigin).hostname;
  if (
    !Array.isArray(production.alias) ||
    !production.alias.includes(stableHost)
  ) {
    throw new Error(
      'Post-promotion API target does not own the canonical stable alias.',
    );
  }
  return {
    schemaVersion: 1,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    deploymentId: candidate.id,
    deploymentHost: candidateHost,
    cronPath: expectedCron.path,
    cronSchedule: expectedCron.schedule,
    stableHost,
  };
}

export function assertSameMigrationBinding(before, after) {
  assert.deepStrictEqual(
    normalizeJson(after),
    normalizeJson(before),
    'Vercel changed the API cron or production binding during migration.',
  );
  return after;
}

export function buildMigrationCronArguments(surface) {
  const cron = migrationCronForSurface(surface);
  return ['crons', 'run', cron.path];
}

export function parseCronRunOutput(stdout, expectedPath) {
  if (typeof stdout !== 'string') {
    throw new Error('Vercel cron invocation did not return text evidence.');
  }
  const normalized = stdout.replace(/\r\n/gu, '\n');
  const triggerMatches = [
    ...normalized.matchAll(/^Cron job (\S+) triggered(?: \[[^\n]*\])?$/gmu),
  ];
  const invocationMatches = [
    ...normalized.matchAll(/^\s*Invocation time:\s*(\S+)\s*$/gmu),
  ];
  if (
    triggerMatches.length !== 1 ||
    triggerMatches[0]?.[1] !== expectedPath ||
    invocationMatches.length !== 1 ||
    invocationMatches[0]?.[1] === undefined
  ) {
    throw new Error(
      'Vercel cron invocation output did not prove the exact migration path and result.',
    );
  }
  return {
    status: 'triggered',
    invocationAt: requireIsoTimestamp(
      invocationMatches[0][1],
      'Cron invocation evidence',
    ),
  };
}

export function parseCandidateReadiness(response) {
  if (
    response === null ||
    typeof response !== 'object' ||
    !Number.isInteger(response.status) ||
    typeof response.body !== 'string'
  ) {
    throw new Error('Candidate readiness response is invalid.');
  }
  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Error('Candidate readiness did not return valid JSON.');
  }
  if (response.status === 200 && body?.status === 'ready') {
    return 'ready';
  }
  if (response.status === 503 && body?.status === 'not_ready') {
    return 'not_ready';
  }
  throw new Error(
    `Candidate readiness returned an unexpected HTTP ${response.status} result.`,
  );
}

function expectedMigrationResult(surface, candidate, identity) {
  const cron = migrationCronForSurface(surface);
  return {
    schemaVersion: 1,
    command: `vercel crons run ${cron.path}`,
    path: cron.path,
    schedule: cron.schedule,
    deploymentId: candidate.id,
    deploymentUrl: candidate.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    migrationVersion: identity?.migrationVersion,
    currentVersion: identity?.migrationVersion,
  };
}

export function validateMigrationAttemptEvidence(
  surface,
  candidate,
  evidence,
  identity,
  { binding, requireReady = false } = {},
) {
  const result = evidence?.migrationResult;
  if (result === null || typeof result !== 'object') {
    throw new Error('Candidate has no API migration invocation evidence.');
  }
  for (const [key, expected] of Object.entries(
    expectedMigrationResult(surface, candidate, identity),
  )) {
    if (result[key] !== expected) {
      throw new Error(
        `API migration result ${key} is not bound to this release candidate.`,
      );
    }
  }
  const migrationStartedAt = Date.parse(
    requireIsoTimestamp(
      evidence.migrationStartedAt,
      'Migration start evidence',
    ),
  );
  if (
    typeof result.bindingDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(result.bindingDigest)
  ) {
    throw new Error('API migration result has invalid binding evidence.');
  }
  if (binding !== undefined && result.bindingDigest !== digestJson(binding)) {
    throw new Error(
      'API migration result no longer matches the current candidate cron binding.',
    );
  }
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(result.productionDeploymentId ?? '') ||
    result.productionDeploymentId === candidate.id
  ) {
    throw new Error(
      'API migration result is missing a distinct prior production deployment.',
    );
  }
  const candidateHost = exactDeploymentHost(
    candidate.url,
    'API migration candidate',
  );
  const productionHost = exactDeploymentHost(
    result.productionHost,
    'Prior stable API deployment',
  );
  if (productionHost === candidateHost) {
    throw new Error(
      'API migration result ambiguously identifies the candidate as the prior stable deployment.',
    );
  }
  if (binding !== undefined) {
    if (
      result.productionDeploymentId !== binding.productionDeploymentId ||
      result.productionHost !== binding.productionHost
    ) {
      throw new Error(
        'API migration result no longer matches the prior production target.',
      );
    }
  }
  if (result.status === 'starting') {
    if (
      evidence.migratedAt !== null ||
      result.invocationAt !== null ||
      result.readiness !== null ||
      result.recovery !== null
    ) {
      throw new Error('Starting API migration evidence is internally invalid.');
    }
    if (requireReady) {
      throw new Error(
        'API migration invocation outcome is ambiguous; candidate readiness must be reconciled without reinvoking the cron.',
      );
    }
    return result;
  }
  if (result.status === 'triggered') {
    requireIsoTimestamp(result.invocationAt, 'Migration invocation evidence');
    if (
      evidence.migratedAt !== null ||
      result.readiness !== null ||
      (result.recovery !== null && result.recovery !== undefined)
    ) {
      throw new Error(
        'Triggered API migration evidence is internally invalid.',
      );
    }
    if (requireReady) {
      throw new Error(
        'API migration was triggered but candidate readiness is not yet proven.',
      );
    }
    return result;
  }
  if (result.status !== 'ready') {
    throw new Error('API migration result has an unknown status.');
  }
  if (
    result.readiness === null ||
    typeof result.readiness !== 'object' ||
    result.readiness.status !== 'ready' ||
    !Number.isInteger(result.readiness.attempts) ||
    result.readiness.attempts < 1 ||
    result.readiness.attempts > 15
  ) {
    throw new Error('API migration result lacks candidate readiness evidence.');
  }
  const readinessObservedAt = Date.parse(
    requireIsoTimestamp(
      result.readiness.observedAt,
      'Candidate readiness evidence',
    ),
  );
  const migratedAt = Date.parse(
    requireIsoTimestamp(evidence.migratedAt, 'Migration completion evidence'),
  );
  if (result.invocationAt === null) {
    const recovery = result.recovery;
    if (
      recovery === null ||
      typeof recovery !== 'object' ||
      recovery.schemaVersion !== 1 ||
      recovery.status !== 'candidate_readiness_reconciled_without_reinvoke' ||
      recovery.observedAt !== result.readiness.observedAt ||
      recovery.bindingDigest !== result.bindingDigest
    ) {
      throw new Error(
        'Recovered API migration evidence lacks exact no-reinvoke reconciliation proof.',
      );
    }
    requireIsoTimestamp(
      recovery.observedAt,
      'Migration recovery observation evidence',
    );
  } else {
    requireIsoTimestamp(result.invocationAt, 'Migration invocation evidence');
    if (result.recovery !== null && result.recovery !== undefined) {
      throw new Error(
        'API migration evidence cannot contain both invocation and recovery results.',
      );
    }
  }
  if (
    readinessObservedAt < migrationStartedAt ||
    migratedAt < readinessObservedAt
  ) {
    throw new Error('API migration evidence timestamps are out of order.');
  }
  return result;
}

export function assertSafeCleanup(
  surface,
  inspection,
  stableInspection,
  evidence,
  identity,
) {
  if (evidence === null || typeof evidence !== 'object') {
    throw new Error(
      'Safe cleanup requires local evidence for the exact release candidate.',
    );
  }
  const expectedEvidence = {
    schemaVersion: 1,
    surface: surface.id,
    deploymentId: inspection?.id,
    deploymentUrl: inspection?.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    gitCommit: identity?.gitCommit,
    sourceDigest: identity?.sourceDigest,
    migrationVersion: identity?.migrationVersion,
    configDigest: identity?.configDigest,
  };
  for (const [key, expected] of Object.entries(expectedEvidence)) {
    if (evidence[key] !== expected) {
      throw new Error(
        `Safe cleanup evidence ${key} is not bound to this release candidate.`,
      );
    }
  }
  if (evidence.promotedAt !== null) {
    throw new Error('Refusing to clean up a promoted candidate.');
  }
  if (surface.id === 'api') {
    throw new Error(
      'Refusing API candidate cleanup because a production-target candidate can be scheduled by the provider cron before explicit migration; deletion cannot prove or reverse the shared database outcome.',
    );
  }
  for (const key of ['promotionStartedAt', 'promotionResult']) {
    if (!Object.hasOwn(evidence, key)) {
      throw new Error(`Dashboard cleanup evidence is missing ${key}.`);
    }
  }
  if (
    evidence.promotionStartedAt !== null ||
    evidence.promotionResult !== null
  ) {
    throw new Error(
      'Refusing cleanup after a dashboard promotion attempt; the provider-side outcome may be ambiguous.',
    );
  }
  if (evidence.cronExposure !== null) {
    throw new Error(
      'Dashboard cleanup evidence contains unexpected provider cron exposure.',
    );
  }
  if (
    evidence.migrationStartedAt !== null ||
    evidence.migratedAt !== null ||
    evidence.migrationResult !== null
  ) {
    throw new Error(
      'Refusing cleanup after an API migration attempt; removing a candidate cannot roll back the shared database mutation.',
    );
  }
  if (
    typeof evidence.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(evidence.createdAt))
  ) {
    throw new Error('Safe cleanup evidence has an invalid creation time.');
  }
  if (
    inspection?.name !== surface.projectName ||
    stableInspection?.name !== surface.projectName
  ) {
    throw new Error(
      `Cleanup evidence is not bound to the expected ${surface.projectName} project.`,
    );
  }
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(inspection?.id ?? '') ||
    !/^dpl_[A-Za-z0-9]+$/u.test(stableInspection?.id ?? '')
  ) {
    throw new Error('Cleanup evidence contains an invalid deployment ID.');
  }
  if (!Array.isArray(inspection.aliases) || inspection.aliases.length > 0) {
    throw new Error(
      'Refusing to remove a deployment unless Vercel confirms it is unaliased.',
    );
  }
  if (inspection.id === stableInspection.id) {
    throw new Error(
      'Refusing to remove the deployment serving the stable alias.',
    );
  }
}

export async function latestMigrationVersion() {
  const migrationRoot = path.join(
    repositoryRoot,
    'apps',
    'faceless-platform-api',
    'db',
    'migrations',
  );
  const versions = (await readdir(migrationRoot))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .map((name) => name.slice(0, -4))
    .sort();
  const version = versions.at(-1);
  if (version === undefined)
    throw new Error('No canonical API migrations were found.');
  return version;
}

export function parseCurlResponse(stdout) {
  const normalized = stdout.replace(/\r\n/gu, '\n').trimEnd();
  const boundary = normalized.lastIndexOf('\n');
  if (boundary < 0)
    throw new Error('Vercel curl did not return an HTTP status.');
  const status = Number.parseInt(normalized.slice(boundary + 1), 10);
  if (!Number.isInteger(status))
    throw new Error('Vercel curl returned an invalid HTTP status.');
  return { status, body: normalized.slice(0, boundary) };
}

export function validateHealthEvidence(liveResponse, readyResponse) {
  if (liveResponse.status !== 200) {
    throw new Error(`Candidate liveness returned HTTP ${liveResponse.status}.`);
  }
  if (readyResponse.status !== 200) {
    throw new Error(
      `Candidate readiness returned HTTP ${readyResponse.status}.`,
    );
  }
  const live = JSON.parse(liveResponse.body);
  const ready = JSON.parse(readyResponse.body);
  if (live?.status !== 'live' || ready?.status !== 'ready') {
    throw new Error(
      'Candidate health responses did not confirm live and ready states.',
    );
  }
  return { live: live.status, ready: ready.status };
}

function candidateEvidenceRoot(options = {}) {
  return path.resolve(
    options.evidenceRoot ??
      path.join(repositoryRoot, '.vercel', 'release-candidates'),
  );
}

function requireCandidateDeploymentId(deploymentId) {
  if (!/^dpl_[A-Za-z0-9]+$/u.test(deploymentId ?? '')) {
    throw new Error('Candidate evidence requires an exact deployment ID.');
  }
  return deploymentId;
}

function candidateEvidencePath(surface, deploymentId, options = {}) {
  return path.join(
    candidateEvidenceRoot(options),
    `${surface.id}-${requireCandidateDeploymentId(deploymentId)}.json`,
  );
}

function candidateLockPath(surface, deploymentId, options = {}) {
  return path.join(
    candidateEvidenceRoot(options),
    `${surface.id}-${requireCandidateDeploymentId(deploymentId)}.lock`,
  );
}

function surfaceReleaseLockPath(surface, options = {}) {
  return path.join(
    candidateEvidenceRoot(options),
    `${surface.id}-${surface.projectId}.release.lock`,
  );
}

async function syncDirectoryEntry(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
    return 'synced';
  } catch (error) {
    const code = error?.code;
    const unsupported =
      code === 'EINVAL' ||
      code === 'ENOTSUP' ||
      (process.platform === 'win32' &&
        ['EACCES', 'EISDIR', 'EPERM'].includes(code));
    if (unsupported) return 'unsupported';
    throw error;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

function requireLockAction(action, label) {
  if (typeof action !== 'string' || !/^[a-z][a-z-]{1,63}$/u.test(action)) {
    throw new Error(`${label} action is invalid.`);
  }
  return action;
}

export async function acquireSurfaceReleaseLock(surface, action, options = {}) {
  requireLockAction(action, 'Surface release lock');
  const evidenceRoot = candidateEvidenceRoot(options);
  await mkdir(evidenceRoot, { recursive: true });
  const lockPath = surfaceReleaseLockPath(surface, options);
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `The ${surface.id} Vercel project is already release-locked. Stale project locks are never removed automatically; confirm every prior process and provider-side outcome before manual recovery.`,
      );
    }
    throw error;
  }
  const lock = {
    schemaVersion: 1,
    surface: surface.id,
    projectId: surface.projectId,
    action,
    createdAt: new Date().toISOString(),
    lockPath,
    evidenceRoot,
    handle,
  };
  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          schemaVersion: lock.schemaVersion,
          surface: lock.surface,
          projectId: lock.projectId,
          action: lock.action,
          createdAt: lock.createdAt,
          processId: process.pid,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await handle.sync();
    await syncDirectoryEntry(evidenceRoot);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    await syncDirectoryEntry(evidenceRoot).catch(() => undefined);
    throw error;
  }
  activeSurfaceReleaseLocks.add(lock);
  return lock;
}

export async function releaseSurfaceReleaseLock(lock) {
  if (!activeSurfaceReleaseLocks.has(lock)) {
    throw new Error('Surface release lock is not active in this process.');
  }
  activeSurfaceReleaseLocks.delete(lock);
  await lock.handle.close();
  await rm(lock.lockPath, { force: true });
  await syncDirectoryEntry(lock.evidenceRoot);
}

export async function withSurfaceReleaseLock(
  surface,
  action,
  callback,
  options = {},
) {
  const lock = await acquireSurfaceReleaseLock(surface, action, options);
  try {
    return await callback(lock);
  } finally {
    await releaseSurfaceReleaseLock(lock);
  }
}

export async function acquireCandidateEvidenceLock(
  surface,
  deploymentId,
  action,
  options = {},
) {
  requireLockAction(action, 'Candidate evidence lock');
  const evidenceRoot = candidateEvidenceRoot(options);
  await mkdir(evidenceRoot, { recursive: true });
  const lockPath = candidateLockPath(surface, deploymentId, options);
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `Candidate ${deploymentId} is already locked. Stale locks are never removed automatically; confirm the prior process and external-action outcome before manual recovery.`,
      );
    }
    throw error;
  }
  const lock = {
    schemaVersion: 1,
    surface: surface.id,
    deploymentId,
    action,
    createdAt: new Date().toISOString(),
    lockPath,
    evidenceRoot,
    handle,
  };
  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          schemaVersion: lock.schemaVersion,
          surface: lock.surface,
          deploymentId: lock.deploymentId,
          action: lock.action,
          createdAt: lock.createdAt,
          processId: process.pid,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await handle.sync();
    await syncDirectoryEntry(evidenceRoot);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    await syncDirectoryEntry(evidenceRoot).catch(() => undefined);
    throw error;
  }
  activeCandidateEvidenceLocks.add(lock);
  return lock;
}

export async function releaseCandidateEvidenceLock(lock) {
  if (!activeCandidateEvidenceLocks.has(lock)) {
    throw new Error('Candidate evidence lock is not active in this process.');
  }
  activeCandidateEvidenceLocks.delete(lock);
  await lock.handle.close();
  await rm(lock.lockPath, { force: true });
  await syncDirectoryEntry(lock.evidenceRoot);
}

export async function withCandidateEvidenceLock(
  surface,
  deploymentId,
  action,
  callback,
  options = {},
) {
  const lock = await acquireCandidateEvidenceLock(
    surface,
    deploymentId,
    action,
    options,
  );
  try {
    return await callback(lock);
  } finally {
    await releaseCandidateEvidenceLock(lock);
  }
}

function assertCandidateEvidenceLock(surface, deploymentId, lock, options) {
  const evidenceRoot = candidateEvidenceRoot(options);
  if (
    !activeCandidateEvidenceLocks.has(lock) ||
    lock.surface !== surface.id ||
    lock.deploymentId !== deploymentId ||
    lock.evidenceRoot !== evidenceRoot ||
    lock.lockPath !== candidateLockPath(surface, deploymentId, options)
  ) {
    throw new Error(
      'Candidate evidence write requires the active exclusive lock for this deployment.',
    );
  }
}

async function writeDurableJson(target, value) {
  const directory = path.dirname(target);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, target);
    await syncDirectoryEntry(directory);
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeCandidateEvidence(
  surface,
  evidence,
  lock,
  options = {},
) {
  const evidenceRoot = candidateEvidenceRoot(options);
  await mkdir(evidenceRoot, { recursive: true });
  assertCandidateEvidenceLock(surface, evidence.deploymentId, lock, options);
  const target = candidateEvidencePath(surface, evidence.deploymentId, options);
  await writeDurableJson(target, evidence);
  return target;
}

export async function readCandidateEvidence(
  surface,
  deploymentId,
  options = {},
) {
  const evidencePath = candidateEvidencePath(surface, deploymentId, options);
  return {
    evidencePath,
    evidence: JSON.parse(await readFile(evidencePath, 'utf8')),
  };
}

export async function readCandidateEvidenceIfPresent(
  surface,
  deploymentId,
  options = {},
) {
  try {
    return await readCandidateEvidence(surface, deploymentId, options);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function removeCandidateEvidence(
  evidencePath,
  lock,
  options = {},
) {
  const evidenceRoot = candidateEvidenceRoot(options);
  assertCandidateEvidenceLock(
    { id: lock?.surface },
    lock?.deploymentId,
    lock,
    options,
  );
  const resolved = path.resolve(evidencePath);
  const expected = path.join(
    evidenceRoot,
    `${lock.surface}-${lock.deploymentId}.json`,
  );
  if (resolved !== expected) {
    throw new Error(
      'Refusing to remove evidence outside the release-candidates directory.',
    );
  }
  await rm(resolved, { force: true });
}

export async function assertRegularFile(filePath) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Expected a regular file: ${filePath}`);
  }
}
