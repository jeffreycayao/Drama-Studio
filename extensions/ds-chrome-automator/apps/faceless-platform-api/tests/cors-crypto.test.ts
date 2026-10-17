import { describe, expect, it } from 'vitest';

import { parsePublicConfig } from '../src/config/env.js';
import {
  constantTimeEqual,
  createCsrfToken,
  decryptTransient,
  encryptTransient,
} from '../src/core/crypto.js';
import { assertAllowedOrigin } from '../src/http/cors.js';
import { testEnvironment } from './helpers.js';

describe('CORS and cryptography', () => {
  it('echoes exact registered origins and rejects extension access to admin routes', () => {
    const config = parsePublicConfig(testEnvironment());
    expect(
      assertAllowedOrigin(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        '/v1/session',
        config,
      ),
    ).toBe('chrome-extension://abcdefghijklmnopabcdefghijklmnop');
    expect(() =>
      assertAllowedOrigin(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        '/v1/admin/users',
        config,
      ),
    ).toThrow();
    expect(() =>
      assertAllowedOrigin('https://unknown.example', '/v1/session', config),
    ).toThrow();
  });

  it('authenticates transient ciphertext and derives stable CSRF tokens', () => {
    const secret = 'secret-material-that-is-long-enough-for-this-test';
    const encrypted = encryptTransient('sensitive transient value', secret);
    expect(decryptTransient(encrypted, secret)).toBe(
      'sensitive transient value',
    );
    expect(() => decryptTransient(encrypted, `${secret}-wrong`)).toThrow();
    expect(createCsrfToken('session-1', secret)).toBe(
      createCsrfToken('session-1', secret),
    );
    expect(constantTimeEqual('same', 'same')).toBe(true);
    expect(constantTimeEqual('same', 'different')).toBe(false);
  });
});
