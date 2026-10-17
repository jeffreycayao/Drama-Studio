import { describe, expect, it } from 'vitest';

import {
  grokAutomatorConfigEnvelopeSchema,
  grokSelectorSetSchema,
} from '../src/index.js';
import { validGrokConfigEnvelope, validGrokSelectors } from './fixtures.js';

describe('Grok Automator configuration contract', () => {
  it('accepts the complete bounded selector set', () => {
    expect(grokSelectorSetSchema.parse(validGrokSelectors)).toEqual(
      validGrokSelectors,
    );
    expect(
      grokAutomatorConfigEnvelopeSchema.parse(validGrokConfigEnvelope),
    ).toEqual(validGrokConfigEnvelope);
  });

  it('rejects missing and unknown selector keys', () => {
    const missingSelector = { ...validGrokSelectors };
    Reflect.deleteProperty(missingSelector, 'imagineLink');

    expect(grokSelectorSetSchema.safeParse(missingSelector).success).toBe(
      false,
    );
    expect(
      grokSelectorSetSchema.safeParse({
        ...validGrokSelectors,
        executableCommand: 'alert(1)',
      }).success,
    ).toBe(false);
  });

  it('rejects control characters, duplicate versions and invalid hashes', () => {
    expect(
      grokSelectorSetSchema.safeParse({
        ...validGrokSelectors,
        imagineLink: 'button\u0000script',
      }).success,
    ).toBe(false);
    expect(
      grokAutomatorConfigEnvelopeSchema.safeParse({
        ...validGrokConfigEnvelope,
        compatibleClientVersions: ['0.0.2', '0.0.2'],
      }).success,
    ).toBe(false);
    expect(
      grokAutomatorConfigEnvelopeSchema.safeParse({
        ...validGrokConfigEnvelope,
        contentSha256: 'not-a-hash',
      }).success,
    ).toBe(false);
  });

  it('pins the app-specific envelope to Grok Automator', () => {
    expect(
      grokAutomatorConfigEnvelopeSchema.safeParse({
        ...validGrokConfigEnvelope,
        appId: 'other-extension',
      }).success,
    ).toBe(false);
  });
});
