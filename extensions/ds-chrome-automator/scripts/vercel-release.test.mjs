import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertCanonicalConfig,
  acquireCandidateEvidenceLock,
  acquireSurfaceReleaseLock,
  assertMigrationCandidateEvidence,
  assertSameMigrationBinding,
  assertSafeCleanup,
  buildCandidateDeployArguments,
  buildMigrationCronArguments,
  computeSourceDigest,
  createReleaseStage,
  digestJson,
  includeReleasePath,
  isSensitiveReleasePath,
  latestMigrationVersion,
  minimumLegacyProtocolDeployWindowMs,
  parseCandidateReadiness,
  parseCronRunOutput,
  parseCurlResponse,
  parseDeploymentOutput,
  readCandidateEvidence,
  releaseCandidateEvidenceLock,
  releaseSurfaceReleaseLock,
  removeReleaseStage,
  validateCandidateCronExposure,
  validateDeploymentInspection,
  validateHealthEvidence,
  validateLegacyProtocolSunset,
  validateMigrationAttemptEvidence,
  validateMigrationProjectState,
  validatePromotedApiProjectState,
  writeCandidateEvidence,
} from './lib/vercel-release.mjs';
import { vercelOrgId, vercelSurfaces } from './lib/vercel-surfaces.mjs';

function inspectionFixture(surface, overrides = {}) {
  const outputs = surface.expectedFunctions.map((functionPath) => ({
    type: 'lambda',
    path: functionPath,
    digest: `${surface.projectId}/fixture-digest`,
  }));
  return {
    id: 'dpl_QualifiedCandidate0001',
    name: surface.projectName,
    url: `${surface.projectName}-candidate-0001.vercel.app`,
    target: 'production',
    readyState: 'READY',
    aliases: [],
    builds: [
      {
        readyState: 'READY',
        config: {
          installCommand: surface.expectedConfig.installCommand,
          buildCommand: surface.expectedConfig.buildCommand,
          outputDirectory: surface.expectedConfig.outputDirectory,
          vercelConfig: {
            functions: surface.expectedConfig.functions,
            crons: surface.expectedConfig.crons,
            rewrites: surface.expectedConfig.rewrites,
            headers: surface.expectedConfig.headers,
          },
        },
        output: outputs,
      },
    ],
    ...overrides,
  };
}

function migrationProjectStateFixture(candidate, overrides = {}) {
  const surface = vercelSurfaces.api;
  return {
    id: surface.projectId,
    name: surface.projectName,
    accountId: vercelOrgId,
    crons: {
      deploymentId: candidate.id,
      disabledAt: null,
      definitions: [
        {
          host: candidate.url,
          path: '/v1/internal/migrations',
          schedule: '0 4 * * *',
        },
      ],
    },
    targets: {
      production: {
        id: 'dpl_PriorStable0001',
        name: surface.projectName,
        teamId: vercelOrgId,
        target: 'production',
        readyState: 'READY',
        url: 'paks-api-prior-stable.vercel.app',
        alias: ['paks-api.vercel.app'],
      },
    },
    ...overrides,
  };
}

function migrationIdentity() {
  return {
    gitCommit: 'a'.repeat(40),
    sourceDigest: 'b'.repeat(64),
    migrationVersion: '0005_guide_cms',
    configDigest: 'c'.repeat(64),
  };
}

function migrationCandidateEvidence(inspection, identity) {
  const surface = vercelSurfaces.api;
  const candidate = validateDeploymentInspection(surface, inspection);
  const binding = validateMigrationProjectState(
    surface,
    migrationProjectStateFixture(candidate),
    candidate,
  );
  return {
    schemaVersion: 1,
    surface: surface.id,
    deploymentId: inspection.id,
    deploymentUrl: inspection.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    ...identity,
    createdAt: '2026-08-20T00:00:00.000Z',
    validatedAt: '2026-08-20T00:01:00.000Z',
    qualifiedAt: null,
    cronExposure: {
      schemaVersion: 1,
      status: 'provider_bound',
      recordedAt: '2026-08-20T00:01:00.000Z',
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
    },
    migrationStartedAt: null,
    migratedAt: null,
    migrationResult: null,
    promotionStartedAt: null,
    promotionResult: null,
    promotedAt: null,
    promotionProjectState: null,
  };
}

test('canonical Vercel configs match the reviewed surface registry', async () => {
  await assert.doesNotReject(assertCanonicalConfig(vercelSurfaces.dashboard));
  await assert.doesNotReject(assertCanonicalConfig(vercelSurfaces.api));
});

test('release validation blocks a stale legacy-protocol sunset', () => {
  const now = Date.parse('2026-08-20T00:00:00.000Z');
  assert.equal(
    validateLegacyProtocolSunset(
      '2026-11-30T00:00:00.000Z',
      now,
      minimumLegacyProtocolDeployWindowMs,
    ),
    '2026-11-30T00:00:00.000Z',
  );
  assert.throws(
    () =>
      validateLegacyProtocolSunset(
        '2026-09-01T00:00:00.000Z',
        now,
        minimumLegacyProtocolDeployWindowMs,
      ),
    /at least 30 days/iu,
  );
});

test('dashboard release snapshots exclude the root API entrypoint', () => {
  assert.equal(
    includeReleasePath(vercelSurfaces.dashboard, 'api/index.ts'),
    false,
  );
  assert.equal(includeReleasePath(vercelSurfaces.api, 'api/index.ts'), true);
  assert.equal(
    includeReleasePath(
      vercelSurfaces.dashboard,
      'apps/faceless-automation-dashboard/src/main.tsx',
    ),
    true,
  );
  assert.equal(
    includeReleasePath(
      vercelSurfaces.dashboard,
      'apps/grok-automator/src/background.ts',
    ),
    false,
  );
  assert.equal(
    includeReleasePath(
      vercelSurfaces.dashboard,
      'apps/grok-automator/package.json',
    ),
    false,
  );
  assert.equal(
    includeReleasePath(vercelSurfaces.dashboard, '.build_plans/MASTER_PLAN.md'),
    false,
  );
  assert.equal(
    includeReleasePath(
      vercelSurfaces.api,
      'packages/platform-contracts/src/index.ts',
    ),
    true,
  );
  assert.equal(
    includeReleasePath(
      vercelSurfaces.api,
      'apps/faceless-automation-dashboard/src/main.tsx',
    ),
    false,
  );
});

test('candidate deployment uses the generated root config and PAKS metadata', () => {
  const args = buildCandidateDeployArguments(
    vercelSurfaces.api,
    'C:\\release-stage',
    {
      gitCommit: 'abc123',
      sourceDigest: 'def456',
    },
  );
  assert.equal(args.includes('--local-config'), false);
  assert.equal(args.includes('--skip-domain'), true);
  assert.equal(args.includes('paksSurface=api'), true);
  assert.equal(args.includes('facelessSurface=api'), false);
});

test('isolated dashboard staging copies only allowlisted inputs and creates vercel.json', async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'paks-release-fixture-'),
  );
  let stageRoot = null;
  try {
    const files = new Map([
      ['.nvmrc', '24\n'],
      ['package-lock.json', '{}\n'],
      ['package.json', '{}\n'],
      ['vercel.dashboard.json', '{"unexpected":true}\n'],
      ['.build_plans/MASTER_PLAN.md', 'not a deployment input\n'],
      ['api/index.ts', 'export default null;\n'],
      [
        'apps/faceless-automation-dashboard/package.json',
        '{"name":"dashboard"}\n',
      ],
      [
        'apps/faceless-automation-dashboard/src/main.tsx',
        'export const app = true;\n',
      ],
      ['apps/grok-automator/package.json', '{"name":"grok"}\n'],
      [
        'apps/grok-automator/src/background.ts',
        'export const background = true;\n',
      ],
      ['packages/brand/package.json', '{"name":"brand"}\n'],
      ['packages/brand/src/styles.css', ':root {}\n'],
    ]);
    for (const [relative, contents] of files) {
      const target = path.join(fixtureRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, 'utf8');
    }

    const secretPath = path.join(
      fixtureRoot,
      'apps/faceless-automation-dashboard/src/private.pem',
    );
    await writeFile(secretPath, 'not-a-real-key\n', 'utf8');
    await assert.rejects(
      computeSourceDigest(vercelSurfaces.dashboard, fixtureRoot),
      /sensitive credential\/key artifacts/iu,
    );
    await rm(secretPath);

    const digest = await computeSourceDigest(
      vercelSurfaces.dashboard,
      fixtureRoot,
    );
    stageRoot = await createReleaseStage(
      vercelSurfaces.dashboard,
      digest,
      fixtureRoot,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(stageRoot, 'vercel.json'), 'utf8')),
      vercelSurfaces.dashboard.expectedConfig,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(stageRoot, 'package.json'), 'utf8'))
        .workspaces,
      ['apps/faceless-automation-dashboard', 'packages/brand'],
    );
    await assert.doesNotReject(
      access(
        path.join(stageRoot, 'apps/faceless-automation-dashboard/src/main.tsx'),
      ),
    );
    for (const excluded of [
      'api/index.ts',
      '.build_plans/MASTER_PLAN.md',
      'apps/grok-automator/package.json',
      'apps/grok-automator/src/background.ts',
      'vercel.dashboard.json',
    ]) {
      await assert.rejects(access(path.join(stageRoot, excluded)), {
        code: 'ENOENT',
      });
    }
  } finally {
    if (stageRoot !== null) await removeReleaseStage(stageRoot);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('secret and private-key filenames are rejected from release inputs', () => {
  for (const candidate of [
    '.env.production',
    'credentials.json',
    'private-key.json',
    'certs/signing.p12',
  ]) {
    assert.equal(isSensitiveReleasePath(candidate), true);
    assert.equal(
      includeReleasePath(vercelSurfaces.dashboard, candidate),
      false,
    );
  }
  assert.equal(isSensitiveReleasePath('.env.example'), false);
});

test('deployment inspection enforces exact functions, rewrites and cron configuration', () => {
  assert.deepEqual(
    validateDeploymentInspection(
      vercelSurfaces.dashboard,
      inspectionFixture(vercelSurfaces.dashboard),
    ).functions,
    [],
  );
  assert.deepEqual(
    validateDeploymentInspection(
      vercelSurfaces.api,
      inspectionFixture(vercelSurfaces.api),
    ).functions,
    ['api/index'],
  );

  const badCron = inspectionFixture(vercelSurfaces.api);
  badCron.builds[0].config.vercelConfig.crons = [];
  assert.throws(
    () => validateDeploymentInspection(vercelSurfaces.api, badCron),
    /crons drifted/iu,
  );
});

test('API migration accepts only exact candidate evidence and current Vercel cron binding', () => {
  const surface = vercelSurfaces.api;
  const inspection = inspectionFixture(surface);
  const identity = migrationIdentity();
  const evidence = migrationCandidateEvidence(inspection, identity);
  const candidate = assertMigrationCandidateEvidence(
    surface,
    inspection,
    evidence,
    identity,
  );
  const binding = validateMigrationProjectState(
    surface,
    migrationProjectStateFixture(candidate),
    candidate,
  );
  assert.equal(
    validateCandidateCronExposure(surface, candidate, evidence, binding).status,
    'provider_bound',
  );
  assert.deepEqual(buildMigrationCronArguments(surface), [
    'crons',
    'run',
    '/v1/internal/migrations',
  ]);
  assert.equal(binding.cronDeploymentId, candidate.id);
  assert.equal(binding.cronHost, candidate.url);
  assert.equal(binding.productionDeploymentId, 'dpl_PriorStable0001');
  assert.throws(
    () => buildMigrationCronArguments(vercelSurfaces.dashboard),
    /only for the API surface/iu,
  );
  assert.throws(
    () =>
      assertMigrationCandidateEvidence(
        surface,
        inspection,
        { ...evidence, promotedAt: '2026-08-20T00:02:00.000Z' },
        identity,
      ),
    /promoted API candidate/iu,
  );
});

test('API migration rejects wrong cron binding, stable candidates, and ambiguous hosts', () => {
  const surface = vercelSurfaces.api;
  const candidate = validateDeploymentInspection(
    surface,
    inspectionFixture(surface),
  );

  const wrongBinding = migrationProjectStateFixture(candidate);
  wrongBinding.crons.deploymentId = 'dpl_DifferentCandidate0001';
  assert.throws(
    () => validateMigrationProjectState(surface, wrongBinding, candidate),
    /not bound to the requested candidate/iu,
  );

  const stableCandidate = migrationProjectStateFixture(candidate);
  stableCandidate.targets.production.id = candidate.id;
  assert.throws(
    () => validateMigrationProjectState(surface, stableCandidate, candidate),
    /already the stable production target/iu,
  );

  const ambiguousHost = migrationProjectStateFixture(candidate);
  ambiguousHost.crons.definitions.push({
    ...ambiguousHost.crons.definitions[0],
    host: 'paks-api-other-candidate.vercel.app',
  });
  assert.throws(
    () => validateMigrationProjectState(surface, ambiguousHost, candidate),
    /host is ambiguous/iu,
  );

  const wrongHost = migrationProjectStateFixture(candidate);
  wrongHost.crons.definitions[0].host = 'paks-api-other-candidate.vercel.app';
  assert.throws(
    () => validateMigrationProjectState(surface, wrongHost, candidate),
    /does not target the requested candidate host/iu,
  );
});

test('API migration pre/post binding and server invocation evidence fail closed', () => {
  const surface = vercelSurfaces.api;
  const candidate = validateDeploymentInspection(
    surface,
    inspectionFixture(surface),
  );
  const binding = validateMigrationProjectState(
    surface,
    migrationProjectStateFixture(candidate),
    candidate,
  );
  assert.doesNotThrow(() =>
    assertSameMigrationBinding(binding, structuredClone(binding)),
  );
  assert.throws(
    () =>
      assertSameMigrationBinding(binding, {
        ...binding,
        productionDeploymentId: 'dpl_ChangedStable0001',
      }),
    /changed the API cron or production binding/iu,
  );
  assert.deepEqual(
    parseCronRunOutput(
      'Cron job /v1/internal/migrations triggered [120ms]\n  Invocation time: 2026-08-20T00:02:00.000Z\n',
      '/v1/internal/migrations',
    ),
    {
      status: 'triggered',
      invocationAt: '2026-08-20T00:02:00.000Z',
    },
  );
  assert.throws(
    () =>
      parseCronRunOutput(
        'Cron job /v1/other triggered\n  Invocation time: 2026-08-20T00:02:00.000Z\n',
        '/v1/internal/migrations',
      ),
    /exact migration path and result/iu,
  );
  assert.equal(
    parseCandidateReadiness({
      status: 503,
      body: '{"status":"not_ready"}',
    }),
    'not_ready',
  );
  assert.equal(
    parseCandidateReadiness({ status: 200, body: '{"status":"ready"}' }),
    'ready',
  );
});

test('completed migration evidence is bound to source version and candidate-only readiness', () => {
  const surface = vercelSurfaces.api;
  const inspection = inspectionFixture(surface);
  const candidate = validateDeploymentInspection(surface, inspection);
  const identity = migrationIdentity();
  const binding = validateMigrationProjectState(
    surface,
    migrationProjectStateFixture(candidate),
    candidate,
  );
  const evidence = {
    ...migrationCandidateEvidence(inspection, identity),
    migrationStartedAt: '2026-08-20T00:01:30.000Z',
    migratedAt: '2026-08-20T00:02:30.000Z',
    migrationResult: {
      schemaVersion: 1,
      status: 'ready',
      command: 'vercel crons run /v1/internal/migrations',
      path: '/v1/internal/migrations',
      schedule: '0 4 * * *',
      deploymentId: candidate.id,
      deploymentUrl: candidate.url,
      projectId: surface.projectId,
      projectName: surface.projectName,
      orgId: vercelOrgId,
      migrationVersion: identity.migrationVersion,
      currentVersion: identity.migrationVersion,
      bindingDigest: digestJson(binding),
      productionDeploymentId: binding.productionDeploymentId,
      productionHost: binding.productionHost,
      invocationAt: '2026-08-20T00:02:00.000Z',
      readiness: {
        status: 'ready',
        attempts: 2,
        observedAt: '2026-08-20T00:02:20.000Z',
      },
    },
  };
  assert.equal(
    validateMigrationAttemptEvidence(surface, candidate, evidence, identity, {
      binding,
      requireReady: true,
    }).status,
    'ready',
  );
  assert.throws(
    () =>
      validateMigrationAttemptEvidence(
        surface,
        candidate,
        {
          ...evidence,
          migrationResult: {
            ...evidence.migrationResult,
            currentVersion: '0003_old',
          },
        },
        identity,
        { binding, requireReady: true },
      ),
    /currentVersion/iu,
  );
});

test('ambiguous migration start reconciles readiness without inventing invocation evidence', () => {
  const surface = vercelSurfaces.api;
  const inspection = inspectionFixture(surface);
  const candidate = validateDeploymentInspection(surface, inspection);
  const identity = migrationIdentity();
  const binding = validateMigrationProjectState(
    surface,
    migrationProjectStateFixture(candidate),
    candidate,
  );
  const starting = {
    ...migrationCandidateEvidence(inspection, identity),
    migrationStartedAt: '2026-08-20T00:01:30.000Z',
    migrationResult: {
      schemaVersion: 1,
      status: 'starting',
      command: 'vercel crons run /v1/internal/migrations',
      path: '/v1/internal/migrations',
      schedule: '0 4 * * *',
      deploymentId: candidate.id,
      deploymentUrl: candidate.url,
      projectId: surface.projectId,
      projectName: surface.projectName,
      orgId: vercelOrgId,
      migrationVersion: identity.migrationVersion,
      currentVersion: identity.migrationVersion,
      bindingDigest: digestJson(binding),
      productionDeploymentId: binding.productionDeploymentId,
      productionHost: binding.productionHost,
      invocationAt: null,
      readiness: null,
      recovery: null,
    },
  };
  assert.equal(
    validateMigrationAttemptEvidence(surface, candidate, starting, identity, {
      binding,
    }).status,
    'starting',
  );
  assert.throws(
    () =>
      validateMigrationAttemptEvidence(surface, candidate, starting, identity, {
        binding,
        requireReady: true,
      }),
    /reconciled without reinvoking/iu,
  );

  const recovered = {
    ...starting,
    migratedAt: '2026-08-20T00:03:00.000Z',
    migrationResult: {
      ...starting.migrationResult,
      status: 'ready',
      readiness: {
        status: 'ready',
        attempts: 3,
        observedAt: '2026-08-20T00:02:50.000Z',
      },
      recovery: {
        schemaVersion: 1,
        status: 'candidate_readiness_reconciled_without_reinvoke',
        observedAt: '2026-08-20T00:02:50.000Z',
        bindingDigest: digestJson(binding),
      },
    },
  };
  assert.equal(
    validateMigrationAttemptEvidence(surface, candidate, recovered, identity, {
      binding,
      requireReady: true,
    }).status,
    'ready',
  );
  assert.throws(
    () =>
      validateMigrationAttemptEvidence(
        surface,
        candidate,
        {
          ...recovered,
          migrationResult: {
            ...recovered.migrationResult,
            recovery: {
              ...recovered.migrationResult.recovery,
              bindingDigest: '0'.repeat(64),
            },
          },
        },
        identity,
        { binding, requireReady: true },
      ),
    /no-reinvoke reconciliation proof/iu,
  );
});

test('post-promotion API state requires both production and cron to bind the candidate', () => {
  const surface = vercelSurfaces.api;
  const candidate = validateDeploymentInspection(
    surface,
    inspectionFixture(surface),
  );
  const promotedState = migrationProjectStateFixture(candidate);
  promotedState.targets.production = {
    id: candidate.id,
    name: surface.projectName,
    teamId: vercelOrgId,
    target: 'production',
    readyState: 'READY',
    url: candidate.url,
    alias: ['paks-api.vercel.app'],
  };
  assert.equal(
    validatePromotedApiProjectState(surface, promotedState, candidate)
      .deploymentId,
    candidate.id,
  );

  const staleCron = structuredClone(promotedState);
  staleCron.crons.deploymentId = 'dpl_StaleCronDeployment0001';
  assert.throws(
    () => validatePromotedApiProjectState(surface, staleCron, candidate),
    /cron is not exclusively bound/iu,
  );

  const staleHost = structuredClone(promotedState);
  staleHost.crons.definitions[0].host = 'paks-api-stale-cron-host.vercel.app';
  assert.throws(
    () => validatePromotedApiProjectState(surface, staleHost, candidate),
    /cron path, schedule, or host is stale/iu,
  );
});

test('candidate evidence uses a cross-process fail-closed lock and atomic replacement', async () => {
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'paks-candidate-evidence-'),
  );
  const surface = vercelSurfaces.api;
  const deploymentId = 'dpl_LockCandidate0001';
  let lock = null;
  try {
    lock = await acquireCandidateEvidenceLock(
      surface,
      deploymentId,
      'test-parent',
      { evidenceRoot },
    );
    const libraryUrl = new URL('./lib/vercel-release.mjs', import.meta.url)
      .href;
    const childScript = `
      import { acquireCandidateEvidenceLock } from ${JSON.stringify(libraryUrl)};
      try {
        await acquireCandidateEvidenceLock(
          { id: 'api' },
          process.argv[2],
          'test-child',
          { evidenceRoot: process.argv[1] },
        );
        process.exitCode = 0;
      } catch (error) {
        process.stderr.write(error instanceof Error ? error.message : String(error));
        process.exitCode = 17;
      }
    `;
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        childScript,
        evidenceRoot,
        deploymentId,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(child.status, 17);
    assert.match(child.stderr, /already locked/iu);
    assert.match(child.stderr, /never removed automatically/iu);

    await assert.rejects(
      writeCandidateEvidence(surface, { deploymentId, revision: 0 }, null, {
        evidenceRoot,
      }),
      /active exclusive lock/iu,
    );
    const evidencePath = await writeCandidateEvidence(
      surface,
      { deploymentId, revision: 1 },
      lock,
      { evidenceRoot },
    );
    assert.equal(
      (await readCandidateEvidence(surface, deploymentId, { evidenceRoot }))
        .evidence.revision,
      1,
    );

    const simulatedCrashTemp = path.join(
      evidenceRoot,
      `.${path.basename(evidencePath)}.999999.crash.tmp`,
    );
    await writeFile(simulatedCrashTemp, '{"partial":', 'utf8');
    assert.equal(
      (await readCandidateEvidence(surface, deploymentId, { evidenceRoot }))
        .evidence.revision,
      1,
    );
    assert.equal(
      (await readdir(evidenceRoot)).includes(path.basename(simulatedCrashTemp)),
      true,
    );

    await writeCandidateEvidence(surface, { deploymentId, revision: 2 }, lock, {
      evidenceRoot,
    });
    assert.equal(
      (await readCandidateEvidence(surface, deploymentId, { evidenceRoot }))
        .evidence.revision,
      2,
    );

    await releaseCandidateEvidenceLock(lock);
    lock = null;
    const staleLockPath = path.join(evidenceRoot, `api-${deploymentId}.lock`);
    await writeFile(staleLockPath, '{"stale":true}\n', 'utf8');
    await assert.rejects(
      acquireCandidateEvidenceLock(surface, deploymentId, 'test-recovery', {
        evidenceRoot,
      }),
      /Stale locks are never removed automatically/iu,
    );
    await assert.doesNotReject(access(staleLockPath));
  } finally {
    if (lock !== null) await releaseCandidateEvidenceLock(lock);
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test('surface release lock serializes different candidates in the same Vercel project', async () => {
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'paks-surface-release-lock-'),
  );
  const surface = vercelSurfaces.api;
  let lock = null;
  try {
    lock = await acquireSurfaceReleaseLock(surface, 'candidate', {
      evidenceRoot,
    });
    const libraryUrl = new URL('./lib/vercel-release.mjs', import.meta.url)
      .href;
    const childScript = `
      import { acquireSurfaceReleaseLock } from ${JSON.stringify(libraryUrl)};
      try {
        await acquireSurfaceReleaseLock(
          {
            id: 'api',
            projectId: ${JSON.stringify(surface.projectId)},
          },
          'promote',
          { evidenceRoot: process.argv[1] },
        );
        process.exitCode = 0;
      } catch (error) {
        process.stderr.write(error instanceof Error ? error.message : String(error));
        process.exitCode = 19;
      }
    `;
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', childScript, evidenceRoot],
      { encoding: 'utf8' },
    );
    assert.equal(child.status, 19);
    assert.match(child.stderr, /project is already release-locked/iu);
    assert.match(child.stderr, /never removed automatically/iu);

    await releaseSurfaceReleaseLock(lock);
    lock = null;
    const staleLockPath = path.join(
      evidenceRoot,
      `api-${surface.projectId}.release.lock`,
    );
    await writeFile(staleLockPath, '{"stale":true}\n', 'utf8');
    await assert.rejects(
      acquireSurfaceReleaseLock(surface, 'migrate', { evidenceRoot }),
      /Stale project locks are never removed automatically/iu,
    );
    await assert.doesNotReject(access(staleLockPath));
  } finally {
    if (lock !== null) await releaseSurfaceReleaseLock(lock);
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test('dashboard inspection rejects an accidentally bundled root API function', () => {
  const inspection = inspectionFixture(vercelSurfaces.dashboard);
  inspection.builds[0].output.push({
    type: 'lambda',
    path: 'api/index',
    digest: `${vercelSurfaces.dashboard.projectId}/unintended-api`,
  });
  assert.throws(
    () => validateDeploymentInspection(vercelSurfaces.dashboard, inspection),
    /function inventory/iu,
  );
});

test('cleanup requires exact unpromoted candidate evidence and refuses rollback targets', () => {
  const surface = vercelSurfaces.dashboard;
  const inspection = inspectionFixture(surface);
  const identity = {
    gitCommit: 'a'.repeat(40),
    sourceDigest: 'b'.repeat(64),
    migrationVersion: '0005_guide_cms',
    configDigest: 'c'.repeat(64),
  };
  const evidence = {
    schemaVersion: 1,
    surface: surface.id,
    deploymentId: inspection.id,
    deploymentUrl: inspection.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: 'team_8bOGJgNqmfKYV3jeay0uq8OO',
    ...identity,
    createdAt: '2026-08-20T00:00:00.000Z',
    validatedAt: null,
    qualifiedAt: null,
    cronExposure: null,
    migrationStartedAt: null,
    migratedAt: null,
    migrationResult: null,
    promotionStartedAt: null,
    promotionResult: null,
    promotedAt: null,
    promotionProjectState: null,
  };
  const stable = {
    ...inspection,
    id: 'dpl_OtherStable0001',
    aliases: ['paks-tools.vercel.app'],
  };
  assert.throws(
    () =>
      assertSafeCleanup(surface, inspection, inspection, evidence, identity),
    /stable alias/iu,
  );
  assert.throws(
    () =>
      assertSafeCleanup(
        surface,
        {
          ...inspection,
          aliases: ['paks-tools.vercel.app'],
        },
        stable,
        evidence,
        identity,
      ),
    /unaliased/iu,
  );
  assert.throws(
    () => assertSafeCleanup(surface, inspection, stable, null, identity),
    /requires local evidence/iu,
  );
  assert.throws(
    () =>
      assertSafeCleanup(
        surface,
        inspection,
        stable,
        { ...evidence, promotedAt: '2026-08-20T00:05:00.000Z' },
        identity,
      ),
    /promoted/iu,
  );
  assert.throws(
    () =>
      assertSafeCleanup(
        surface,
        inspection,
        stable,
        { ...evidence, sourceDigest: 'd'.repeat(64) },
        identity,
      ),
    /sourceDigest/iu,
  );
  assert.throws(
    () =>
      assertSafeCleanup(
        surface,
        inspection,
        stable,
        {
          ...evidence,
          migrationStartedAt: '2026-08-20T00:02:00.000Z',
        },
        identity,
      ),
    /cannot roll back the shared database mutation/iu,
  );
  assert.throws(
    () =>
      assertSafeCleanup(
        surface,
        inspection,
        stable,
        {
          ...evidence,
          promotionStartedAt: '2026-08-20T00:03:00.000Z',
          promotionResult: { status: 'starting' },
        },
        identity,
      ),
    /provider-side outcome may be ambiguous/iu,
  );
  assert.doesNotThrow(() =>
    assertSafeCleanup(surface, inspection, stable, evidence, identity),
  );
});

test('API cleanup refuses scheduled cron exposure even before explicit migration', () => {
  const surface = vercelSurfaces.api;
  const inspection = inspectionFixture(surface);
  const identity = migrationIdentity();
  const evidence = migrationCandidateEvidence(inspection, identity);
  const stable = {
    ...inspection,
    id: 'dpl_OtherStable0001',
    aliases: ['paks-api.vercel.app'],
  };
  assert.equal(evidence.migrationStartedAt, null);
  assert.equal(evidence.migrationResult, null);
  assert.equal(evidence.cronExposure.status, 'provider_bound');
  assert.throws(
    () => assertSafeCleanup(surface, inspection, stable, evidence, identity),
    /provider cron before explicit migration/iu,
  );
  assert.throws(
    () =>
      assertSafeCleanup(
        surface,
        inspection,
        stable,
        {
          ...evidence,
          cronExposure: {
            schemaVersion: 1,
            status: 'potential',
            recordedAt: '2026-08-20T00:00:00.000Z',
          },
        },
        identity,
      ),
    /provider cron before explicit migration/iu,
  );
});

test('Vercel JSON and health parsers fail closed', () => {
  assert.equal(
    parseDeploymentOutput(
      JSON.stringify({ id: 'dpl_Candidate0001', url: 'candidate.vercel.app' }),
    ).id,
    'dpl_Candidate0001',
  );
  assert.throws(() => parseDeploymentOutput('{}'), /deployment identity/iu);
  assert.deepEqual(parseCurlResponse('{"status":"live"}\n200\n'), {
    status: 200,
    body: '{"status":"live"}',
  });
  assert.deepEqual(
    validateHealthEvidence(
      { status: 200, body: '{"status":"live"}' },
      { status: 200, body: '{"status":"ready"}' },
    ),
    { live: 'live', ready: 'ready' },
  );
  assert.throws(
    () =>
      validateHealthEvidence(
        { status: 200, body: '{"status":"live"}' },
        { status: 503, body: '{"status":"not_ready"}' },
      ),
    /readiness returned HTTP 503/iu,
  );
});

test('latest migration version is derived from the canonical SQL set', async () => {
  assert.match(await latestMigrationVersion(), /^\d{4}_[a-z0-9_]+$/u);
});
