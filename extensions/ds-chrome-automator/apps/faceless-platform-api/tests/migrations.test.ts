import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  buildBrandRenameMigrationStatement,
  buildMigrationPlan,
  buildRetentionStatements,
  CURRENT_MIGRATION_VERSION,
  DEFAULT_PLATFORM_SETTINGS,
  executeLockedMigrationPlan,
  MIGRATION_TRANSACTION_BEGIN,
  PLATFORM_DISPLAY_NAME,
} from '../src/adapters/migrations.js';

const legacyDisplayName = 'Faceless Automations';

describe('platform brand migration', () => {
  it('uses the requested display name for every fresh-install public title', async () => {
    const baseMigrationUrl = new URL(
      '../db/migrations/0001_initial.sql',
      import.meta.url,
    );
    const baseSql = await readFile(baseMigrationUrl, 'utf8');

    expect(DEFAULT_PLATFORM_SETTINGS.seo.siteTitle).toBe(PLATFORM_DISPLAY_NAME);
    expect(DEFAULT_PLATFORM_SETTINGS.seo.openGraphTitle).toBe(
      PLATFORM_DISPLAY_NAME,
    );
    expect(baseSql.match(/Paks Tools Faceless automations/gu)).toHaveLength(2);
    expect(baseSql).not.toContain(legacyDisplayName);
  });

  it('binds the exact legacy and replacement names with contiguous parameters', () => {
    const statement = buildBrandRenameMigrationStatement();
    const indexes = [...statement.text.matchAll(/\$(\d+)/gu)].map((match) =>
      Number(match[1]),
    );

    expect(statement.parameters).toEqual([
      '0003_brand_rename',
      legacyDisplayName,
      PLATFORM_DISPLAY_NAME,
    ]);
    expect(new Set(indexes)).toEqual(new Set([1, 2, 3]));
    expect(Math.max(...indexes)).toBe(statement.parameters.length);
    expect(PLATFORM_DISPLAY_NAME).toBe('Paks Tools Faceless automations');
  });

  it('claims the migration once and patches only exact legacy title fields', () => {
    const { text } = buildBrandRenameMigrationStatement();
    const normalized = text.replace(/\s+/gu, ' ').trim();
    const exactLegacyGuards = text.match(
      /settings #>> '\{seo,(?:siteTitle|openGraphTitle)\}' = \$2/gu,
    );

    expect(normalized).toContain(
      'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING RETURNING version',
    );
    expect(normalized).toContain(
      'WHERE EXISTS (SELECT 1 FROM claimed_migration)',
    );
    expect(exactLegacyGuards).toHaveLength(4);
    expect(text).toContain("(settings -> 'seo') ||");
    expect(text).toContain('jsonb_strip_nulls');
    expect(text).toContain('revision = revision + 1');
    expect(text).not.toContain('siteDescription');
    expect(text).not.toContain('openGraphDescription');
    expect(text).not.toContain("'{theme}'");
    expect(text).not.toMatch(/\bILIKE\b/iu);
  });

  it('keeps the auditable SQL mirror guarded and aligned with runtime copy', async () => {
    const migrationUrl = new URL(
      '../db/migrations/0003_brand_rename.sql',
      import.meta.url,
    );
    const sql = await readFile(migrationUrl, 'utf8');
    const normalized = sql.replace(/\s+/gu, ' ').trim();

    expect(sql).toContain('0003_brand_rename');
    expect(sql).toContain(legacyDisplayName);
    expect(sql).toContain(PLATFORM_DISPLAY_NAME);
    expect(normalized).toContain(
      'ON CONFLICT (version) DO NOTHING RETURNING version',
    );
    expect(normalized).toContain(
      'WHERE EXISTS (SELECT 1 FROM claimed_migration)',
    );
    expect(sql).toContain('revision = revision + 1');
    expect(sql).toContain("(settings -> 'seo') ||");
    expect(sql).not.toContain('siteDescription');
    expect(sql).not.toContain('openGraphDescription');
  });

  it('mirrors the current security lifecycle schema and retention indexes', async () => {
    const migrationUrl = new URL(
      '../db/migrations/0004_security_lifecycle.sql',
      import.meta.url,
    );
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toContain('0004_security_lifecycle');
    expect(sql).toContain('rate_limit_buckets');
    expect(sql).toContain('verification_attempts BETWEEN 0 AND 5');
    expect(sql).toContain('usage_authorizations_lifecycle_check');
    expect(sql).toContain("'reserved', 'accepted', 'consumed'");
    expect(sql).toContain('usage_authorization_events');
    expect(sql).toContain('acceptance_expires_at');
    expect(sql).toContain('rolled_back_at');
    expect(sql).toContain('(created_at DESC, id DESC)');
  });

  it('runs bounded retention for every obsolete security record class', () => {
    const retention = buildRetentionStatements().join('\n');

    expect(retention).toContain("lifecycle_status = 'expired'");
    expect(retention).toContain("lifecycle_status = 'rolled_back'");
    expect(retention).toContain("'auto_rolled_back'");
    expect(retention).toContain('DELETE FROM google_oauth_flows');
    expect(retention).toContain('DELETE FROM extension_auth_flows');
    expect(retention).toContain('DELETE FROM usage_authorizations');
    expect(retention).toContain('DELETE FROM usage_authorization_events');
    expect(retention).toContain('DELETE FROM app_sessions');
    expect(retention).toContain('DELETE FROM web_sessions');
    expect(retention).toContain('DELETE FROM rate_limit_buckets');
    expect(retention).toContain("INTERVAL '30 days'");
    expect(retention).toContain("INTERVAL '90 days'");
  });

  it('runs retention without replaying DDL when the schema is current', () => {
    const plan = buildMigrationPlan([
      '0001_initial',
      '0002_extension_platform',
      '0003_brand_rename',
      '0004_security_lifecycle',
      CURRENT_MIGRATION_VERSION,
    ]);
    const migrationStatements = plan.filter(({ kind }) => kind === 'migration');
    const executed = plan.map(({ text }) => text).join('\n');

    expect(migrationStatements).toHaveLength(0);
    expect(plan[0]?.kind).toBe('lock');
    expect(plan.slice(1).every(({ kind }) => kind === 'retention')).toBe(true);
    expect(executed).not.toMatch(/\b(?:ALTER|CREATE|DROP)\b/iu);
    expect(executed).toContain('DELETE FROM usage_authorization_events');
  });

  it('acquires the migration lock before planning a first installation', async () => {
    const queries: string[] = [];

    await executeLockedMigrationPlan({
      query: (text) => {
        queries.push(text);
        if (text.includes("to_regclass('public.schema_migrations')")) {
          return Promise.resolve({ rows: [{ exists: false }] });
        }
        return Promise.resolve({ rows: [] });
      },
    });

    expect(queries[0]).toContain('pg_advisory_xact_lock');
    expect(queries[1]).toContain("to_regclass('public.schema_migrations')");
    expect(queries[2]).toContain(
      'CREATE TABLE IF NOT EXISTS schema_migrations',
    );
    expect(queries.findIndex((text) => /\bCREATE\b/iu.test(text))).toBe(2);
    expect(MIGRATION_TRANSACTION_BEGIN).toBe(
      'BEGIN ISOLATION LEVEL READ COMMITTED',
    );
  });

  it('re-reads the current registry under the lock and executes retention only', async () => {
    const queries: string[] = [];
    const currentVersions = [
      '0001_initial',
      '0002_extension_platform',
      '0003_brand_rename',
      '0004_security_lifecycle',
      CURRENT_MIGRATION_VERSION,
    ];

    await executeLockedMigrationPlan({
      query: (text) => {
        queries.push(text);
        if (text.includes("to_regclass('public.schema_migrations')")) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        if (text === 'SELECT version FROM schema_migrations') {
          return Promise.resolve({
            rows: currentVersions.map((version) => ({ version })),
          });
        }
        return Promise.resolve({ rows: [] });
      },
    });

    expect(queries[0]).toContain('pg_advisory_xact_lock');
    expect(queries[1]).toContain("to_regclass('public.schema_migrations')");
    expect(queries[2]).toBe('SELECT version FROM schema_migrations');
    expect(queries.slice(3).join('\n')).not.toMatch(
      /\b(?:ALTER|CREATE|DROP)\b/iu,
    );
    expect(queries.slice(3).join('\n')).toContain(
      'DELETE FROM usage_authorization_events',
    );
  });
});
