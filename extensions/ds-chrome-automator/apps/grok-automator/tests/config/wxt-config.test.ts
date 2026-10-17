import { describe, expect, it } from 'vitest';

import { platformApiHostPermission } from '../../wxt.config';

describe('platform API manifest permission', () => {
  it('maps an HTTPS API origin to one exact Chrome host pattern', () => {
    expect(
      platformApiHostPermission('https://api.faceless.example', false),
    ).toBe('https://api.faceless.example/*');
  });

  it('allows loopback and private LAN HTTP hosts only in development', () => {
    expect(platformApiHostPermission('http://localhost:3000', true)).toBe(
      'http://localhost/*',
    );
    expect(platformApiHostPermission('http://192.168.56.20:3000', true)).toBe(
      'http://192.168.56.20/*',
    );
    expect(
      platformApiHostPermission('http://10.56.55.108:3000', false),
    ).toBeNull();
  });

  it('rejects public HTTP, URL paths, credentials, and wildcard-like hosts', () => {
    expect(
      platformApiHostPermission('http://198.51.100.20:3000', true),
    ).toBeNull();
    expect(
      platformApiHostPermission('https://api.faceless.example/v1', false),
    ).toBeNull();
    expect(
      platformApiHostPermission(
        'https://user:pass@api.faceless.example',
        false,
      ),
    ).toBeNull();
    expect(platformApiHostPermission('http://*.local:3000', true)).toBeNull();
  });
});
