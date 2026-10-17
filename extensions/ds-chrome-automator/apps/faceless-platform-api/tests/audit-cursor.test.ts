import { describe, expect, it } from 'vitest';

import {
  decodeAuditCursor,
  encodeAuditCursor,
} from '../src/http/audit-cursor.js';

describe('audit cursor', () => {
  it('round-trips chronology without exposing a raw tuple', () => {
    const cursor = {
      createdAt: '2026-08-20T00:00:00.000Z',
      id: 'audit_event_identifier_0001',
    };
    const encoded = encodeAuditCursor(cursor, 'p'.repeat(48));

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(encoded).not.toContain(cursor.createdAt);
    expect(encoded).not.toContain(cursor.id);
    expect(decodeAuditCursor(encoded, 'p'.repeat(48))).toEqual(cursor);
  });

  it('rejects a tampered or wrong-key cursor', () => {
    const encoded = encodeAuditCursor(
      {
        createdAt: '2026-08-20T00:00:00.000Z',
        id: 'audit_event_identifier_0001',
      },
      'p'.repeat(48),
    );
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith('a') ? 'b' : 'a'}`;

    expect(() => decodeAuditCursor(tampered, 'p'.repeat(48))).toThrow();
    expect(() => decodeAuditCursor(encoded, 'q'.repeat(48))).toThrow();
  });
});
