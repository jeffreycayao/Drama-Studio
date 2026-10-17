import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  assertMigrationCandidateEvidence,
  assertSameMigrationBinding,
  assertSafeCleanup,
  buildMigrationCronArguments,
  buildCandidateDeployArguments,
  computeSourceDigest,
  createProjectContext,
  createReleaseStage,
  digestJson,
  latestMigrationVersion,
  parseCandidateReadiness,
  parseCronRunOutput,
  parseCurlResponse,
  parseDeploymentOutput,
  readCandidateEvidence,
  removeCandidateEvidence,
  removeReleaseStage,
  validateCandidateCronExposure,
  validateDeploymentInspection,
  validateHealthEvidence,
  validateMigrationAttemptEvidence,
  validateMigrationProjectState,
  validatePromotedApiProjectState,
  verifyCanonicalConfigs,
  withCandidateEvidenceLock,
  withSurfaceReleaseLock,
  writeCandidateEvidence,
} from './lib/vercel-release.mjs';
import {
  getVercelSurface,
  repositoryRoot,
  vercelCliVersion,
  vercelOrgId,
} from './lib/vercel-surfaces.mjs';

function usage() {
  return `Usage:
  node scripts/vercel-release.mjs plan --surface dashboard|api
  node scripts/vercel-release.mjs candidate --surface dashboard|api --execute
  node scripts/vercel-release.mjs migrate --surface api --deployment dpl_... --execute
  node scripts/vercel-release.mjs qualify --surface dashboard|api --deployment dpl_... --execute
  node scripts/vercel-release.mjs promote --surface dashboard|api --deployment dpl_... --execute
  node scripts/vercel-release.mjs cleanup --surface dashboard --deployment dpl_... --execute

All Vercel/network/mutation commands require --execute. Candidate deployment always uses
--target production --skip-domain from an allowlisted snapshot with generated root vercel.json.
Promotion requires matching local qualification evidence and never performs a direct production
  deploy. API migration runs before qualification, uses the server-side migration cron without
  downloading its secret, and requires exact candidate cron binding before and after invocation.
  Release actions sharing one checkout/evidence directory use a per-surface exclusive lock;
  this is not a distributed lock across hosts or clones. Candidate evidence uses an additional
  per-deployment lock, and fsynced temporary files are atomically replaced. Existing or stale
  locks fail closed for manual outcome review. API candidates are never cleanup targets because
  the provider cron may run before explicit migrate. Dashboard cleanup requires exact local
  evidence and refuses aliases, promotion attempts, evidence drift, and the stable deployment.\n`;
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { execute: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--execute') {
      options.execute = true;
      continue;
    }
    if (token === '--surface' || token === '--deployment') {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`);
      }
      options[token.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${token}.`);
  }
  return { command, options };
}

function requireExecute(options) {
  if (!options.execute) {
    throw new Error(
      'Refusing external release action without the explicit --execute flag.',
    );
  }
}

function requireDeploymentId(value) {
  if (typeof value !== 'string' || !/^dpl_[A-Za-z0-9]+$/u.test(value)) {
    throw new Error('--deployment must be an exact dpl_ deployment ID.');
  }
  return value;
}

const vercelExecutable =
  process.env.VERCEL_CLI_PATH ??
  (process.platform === 'win32' ? 'vercel.cmd' : 'vercel');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: false,
    stdio: options.capture === false ? 'inherit' : 'pipe',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${args[0] ?? ''} failed with exit ${result.status}: ${(result.stderr ?? '').trim()}`,
    );
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runVercel(args, contextRoot) {
  const separator = args.indexOf('--');
  const globalOptions = [
    '--scope',
    vercelOrgId,
    '--non-interactive',
    '--no-color',
  ];
  const invocation =
    separator < 0
      ? [...args, ...globalOptions]
      : [
          ...args.slice(0, separator),
          ...globalOptions,
          '--',
          ...args.slice(separator + 1),
        ];
  return run(vercelExecutable, invocation, { cwd: contextRoot });
}

function verifyCli() {
  const version = run(vercelExecutable, ['--version']).stdout.trim();
  if (!version.endsWith(vercelCliVersion)) {
    throw new Error(
      `Vercel CLI ${vercelCliVersion} is required; received ${JSON.stringify(version)}.`,
    );
  }
}

function gitCommit() {
  return run('git', ['rev-parse', 'HEAD']).stdout.trim();
}

async function withProjectContext(surface, callback) {
  const contextRoot = await createProjectContext(surface);
  try {
    return await callback(contextRoot);
  } finally {
    await removeReleaseStage(contextRoot);
  }
}

async function inspect(surface, deploymentId) {
  return withProjectContext(surface, (contextRoot) => {
    const result = runVercel(
      ['inspect', deploymentId, '--format=json'],
      contextRoot,
    );
    return JSON.parse(result.stdout);
  });
}

async function curlDeployment(surface, deploymentId, requestPath) {
  return withProjectContext(surface, (contextRoot) => {
    const result = runVercel(
      [
        'curl',
        requestPath,
        '--deployment',
        deploymentId,
        '--yes',
        '--',
        '--silent',
        '--show-error',
        '--write-out',
        '\\n%{http_code}',
      ],
      contextRoot,
    );
    return parseCurlResponse(result.stdout);
  });
}

async function qualifyHealth(surface, deploymentId) {
  const [live, ready] = await Promise.all([
    curlDeployment(surface, deploymentId, '/health/live'),
    curlDeployment(surface, deploymentId, '/health/ready'),
  ]);
  return validateHealthEvidence(live, ready);
}

async function queryProjectState(surface) {
  return withProjectContext(surface, (contextRoot) => {
    const result = runVercel(
      ['api', `/v9/projects/${surface.projectId}`, '--raw'],
      contextRoot,
    );
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(
        'Vercel returned invalid JSON for the API project state.',
      );
    }
  });
}

async function readMigrationBinding(surface, candidate) {
  return validateMigrationProjectState(
    surface,
    await queryProjectState(surface),
    candidate,
  );
}

function providerCronExposure(surface, candidate, binding) {
  return {
    schemaVersion: 1,
    status: 'provider_bound',
    recordedAt: new Date().toISOString(),
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
}

async function pollCandidateReadiness(surface, deploymentId) {
  const maximumAttempts = 15;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const response = await curlDeployment(
      surface,
      deploymentId,
      '/health/ready',
    );
    if (parseCandidateReadiness(response) === 'ready') {
      return {
        status: 'ready',
        attempts: attempt,
        observedAt: new Date().toISOString(),
      };
    }
    if (attempt < maximumAttempts) await delay(2_000);
  }
  throw new Error(
    'The exact API candidate remained not_ready after the migration readiness poll.',
  );
}

async function pollPromotionConvergence(surface, candidate) {
  const maximumAttempts = 15;
  let lastError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const stableInspection = await inspect(surface, surface.stableOrigin);
      if (
        stableInspection.id !== candidate.id ||
        stableInspection.readyState !== 'READY'
      ) {
        throw new Error(
          'The canonical stable origin has not converged on the candidate.',
        );
      }
      const promoted = validateDeploymentInspection(surface, stableInspection, {
        requireUnaliased: false,
      });
      if (promoted.id !== candidate.id || promoted.url !== candidate.url) {
        throw new Error(
          'The canonical stable origin resolved an ambiguous candidate identity.',
        );
      }
      const promotionProjectState =
        surface.id === 'api'
          ? validatePromotedApiProjectState(
              surface,
              await queryProjectState(surface),
              promoted,
            )
          : null;
      return {
        promoted,
        promotionProjectState,
        observedAt: new Date().toISOString(),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts) await delay(2_000);
    }
  }
  throw new Error(
    `Promotion did not converge on the exact production and cron binding after ${maximumAttempts} checks: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  );
}

function promotionStartingResult(surface, candidate, stable, startedAt) {
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(stable.id ?? '') ||
    stable.id === candidate.id
  ) {
    throw new Error(
      'Promotion requires a distinct exact prior stable deployment.',
    );
  }
  return {
    schemaVersion: 1,
    status: 'starting',
    deploymentId: candidate.id,
    deploymentUrl: candidate.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    stableOrigin: surface.stableOrigin,
    priorProductionDeploymentId: stable.id,
    startedAt,
    invocationCompletedAt: null,
    observedAt: null,
    attempts: null,
    recovery: null,
  };
}

function validatePromotionStartingResult(surface, candidate, evidence) {
  const result = evidence?.promotionResult;
  const expected = {
    schemaVersion: 1,
    status: 'starting',
    deploymentId: candidate.id,
    deploymentUrl: candidate.url,
    projectId: surface.projectId,
    projectName: surface.projectName,
    orgId: vercelOrgId,
    stableOrigin: surface.stableOrigin,
    startedAt: evidence?.promotionStartedAt,
    invocationCompletedAt: null,
    observedAt: null,
    attempts: null,
    recovery: null,
  };
  if (result === null || typeof result !== 'object') {
    throw new Error('Promotion recovery is missing its durable intent marker.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) {
      throw new Error(
        `Promotion recovery marker ${key} is not bound to this candidate.`,
      );
    }
  }
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(result.priorProductionDeploymentId ?? '') ||
    result.priorProductionDeploymentId === candidate.id ||
    !Number.isFinite(Date.parse(result.startedAt)) ||
    new Date(Date.parse(result.startedAt)).toISOString() !== result.startedAt
  ) {
    throw new Error('Promotion recovery marker is internally invalid.');
  }
  return result;
}

async function removeRemoteCandidate(
  surface,
  deploymentId,
  candidateEvidence,
  identity,
  evidenceLock,
) {
  const candidate = await inspect(surface, deploymentId);
  if (candidate.id !== deploymentId) {
    throw new Error('Vercel inspection returned a different deployment ID.');
  }
  const stable = await inspect(surface, surface.stableOrigin);
  assertSafeCleanup(
    surface,
    candidate,
    stable,
    candidateEvidence.evidence,
    identity,
  );
  await withProjectContext(surface, (contextRoot) =>
    runVercel(['remove', deploymentId, '--safe', '--yes'], contextRoot),
  );
  await removeCandidateEvidence(candidateEvidence.evidencePath, evidenceLock);
}

async function currentReleaseIdentity(surface) {
  const [sourceDigest, migrationVersion] = await Promise.all([
    computeSourceDigest(surface),
    latestMigrationVersion(),
  ]);
  return {
    gitCommit: gitCommit(),
    sourceDigest,
    migrationVersion,
    configDigest: digestJson(surface.expectedConfig),
  };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === undefined || command === 'help' || command === '--help') {
    process.stdout.write(usage());
    return;
  }
  const surface = getVercelSurface(options.surface);
  await verifyCanonicalConfigs();

  if (command === 'migrate' && surface.id !== 'api') {
    throw new Error('The migrate command is available only for --surface api.');
  }

  if (command === 'plan') {
    const identity = await currentReleaseIdentity(surface);
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'verification-only',
          surface: surface.id,
          orgId: vercelOrgId,
          projectId: surface.projectId,
          projectName: surface.projectName,
          canonicalConfig: surface.canonicalConfig,
          stagedConfig: 'vercel.json',
          snapshotPolicy: 'surface-specific-allowlist',
          lockScope:
            'cross-process within one shared checkout/evidence directory; not distributed across hosts or clones',
          providerQualificationAssumptions:
            surface.id === 'api'
              ? [
                  'an authorized --target production --skip-domain candidate must expose crons.deploymentId/host=candidate while targets.production remains the distinct prior stable deployment; this provider state is not yet live-qualified and fails closed if absent',
                ]
              : [],
          expectedFunctions: surface.expectedFunctions,
          expectedCrons: surface.expectedConfig.crons ?? [],
          releaseSequence:
            surface.id === 'api'
              ? [
                  `npm run release:vercel -- candidate --surface api --execute`,
                  `npm run release:vercel -- migrate --surface api --deployment dpl_EXACT --execute`,
                  `npm run release:vercel -- qualify --surface api --deployment dpl_EXACT --execute`,
                  `npm run release:vercel -- promote --surface api --deployment dpl_EXACT --execute`,
                ]
              : [
                  `npm run release:vercel -- candidate --surface dashboard --execute`,
                  `npm run release:vercel -- qualify --surface dashboard --deployment dpl_EXACT --execute`,
                  `npm run release:vercel -- promote --surface dashboard --deployment dpl_EXACT --execute`,
                ],
          promotionRequires: [
            'production-target candidate created with --skip-domain',
            'exact function, rewrite, header and cron inspection',
            ...(surface.id === 'api'
              ? [
                  'server-side migration cron bound only to the unaliased candidate while stable remains on the prior deployment',
                  'migration invocation evidence and candidate-only readiness after pre/post binding checks',
                  'post-promotion project state binds both targets.production and the canonical cron to the candidate',
                  'checkout-local per-surface release lock and crash-safe no-reinvoke recovery evidence',
                ]
              : []),
            'candidate /health/live and fail-closed /health/ready both return 200',
            'unchanged source, config, migration set and Git commit',
          ],
          identity,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  requireExecute(options);
  verifyCli();

  if (command === 'candidate') {
    await withSurfaceReleaseLock(surface, 'candidate', async () => {
      const identity = await currentReleaseIdentity(surface);
      const stageRoot = await createReleaseStage(
        surface,
        identity.sourceDigest,
      );
      let candidate = null;
      let evidencePath = null;
      const createdAt = new Date().toISOString();
      try {
        const result = runVercel(
          buildCandidateDeployArguments(surface, stageRoot, identity),
          stageRoot,
        );
        const deployed = parseDeploymentOutput(result.stdout);
        await withCandidateEvidenceLock(
          surface,
          deployed.id,
          'candidate-validation',
          async (evidenceLock) => {
            const initialEvidence = {
              schemaVersion: 1,
              surface: surface.id,
              deploymentId: deployed.id,
              deploymentUrl: deployed.url,
              projectId: surface.projectId,
              projectName: surface.projectName,
              orgId: vercelOrgId,
              ...identity,
              createdAt,
              validatedAt: null,
              qualifiedAt: null,
              cronExposure:
                surface.id === 'api'
                  ? {
                      schemaVersion: 1,
                      status: 'potential',
                      recordedAt: createdAt,
                      deploymentId: deployed.id,
                      deploymentUrl: deployed.url,
                    }
                  : null,
              migrationStartedAt: null,
              migratedAt: null,
              migrationResult: null,
              promotionStartedAt: null,
              promotionResult: null,
              promotedAt: null,
              promotionProjectState: null,
            };
            evidencePath = await writeCandidateEvidence(
              surface,
              initialEvidence,
              evidenceLock,
            );
            try {
              const inspection = await inspect(surface, deployed.id);
              candidate = validateDeploymentInspection(surface, inspection, {
                requireUnaliased: true,
              });
              const validatedAt = new Date().toISOString();
              const validatedEvidence = {
                ...initialEvidence,
                deploymentUrl: candidate.url,
                validatedAt,
                cronExposure:
                  surface.id === 'api'
                    ? {
                        schemaVersion: 1,
                        status: 'potential',
                        recordedAt: validatedAt,
                        deploymentId: candidate.id,
                        deploymentUrl: candidate.url,
                      }
                    : null,
              };
              await writeCandidateEvidence(
                surface,
                validatedEvidence,
                evidenceLock,
              );
              if (surface.id === 'api') {
                const binding = await readMigrationBinding(surface, candidate);
                await writeCandidateEvidence(
                  surface,
                  {
                    ...validatedEvidence,
                    cronExposure: providerCronExposure(
                      surface,
                      candidate,
                      binding,
                    ),
                  },
                  evidenceLock,
                );
              }
            } catch (error) {
              if (surface.id === 'api') {
                throw new Error(
                  `API candidate ${deployed.id} failed validation and was retained because provider cron exposure cannot be ruled out: ${error instanceof Error ? error.message : String(error)}`,
                  { cause: error },
                );
              }
              try {
                const candidateEvidence = await readCandidateEvidence(
                  surface,
                  deployed.id,
                );
                await removeRemoteCandidate(
                  surface,
                  deployed.id,
                  candidateEvidence,
                  identity,
                  evidenceLock,
                );
              } catch (cleanupError) {
                throw new AggregateError(
                  [error, cleanupError],
                  `Candidate ${deployed.id} failed validation and automatic safe cleanup also failed.${evidencePath === null ? '' : ` Retained evidence: ${evidencePath}`}`,
                );
              }
              throw new Error(
                `Candidate ${deployed.id} failed validation and was safely removed: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
            }
          },
        );
      } finally {
        await removeReleaseStage(stageRoot);
      }
      process.stdout.write(
        `Created unaliased ${surface.id} candidate ${candidate.id}. Evidence: ${evidencePath}\n${surface.id === 'api' ? 'Run migrate, then qualify, before promotion.' : 'Run qualify before promotion.'}\n`,
      );
    });
    return;
  }

  const deploymentId = requireDeploymentId(options.deployment);
  await withSurfaceReleaseLock(surface, command, async () => {
    await withCandidateEvidenceLock(
      surface,
      deploymentId,
      command,
      async (evidenceLock) => {
        const candidateEvidence = await readCandidateEvidence(
          surface,
          deploymentId,
        );

        if (command === 'cleanup') {
          const identity = await currentReleaseIdentity(surface);
          await removeRemoteCandidate(
            surface,
            deploymentId,
            candidateEvidence,
            identity,
            evidenceLock,
          );
          process.stdout.write(
            `Safely removed unaliased candidate ${deploymentId}.\n`,
          );
          return;
        }

        let { evidence } = candidateEvidence;
        const inspection = await inspect(surface, deploymentId);

        const identity = await currentReleaseIdentity(surface);
        for (const key of [
          'gitCommit',
          'sourceDigest',
          'migrationVersion',
          'configDigest',
        ]) {
          if (evidence[key] !== identity[key]) {
            throw new Error(
              `Candidate ${key} no longer matches the current reviewed source.`,
            );
          }
        }

        if (command === 'migrate') {
          const candidate = assertMigrationCandidateEvidence(
            surface,
            inspection,
            evidence,
            identity,
            { allowPotentialCronExposure: true },
          );
          const precheck = await readMigrationBinding(surface, candidate);
          if (evidence.cronExposure.status === 'potential') {
            evidence = {
              ...evidence,
              cronExposure: providerCronExposure(surface, candidate, precheck),
            };
            await writeCandidateEvidence(surface, evidence, evidenceLock);
          } else {
            validateCandidateCronExposure(
              surface,
              candidate,
              evidence,
              precheck,
            );
          }
          let migrationStartedAt = evidence.migrationStartedAt;
          let migrationResult = evidence.migrationResult;

          if (migrationResult === null) {
            if (
              evidence.migrationStartedAt !== null ||
              evidence.migratedAt !== null
            ) {
              throw new Error(
                'API migration evidence is internally inconsistent.',
              );
            }
            migrationStartedAt = new Date().toISOString();
            const cronArguments = buildMigrationCronArguments(surface);
            const startingResult = {
              schemaVersion: 1,
              status: 'starting',
              command: `vercel crons run ${precheck.cronPath}`,
              path: precheck.cronPath,
              schedule: precheck.cronSchedule,
              deploymentId: candidate.id,
              deploymentUrl: candidate.url,
              projectId: surface.projectId,
              projectName: surface.projectName,
              orgId: vercelOrgId,
              migrationVersion: identity.migrationVersion,
              currentVersion: identity.migrationVersion,
              bindingDigest: digestJson(precheck),
              productionDeploymentId: precheck.productionDeploymentId,
              productionHost: precheck.productionHost,
              invocationAt: null,
              readiness: null,
              recovery: null,
            };
            await writeCandidateEvidence(
              surface,
              {
                ...evidence,
                migrationStartedAt,
                migratedAt: null,
                migrationResult: startingResult,
              },
              evidenceLock,
            );
            const invocationInspection = await inspect(surface, deploymentId);
            const invocationCandidate = validateDeploymentInspection(
              surface,
              invocationInspection,
              { requireUnaliased: true },
            );
            if (
              invocationCandidate.id !== candidate.id ||
              invocationCandidate.url !== candidate.url
            ) {
              throw new Error(
                'The API candidate identity changed immediately before migration invocation.',
              );
            }
            const invocationPrecheck = await readMigrationBinding(
              surface,
              candidate,
            );
            assertSameMigrationBinding(precheck, invocationPrecheck);
            const cronOutput = await withProjectContext(
              surface,
              (contextRoot) => runVercel(cronArguments, contextRoot),
            );
            const invocation = parseCronRunOutput(
              cronOutput.stdout,
              precheck.cronPath,
            );
            migrationResult = {
              ...startingResult,
              status: invocation.status,
              invocationAt: invocation.invocationAt,
            };
            await writeCandidateEvidence(
              surface,
              {
                ...evidence,
                migrationStartedAt,
                migratedAt: null,
                migrationResult,
              },
              evidenceLock,
            );
            const immediatePostcheck = await readMigrationBinding(
              surface,
              candidate,
            );
            assertSameMigrationBinding(precheck, immediatePostcheck);
          } else if (migrationResult.status === 'starting') {
            validateMigrationAttemptEvidence(
              surface,
              candidate,
              evidence,
              identity,
              { binding: precheck },
            );
          } else if (migrationResult.status === 'ready') {
            validateMigrationAttemptEvidence(
              surface,
              candidate,
              evidence,
              identity,
              {
                binding: precheck,
                requireReady: true,
              },
            );
            throw new Error(
              'This API candidate already has completed migration evidence.',
            );
          } else {
            validateMigrationAttemptEvidence(
              surface,
              candidate,
              evidence,
              identity,
              {
                binding: precheck,
              },
            );
          }

          const readiness = await pollCandidateReadiness(surface, deploymentId);
          const finalInspection = await inspect(surface, deploymentId);
          const finalCandidate = validateDeploymentInspection(
            surface,
            finalInspection,
            { requireUnaliased: true },
          );
          if (
            finalCandidate.id !== candidate.id ||
            finalCandidate.url !== candidate.url
          ) {
            throw new Error(
              'The API candidate identity changed during migration readiness polling.',
            );
          }
          const finalPostcheck = await readMigrationBinding(surface, candidate);
          assertSameMigrationBinding(precheck, finalPostcheck);
          const migratedAt = new Date().toISOString();
          const recoveredFromStarting = migrationResult.status === 'starting';
          const completedResult = {
            ...migrationResult,
            status: 'ready',
            readiness,
            recovery: recoveredFromStarting
              ? {
                  schemaVersion: 1,
                  status: 'candidate_readiness_reconciled_without_reinvoke',
                  observedAt: readiness.observedAt,
                  bindingDigest: digestJson(finalPostcheck),
                }
              : null,
          };
          await writeCandidateEvidence(
            surface,
            {
              ...evidence,
              migrationStartedAt,
              migratedAt,
              migrationResult: completedResult,
            },
            evidenceLock,
          );
          process.stdout.write(
            `${recoveredFromStarting ? 'Recovered' : 'Migrated'} API candidate ${deploymentId} through ${identity.migrationVersion}; exact cron binding remained unchanged and candidate-only readiness is proven${recoveredFromStarting ? ' without reinvoking the cron' : ''}.\n`,
          );
          return;
        }

        if (command === 'qualify') {
          const deployment = validateDeploymentInspection(surface, inspection, {
            requireUnaliased: true,
          });
          if (surface.id === 'api') {
            validateMigrationAttemptEvidence(
              surface,
              deployment,
              evidence,
              identity,
              { requireReady: true },
            );
          }
          const health = await qualifyHealth(surface, deploymentId);
          await writeCandidateEvidence(
            surface,
            {
              ...evidence,
              deploymentUrl: deployment.url,
              functionInventory: deployment.functions,
              health,
              qualifiedAt: new Date().toISOString(),
            },
            evidenceLock,
          );
          process.stdout.write(
            `Qualified ${surface.id} candidate ${deploymentId}; migration ${identity.migrationVersion}, cron/config/function inventory and fail-closed readiness are exact.\n`,
          );
          return;
        }

        if (command === 'promote') {
          if (
            typeof evidence.qualifiedAt !== 'string' ||
            evidence.qualifiedAt.length === 0
          ) {
            throw new Error(
              'Candidate has no successful qualification evidence.',
            );
          }
          const candidate = validateDeploymentInspection(surface, inspection, {
            requireUnaliased: false,
          });
          if (surface.id === 'api') {
            validateMigrationAttemptEvidence(
              surface,
              candidate,
              evidence,
              identity,
              { requireReady: true },
            );
          }
          await qualifyHealth(surface, deploymentId);
          for (const key of ['promotionStartedAt', 'promotionResult']) {
            if (!Object.hasOwn(evidence, key)) {
              throw new Error(
                `Candidate evidence is missing the guarded ${key} field.`,
              );
            }
          }
          const stableHost = new URL(surface.stableOrigin).hostname;
          const stableBefore = await inspect(surface, surface.stableOrigin);
          if (
            stableBefore?.name !== surface.projectName ||
            !/^dpl_[A-Za-z0-9]+$/u.test(stableBefore?.id ?? '') ||
            stableBefore?.target !== 'production' ||
            stableBefore?.readyState !== 'READY' ||
            !Array.isArray(stableBefore?.aliases) ||
            !stableBefore.aliases.includes(stableHost)
          ) {
            throw new Error(
              'Promotion preflight did not resolve the exact stable project deployment.',
            );
          }
          const durableStarting =
            evidence.promotionResult?.status === 'starting';
          const providerAppearsPromoted =
            stableBefore.id === candidate.id ||
            candidate.aliases.includes(stableHost);
          const hasCompletedEvidence =
            evidence.promotedAt !== null ||
            evidence.promotionResult?.status === 'ready';
          let startingResult = null;
          let invocationCompletedAt = null;
          let recovery = null;

          if (durableStarting) {
            startingResult = validatePromotionStartingResult(
              surface,
              candidate,
              evidence,
            );
            recovery = 'reconciled_after_interrupted_promotion';
          } else if (providerAppearsPromoted || hasCompletedEvidence) {
            if (
              evidence.promotionResult !== null &&
              evidence.promotionResult?.status !== 'ready'
            ) {
              throw new Error(
                'Promotion evidence has an unknown provider-side outcome.',
              );
            }
            startingResult = evidence.promotionResult ?? {
              schemaVersion: 1,
              deploymentId: candidate.id,
              deploymentUrl: candidate.url,
              projectId: surface.projectId,
              projectName: surface.projectName,
              orgId: vercelOrgId,
              stableOrigin: surface.stableOrigin,
              priorProductionDeploymentId:
                evidence.cronExposure?.productionDeploymentId ?? null,
              startedAt: null,
              invocationCompletedAt: null,
              observedAt: null,
              attempts: null,
              recovery: null,
            };
            recovery =
              evidence.promotionResult?.recovery ??
              'reconciled_from_exact_provider_state';
          } else {
            if (
              evidence.promotionStartedAt !== null ||
              evidence.promotionResult !== null ||
              evidence.promotedAt !== null ||
              evidence.promotionProjectState !== null
            ) {
              throw new Error(
                'Promotion evidence is internally inconsistent before invocation.',
              );
            }
            validateDeploymentInspection(surface, inspection, {
              requireUnaliased: true,
            });
            if (surface.id === 'api') {
              const promotionBinding = await readMigrationBinding(
                surface,
                candidate,
              );
              validateCandidateCronExposure(
                surface,
                candidate,
                evidence,
                promotionBinding,
              );
              validateMigrationAttemptEvidence(
                surface,
                candidate,
                evidence,
                identity,
                { binding: promotionBinding, requireReady: true },
              );
            }
            const promotionStartedAt = new Date().toISOString();
            startingResult = promotionStartingResult(
              surface,
              candidate,
              stableBefore,
              promotionStartedAt,
            );
            await writeCandidateEvidence(
              surface,
              {
                ...evidence,
                promotionStartedAt,
                promotionResult: startingResult,
              },
              evidenceLock,
            );
            await withProjectContext(surface, (contextRoot) =>
              runVercel(['promote', deploymentId, '--yes'], contextRoot),
            );
            invocationCompletedAt = new Date().toISOString();
          }

          const convergence = await pollPromotionConvergence(
            surface,
            candidate,
          );
          const promotedAt = new Date().toISOString();
          const promotionResult = {
            ...startingResult,
            status: 'ready',
            invocationCompletedAt:
              invocationCompletedAt ??
              startingResult.invocationCompletedAt ??
              null,
            observedAt: convergence.observedAt,
            attempts: convergence.attempts,
            recovery,
          };
          await writeCandidateEvidence(
            surface,
            {
              ...evidence,
              promotionStartedAt:
                evidence.promotionStartedAt ?? startingResult.startedAt ?? null,
              promotionResult,
              promotedAt,
              stableOrigin: surface.stableOrigin,
              promotionProjectState: convergence.promotionProjectState,
            },
            evidenceLock,
          );
          process.stdout.write(
            `${recovery === null ? 'Promoted' : 'Reconciled promoted'} qualified ${surface.id} candidate ${deploymentId} to ${surface.stableOrigin}; provider convergence is proven.\n`,
          );
          return;
        }

        throw new Error(`Unknown command ${command}.\n${usage()}`);
      },
    );
  });
  return;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
