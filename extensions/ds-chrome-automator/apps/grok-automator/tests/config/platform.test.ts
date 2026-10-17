import { describe, expect, it } from 'vitest';

import {
  DEPLOYED_GROK_AUTOMATOR_GUIDE_URL,
  DEPLOYED_PLATFORM_WEB_ORIGIN,
} from '../../src/config/deployment';
import {
  createPlatformAuthUrl,
  normalizePlatformWebOrigin,
} from '../../src/config/platform';

describe('central platform web origin', () => {
  it('pins the user guide to the canonical managed document', () => {
    expect(DEPLOYED_GROK_AUTOMATOR_GUIDE_URL).toBe(
      'https://paks-tools.vercel.app/guide/grok-automator',
    );
    expect(new URL(DEPLOYED_GROK_AUTOMATOR_GUIDE_URL).origin).toBe(
      DEPLOYED_PLATFORM_WEB_ORIGIN,
    );
  });

  it('accepts canonical HTTPS origins in every environment', () => {
    expect(normalizePlatformWebOrigin('https://platform.example/')).toBe(
      'https://platform.example',
    );
    expect(normalizePlatformWebOrigin('http://localhost:3000')).toBeNull();
  });

  it('accepts exact loopback and private-LAN HTTP origins only in development', () => {
    const options = { allowInsecurePrivateDevelopment: true } as const;
    expect(normalizePlatformWebOrigin('http://localhost:3000', options)).toBe(
      'http://localhost:3000',
    );
    expect(normalizePlatformWebOrigin('http://127.0.0.1:4173/', options)).toBe(
      'http://127.0.0.1:4173',
    );
    expect(
      normalizePlatformWebOrigin('http://192.168.1.25:5173', options),
    ).toBe('http://192.168.1.25:5173');
    expect(normalizePlatformWebOrigin('http://10.10.0.4:3000', options)).toBe(
      'http://10.10.0.4:3000',
    );
    expect(normalizePlatformWebOrigin('http://172.31.10.2:3000', options)).toBe(
      'http://172.31.10.2:3000',
    );
    expect(
      normalizePlatformWebOrigin('http://172.32.0.2:3000', options),
    ).toBeNull();
    expect(
      normalizePlatformWebOrigin('http://198.51.100.2:3000', options),
    ).toBeNull();
  });

  it('rejects insecure remote, credentialed, and non-origin values', () => {
    expect(normalizePlatformWebOrigin('http://platform.example')).toBeNull();
    expect(
      normalizePlatformWebOrigin('https://user:pass@platform.example'),
    ).toBeNull();
    expect(
      normalizePlatformWebOrigin('https://platform.example/path'),
    ).toBeNull();
    expect(
      normalizePlatformWebOrigin('https://platform.example?query=true'),
    ).toBeNull();
    expect(normalizePlatformWebOrigin('not a URL')).toBeNull();
  });

  it('builds only the Google-only central auth readiness URL', () => {
    expect(createPlatformAuthUrl('https://platform.example')).toBe(
      'https://platform.example/auth?client=grok-automator',
    );
    expect(
      createPlatformAuthUrl('http://192.168.1.25:5173', {
        allowInsecurePrivateDevelopment: true,
      }),
    ).toBe('http://192.168.1.25:5173/auth?client=grok-automator');
    expect(createPlatformAuthUrl('')).toBeNull();
  });
});
