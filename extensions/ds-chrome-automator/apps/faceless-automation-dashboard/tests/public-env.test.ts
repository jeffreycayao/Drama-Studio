import {
  DEFAULT_PLATFORM_API_ORIGIN,
  createExtensionGoogleAuthStartUrl,
  createGoogleAuthStartUrl,
  parsePlatformApiOrigin,
} from '../src/config/public-env';

describe('createGoogleAuthStartUrl', () => {
  it('creates the central Google authorization endpoint', () => {
    expect(createGoogleAuthStartUrl('https://auth.example.com')).toBe(
      'https://auth.example.com/v1/auth/google/start?client=dashboard',
    );
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'http://auth.example.com',
    'https://user:password@auth.example.com',
    'https://auth.example.com/subpath',
    'https://auth.example.com?redirect=elsewhere',
    'https://auth.example.com/#fragment',
  ])('rejects an absent or unsafe origin: %s', (origin) => {
    expect(createGoogleAuthStartUrl(origin)).toBeNull();
  });

  it.each([
    'http://localhost',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://[::1]:8787',
  ])('allows a local development origin: %s', (origin) => {
    expect(
      createGoogleAuthStartUrl(origin, { allowInsecureDevelopment: true }),
    ).toContain('/v1/auth/google/start?client=dashboard');
  });

  it.each([
    'http://10.0.0.8:8787',
    'http://172.16.0.8:8787',
    'http://172.31.255.254:8787',
    'http://192.168.1.20:8787',
  ])('allows an exact RFC1918 origin only in development: %s', (origin) => {
    expect(
      parsePlatformApiOrigin(origin, { allowInsecureDevelopment: true }),
    ).toBe(origin);
    expect(parsePlatformApiOrigin(origin)).toBeNull();
  });

  it.each([
    'http://172.15.1.1:8787',
    'http://172.32.1.1:8787',
    'http://192.167.1.1:8787',
    'http://8.8.8.8:8787',
    'http://example.local:8787',
  ])('rejects public or ambiguous HTTP development origins: %s', (origin) => {
    expect(
      parsePlatformApiOrigin(origin, { allowInsecureDevelopment: true }),
    ).toBeNull();
  });

  it('accepts an HTTPS Vercel deployment origin', () => {
    expect(parsePlatformApiOrigin('https://faceless-api.vercel.app')).toBe(
      'https://faceless-api.vercel.app',
    );
    expect(DEFAULT_PLATFORM_API_ORIGIN).toBe('https://paks-tools.vercel.app');
  });

  it('creates only an encoded extension Google authorization URL', () => {
    expect(
      createExtensionGoogleAuthStartUrl(
        'https://paks-tools.vercel.app',
        'extension_flow_0001',
      ),
    ).toBe(
      'https://paks-tools.vercel.app/v1/auth/google/start?client=extension&flowId=extension_flow_0001',
    );
    expect(
      createExtensionGoogleAuthStartUrl(
        'https://paks-tools.vercel.app',
        '../redirect?token=secret',
      ),
    ).toBeNull();
  });
});
