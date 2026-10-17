import { grokAdapter as archivedConfig } from '../../src/sites/grok';
import {
  automationConfigSchema,
  contentRequestSchema,
  domResourceSourceSchema,
  promptPayloadSchema,
} from '../../src/protocol/content';
import { describe, expect, it } from 'vitest';

const validPayload = {
  prompt: 'A cinematic sunrise',
  promptIndex: 1,
  mode: 'textToImage',
  aspectRatio: '16:9',
  outputCount: 4,
  folderName: 'grok-folder-1',
  imageModel: 'quality',
  autoDownloadResourceQuality: '1k',
};

describe('content protocol schemas', () => {
  it('accepts the side-panel AUTO_FILL_GROK wire shape', () => {
    const parsed = contentRequestSchema.safeParse({
      type: 'AUTO_FILL_GROK',
      groupId: 'group-123',
      concurrentPrompts: 2,
      promptDelaySecondsMin: 1,
      promptDelaySecondsMax: 3,
      payloads: [validPayload],
    });

    expect(parsed.success).toBe(true);
    expect(
      contentRequestSchema.safeParse({
        type: 'COMMIT_PROMPT_GROUP',
        groupId: 'group-123',
      }).success,
    ).toBe(false);
    // The account-gated staging messages are gone with the sign-in gate.
    for (const type of ['QUERY_PROMPT_GROUP_COMMIT', 'RELEASE_PROMPT_GROUP']) {
      expect(
        contentRequestSchema.safeParse({ type, groupId: 'group-123' }).success,
      ).toBe(false);
    }
    expect(
      contentRequestSchema.safeParse({
        type: 'CANCEL_PROMPT_GROUP',
        groupId: 'group-123',
      }).success,
    ).toBe(true);
  });

  it('rejects unsupported modes and malformed prepared images', () => {
    expect(
      promptPayloadSchema.safeParse({ ...validPayload, mode: 'executeCode' })
        .success,
    ).toBe(false);
    expect(
      contentRequestSchema.safeParse({
        type: 'PREPARE_IMAGE',
        id: 'image-1',
        data: { name: 'missing-base64.jpg' },
      }).success,
    ).toBe(false);
  });

  it('validates every selector required by the clean automation source', () => {
    const parsed = automationConfigSchema.safeParse(archivedConfig);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data.selectors).length).toBeGreaterThanOrEqual(
        37,
      );
    }
  });

  it('validates DOM media sources before downloads or frame extraction', () => {
    expect(
      domResourceSourceSchema.safeParse('https://imgen.x.ai/result.png')
        .success,
    ).toBe(true);
    expect(
      domResourceSourceSchema.safeParse('blob:https://grok.com/result-id')
        .success,
    ).toBe(true);
    expect(
      domResourceSourceSchema.safeParse('https://attacker.test/result.png')
        .success,
    ).toBe(false);
  });
});
