import { describe, expect, it } from 'vitest';

import {
  buildAuthorizeUsageTransaction,
  buildConsumeRateLimitsTransaction,
  buildCreateExtensionFlowTransaction,
  buildCreateGoogleOauthFlowTransaction,
  buildDenyExtensionAuthFlowStatement,
  buildListAuditEventsStatement,
  createNeonDatabase,
} from '../src/adapters/neon.js';

const now = '2026-08-20T00:00:00.000Z';

describe('Neon security transactions', () => {
  it('acquires the quota lock in a separate command before taking a fresh snapshot', () => {
    const statements = buildAuthorizeUsageTransaction({
      appId: 'grok-automator',
      appSessionId: 'app_session_identifier_0001',
      authorizationExpiresAt: '2026-08-20T00:01:00.000Z',
      authorizationId: 'usage_authorization_identifier_0001',
      dailyUnitLimit: 10,
      idempotencyKey: 'usage.request.identifier.0001',
      now,
      operation: 'automation.run',
      protocolVersion: 2,
      resetsAt: '2026-08-21T00:00:00.000Z',
      units: 1,
      userId: 'user_identifier_000001',
    });
    const normalized = statements.map(({ text }) =>
      text.replace(/\s+/gu, ' ').trim(),
    );

    expect(statements).toHaveLength(2);
    expect(normalized[0]).toMatch(/^SELECT pg_advisory_xact_lock\(/u);
    expect(normalized[1]).not.toContain('request_lock');
    expect(normalized[1]).not.toContain('CROSS JOIN');
    expect(normalized[1]).toContain("lifecycle_status = 'consumed'");
    expect(normalized[1]).toContain("lifecycle_status = 'reserved'");
    expect(normalized[1]).toContain("lifecycle_status = 'accepted'");
    expect(normalized[1]).toContain('ua.expires_at > $3');
    expect(normalized[1]).toContain(
      "ua.created_at >= $10::timestamptz - INTERVAL '1 day'",
    );
    expect(normalized[1]).toContain('ua.created_at < $10::timestamptz');
    expect(normalized[1]).toContain(
      'WHERE EXISTS (SELECT 1 FROM session_scope)',
    );
  });

  it('locks layered rate buckets and consumes them all-or-none', () => {
    const statements = buildConsumeRateLimitsTransaction([
      {
        expiresAt: '2026-08-20T00:20:00.000Z',
        key: 'b'.repeat(64),
        limit: 12,
        windowStartedAt: now,
      },
      {
        expiresAt: '2026-08-20T02:00:00.000Z',
        key: 'a'.repeat(64),
        limit: 120,
        windowStartedAt: now,
      },
    ]);
    const decision = statements.at(-1)?.text ?? '';

    expect(statements).toHaveLength(3);
    expect(statements[0]?.parameters[0]).toBe(`${'a'.repeat(64)}:${now}`);
    expect(statements[1]?.parameters[0]).toBe(`${'b'.repeat(64)}:${now}`);
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    expect(decision).toContain('capacity AS');
    expect(decision).toContain('FROM requested, capacity');
    expect(decision).toContain('WHERE capacity.allowed');
  });

  it('serializes same-key retries and prevents a duplicate quota increment', () => {
    const [, decision] = buildAuthorizeUsageTransaction({
      appId: 'grok-automator',
      appSessionId: 'app_session_identifier_0001',
      authorizationExpiresAt: '2026-08-20T00:01:00.000Z',
      authorizationId: 'usage_authorization_identifier_0001',
      dailyUnitLimit: 10,
      idempotencyKey: 'usage.request.identifier.0001',
      now,
      operation: 'automation.run',
      protocolVersion: 2,
      resetsAt: '2026-08-21T00:00:00.000Z',
      units: 1,
      userId: 'user_identifier_000001',
    });
    const sql = (decision?.text ?? '').replace(/\s+/gu, ' ').trim();

    expect(sql.indexOf('existing AS')).toBeLessThan(sql.indexOf('inserted AS'));
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM existing)');
    expect(sql).toContain(
      'ON CONFLICT (user_id, app_id, idempotency_key) DO NOTHING',
    );
    expect(sql).toContain('idempotency_matches');
    expect(sql).toContain('ua.protocol_version = $12');
  });

  it('serializes acceptance/finalization races and makes terminal retries idempotent', () => {
    const source = createNeonDatabase.toString().replace(/\s+/gu, ' ');

    expect(source).toContain('usage-acceptance:${input.acceptanceId}');
    expect(source).toContain('usage-authorization:${input.authorizationId}');
    expect(source).toContain("ua.lifecycle_status = 'accepted'");
    expect(source).toContain('ua.acceptance_id = $6');
    expect(source).toContain(
      "'accepted', 'consumed', 'cancelled', 'rolled_back', 'expired'",
    );
    expect(source).toContain('usage_authorization_events');
    expect(source).toContain("THEN 'finalized' ELSE 'auto_rolled_back'");
    expect(source).toContain('ua.protocol_version = 1');
    expect(source).toContain("THEN 'legacy_consumed' ELSE 'expired'");
  });

  it('locks allocation scopes before enforcing concurrent-flow caps', () => {
    const extensionStatements = buildCreateExtensionFlowTransaction(
      {
        allocationKey: 'a'.repeat(64),
        appId: 'grok-automator',
        codeChallenge: 'c'.repeat(43),
        expiresAt: '2026-08-20T00:10:00.000Z',
        extensionOrigin: `chrome-extension://${'a'.repeat(32)}`,
        flowId: 'extension_flow_identifier_0001',
        initiatorVerifiedAt: null,
        protocolVersion: 2,
        status: 'pending',
        userId: null,
        userCodeHash: 'b'.repeat(64),
        verificationAttempts: 0,
      },
      5,
    );
    const oauthStatements = buildCreateGoogleOauthFlowTransaction(
      {
        allocationKey: 'd'.repeat(64),
        client: 'extension',
        encryptedCodeVerifier: 'encrypted',
        expiresAt: '2026-08-20T00:10:00.000Z',
        extensionFlowId: 'extension_flow_identifier_0001',
        nonceHash: 'e'.repeat(64),
        stateHash: 'f'.repeat(64),
      },
      1,
    );

    for (const statements of [extensionStatements, oauthStatements]) {
      expect(statements).toHaveLength(2);
      expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
      expect(statements[1]?.text).toContain('SELECT COUNT(*)');
      expect(statements[1]?.text).toContain('< $8');
    }
    const oauthAllocation = oauthStatements[1]?.text ?? '';
    expect(oauthAllocation).toContain('extension_scope AS MATERIALIZED');
    expect(oauthAllocation).toContain('FOR UPDATE');
    expect(oauthAllocation).toContain('$7 IS NULL OR EXISTS');
    expect(oauthAllocation).toContain('OR $7 IS NOT NULL');
  });

  it('cannot deny a v2 flow after its Google identity has been bound', () => {
    const denial = buildDenyExtensionAuthFlowStatement(
      'extension_flow_identifier_0001',
      now,
    );
    const sql = denial.text.replace(/\s+/gu, ' ').trim();
    const databaseSource = createNeonDatabase.toString().replace(/\s+/gu, ' ');

    expect(sql).toContain('protocol_version = 1');
    expect(sql).toContain('protocol_version = 2 AND user_id IS NULL');
    expect(databaseSource).toContain("'bound'::text AS callback_status");
    expect(databaseSource).toContain(
      "'already_bound'::text AS callback_status",
    );
    expect(databaseSource).toContain('f.user_id IS NOT NULL');
  });

  it('uses a strict chronological tuple cursor for audit pagination', () => {
    const statement = buildListAuditEventsStatement({
      cursor: {
        createdAt: now,
        id: 'audit_event_identifier_0001',
      },
      limit: 50,
    });

    expect(statement.text).toContain(
      '(created_at, id) < ($1::timestamptz, $2::text)',
    );
    expect(statement.text).toContain('ORDER BY created_at DESC, id DESC');
    expect(statement.parameters).toEqual([
      now,
      'audit_event_identifier_0001',
      51,
    ]);
  });
});
