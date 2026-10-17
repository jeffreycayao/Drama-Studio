import { describe, expect, it } from 'vitest';

import {
  CAPTURE_CHUNK_BYTES,
  EXPECTED_REPLY,
  PROTOCOL_VERSION,
  companionRequestSchema,
  desktopReplySchema,
} from '../../src/desktop/contracts';
import fixture from '../fixtures/desktop-link-v2.json';

// The desktop runs the same examples through electron/companionLink/protocol.cjs
// (tests/companionLinkJobs.test.cjs), so a change on one side only fails CI.
describe('desktop link protocol 2 (shared fixture)', () => {
  it('is protocol 2 on both sides', () => {
    expect(fixture.protocol).toBe(PROTOCOL_VERSION);
  });

  it.each(
    fixture.requests.valid.map((message) => [
      message.type,
      message.id,
      message,
    ]),
  )('accepts the %s request %s', (_type, _id, message) => {
    expect(companionRequestSchema.safeParse(message).success).toBe(true);
  });

  it.each(fixture.requests.invalid.map((entry) => [entry.why, entry.message]))(
    'refuses a request: %s',
    (_why, message) => {
      expect(companionRequestSchema.safeParse(message).success).toBe(false);
    },
  );

  it.each(
    fixture.replies.valid.map((entry) => [entry.message.type, entry.message]),
  )('understands the desktop %s reply', (_type, message) => {
    expect(desktopReplySchema.safeParse(message).success).toBe(true);
  });

  it.each(fixture.replies.invalid.map((entry) => [entry.why, entry.message]))(
    'refuses a reply: %s',
    (_why, message) => {
      expect(desktopReplySchema.safeParse(message).success).toBe(false);
    },
  );

  it('pairs every request type with the reply the desktop sends', () => {
    const replyTypes = new Set(
      fixture.replies.valid.map((entry) => entry.message.type),
    );
    for (const message of fixture.requests.valid) {
      const expected =
        EXPECTED_REPLY[message.type as keyof typeof EXPECTED_REPLY];
      expect(replyTypes.has(expected)).toBe(true);
    }
  });

  it('agrees on the capture chunk size the desktop offers', () => {
    const ready = fixture.replies.valid.find(
      (entry) => entry.message.type === 'capture.ready',
    );
    expect(ready?.message).toMatchObject({ chunkBytes: CAPTURE_CHUNK_BYTES });
  });
});
