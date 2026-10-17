import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  buildClaimAdminIdentityTransaction,
  createNeonDatabase,
} from '../src/adapters/neon.js';
import {
  buildMigrationPlan,
  CURRENT_MIGRATION_VERSION,
  DEFAULT_GROK_AUTOMATOR_GUIDE,
} from '../src/adapters/migrations.js';

describe('guide and admin persistence security', () => {
  it('serializes an exact one-time Google identity claim and audits only insertion', () => {
    const plan = buildClaimAdminIdentityTransaction({
      auditId: 'audit_identifier_000000001',
      auditTargetId: 'a'.repeat(64),
      email: 'owner@example.com',
      issuer: 'https://accounts.google.com',
      now: '2026-08-20T00:00:00.000Z',
      subject: 'google-owner-subject',
      userId: 'user_identifier_000001',
    });
    expect(plan).toHaveLength(2);
    expect(plan[0]?.text).toContain('pg_advisory_xact_lock');
    const claim = plan[1]?.text ?? '';
    expect(claim).toContain('gi.issuer = $1');
    expect(claim).toContain('gi.subject = $2');
    expect(claim).toContain('gi.user_id = $3');
    expect(claim).toContain('LOWER(gi.email) = $4');
    expect(claim).toContain('ON CONFLICT DO NOTHING');
    expect(claim).toContain("'admin.identity.bootstrap'");
    expect(claim).toContain('FROM inserted');
  });

  it('persists create/update snapshots and audit entries in the same statement', () => {
    const source = createNeonDatabase.toString().replace(/\s+/gu, ' ');
    expect(source).toContain('INSERT INTO tool_guide_revisions');
    expect(source).toContain("'tool_guide.create'");
    expect(source).toContain("'tool_guide.update'");
    expect(source).toContain('AND revision = $9::integer');
    expect(source).toContain('AND revision < 2147483647');
    expect(source).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(source).toContain('JOIN snapshot');
    expect(source).toContain('JOIN audit');
  });

  it('mirrors migration 0005 with unique stable bindings and append-only revisions', async () => {
    const sql = await readFile(
      new URL('../db/migrations/0005_guide_cms.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain(CURRENT_MIGRATION_VERSION);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_identities');
    expect(sql).toContain('UNIQUE (subject)');
    expect(sql).toContain('UNIQUE (normalized_email)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tool_guide_revisions');
    expect(sql).toContain("'grok-automator'");
    expect(DEFAULT_GROK_AUTOMATOR_GUIDE.status).toBe('published');
  });

  it('adds only the guide CMS migration after schema 0004', () => {
    const plan = buildMigrationPlan([
      '0001_initial',
      '0002_extension_platform',
      '0003_brand_rename',
      '0004_security_lifecycle',
    ]);
    const migrations = plan.filter(({ kind }) => kind === 'migration');
    const source = migrations.map(({ text }) => text).join('\n');
    expect(source).toContain('admin_identities');
    expect(source).toContain('tool_guides');
    expect(source).toContain('tool_guide_revisions');
    expect(source).not.toContain('ALTER TABLE extension_auth_flows');
  });
});
