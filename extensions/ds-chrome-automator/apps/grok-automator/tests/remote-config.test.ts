import { describe, expect, it } from 'vitest';

import {
  getRemoteConfig,
  isVersionSupported,
  remoteConfigSchema,
  verifyRemoteConfigIntegrity,
} from '../src/config/remote-config';

describe('recovered remote selector configuration', () => {
  it('contains the complete recovered selector set', async () => {
    const config = remoteConfigSchema.parse(await getRemoteConfig());
    expect(Object.keys(config.selectors)).toHaveLength(38);
    expect(config.selectors.submitButton).toContain('button.rounded-full');
    expect(await verifyRemoteConfigIntegrity(config)).toBe(true);
  });

  it('rejects selector data that does not match its declared hash', async () => {
    const config = await getRemoteConfig();
    expect(
      await verifyRemoteConfigIntegrity({
        ...config,
        selectors: { ...config.selectors, imagineLink: 'changed-selector' },
      }),
    ).toBe(false);
  });

  it('pins the archived selector set to the current clean client version', async () => {
    const config = await getRemoteConfig();
    expect(isVersionSupported(config, '0.0.13')).toBe(true);
    expect(isVersionSupported(config, '2.6.3')).toBe(false);
    expect(isVersionSupported(config, '9.9.9')).toBe(false);
  });
});
