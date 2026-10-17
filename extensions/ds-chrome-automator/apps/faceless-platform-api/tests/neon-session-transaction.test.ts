import { describe, expect, it } from 'vitest';

import { buildCreateGoogleSessionTransaction } from '../src/adapters/neon.js';

const input = {
  expiresAt: '2026-08-17T20:00:00.000Z',
  identity: {
    displayName: 'PAKS Owner',
    email: 'owner@example.com',
    issuer: 'https://accounts.google.com',
    subject: 'google-subject-0001',
  },
  newUserId: 'new_user_identifier_000001',
  sessionId: 'web_session_identifier_0001',
  tokenHash: 'a'.repeat(64),
} as const;

describe('Neon Google session transaction', () => {
  it('uses sequential statements instead of sibling writable CTEs', () => {
    const statements = buildCreateGoogleSessionTransaction(input);
    const normalized = statements.map(({ text }) =>
      text.replace(/\s+/gu, ' ').trim(),
    );

    expect(statements).toHaveLength(6);
    expect(normalized[0]).toMatch(/^INSERT INTO users\b/u);
    expect(normalized[1]).toMatch(/^INSERT INTO google_identities\b/u);
    expect(normalized[2]).toMatch(/^DELETE FROM users\b/u);
    expect(normalized[3]).toMatch(/^UPDATE users\b/u);
    expect(normalized[4]).toMatch(/^INSERT INTO web_sessions\b/u);
    expect(normalized[5]).toMatch(/^SELECT s\.id AS session_id\b/u);
    expect(normalized.join(' ')).not.toMatch(/\bWITH\b/u);
  });

  it('keeps the canonical identity stable and removes a losing candidate user', () => {
    const statements = buildCreateGoogleSessionTransaction(input);
    const identityUpsert = statements[1]?.text ?? '';
    const orphanCleanup = statements[2]?.text ?? '';
    const sessionInsert = statements[4]?.text ?? '';

    expect(identityUpsert).toContain('ON CONFLICT (issuer, subject) DO UPDATE');
    expect(identityUpsert).not.toMatch(/SET\s+user_id\s*=/u);
    expect(orphanCleanup).toContain('AND user_id = $1');
    expect(sessionInsert).toContain('FROM google_identities');
    expect(sessionInsert).toContain('WHERE issuer = $4 AND subject = $5');
    expect(statements[0]?.parameters).toEqual([
      input.newUserId,
      input.identity.email,
      input.identity.displayName,
    ]);
    expect(statements[5]?.parameters).toEqual([
      input.identity.issuer,
      input.identity.subject,
      input.sessionId,
    ]);
  });

  it('binds every statement with an exact contiguous parameter list', () => {
    const statements = buildCreateGoogleSessionTransaction(input);

    for (const statement of statements) {
      const indexes = [...statement.text.matchAll(/\$(\d+)/gu)].map((match) =>
        Number(match[1]),
      );
      const highest = Math.max(...indexes);
      expect(new Set(indexes)).toEqual(
        new Set(Array.from({ length: highest }, (_, index) => index + 1)),
      );
      expect(statement.parameters).toHaveLength(highest);
    }
  });
});
