import { describe, expect, it } from 'vitest';

import {
  parseAdminConfig,
  parseBlobConfig,
  parseDatabaseConfig,
  parseGoogleConfig,
  parseMigrationConfig,
  parsePublicConfig,
  parseSessionConfig,
  parseStripeConfig,
  parseUsageConfig,
} from '../src/config/env.js';
import { testEnvironment } from './helpers.js';

describe('environment boundaries', () => {
  it('accepts unrelated Vercel variables and an empty extension registration list', () => {
    const environment = testEnvironment();
    environment.PUBLIC_EXTENSION_REGISTRATIONS_JSON = '[]';
    environment.VERCEL = '1';
    environment.VERCEL_ENV = 'preview';
    environment.NPM_PACKAGE_NAME = 'unrelated';

    const config = parsePublicConfig(environment);

    expect(config.extensionRegistrations).toEqual([]);
    expect(config.allowedCorsOrigins.has('https://app.example.com')).toBe(true);
  });

  it('allows only explicitly listed localhost and private-LAN development origins', () => {
    const config = parsePublicConfig(testEnvironment());
    expect(config.developmentOrigins).toEqual(
      new Set([
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://192.168.1.9:5173',
      ]),
    );

    const invalid = testEnvironment();
    invalid.PUBLIC_DEV_ORIGINS = 'http://example.com:5173';
    expect(() => parsePublicConfig(invalid)).toThrow();
  });

  it('rejects wildcard and non-exact CORS values', () => {
    const wildcard = testEnvironment();
    wildcard.PUBLIC_WEB_ORIGINS = '*';
    expect(() => parsePublicConfig(wildcard)).toThrow();

    const path = testEnvironment();
    path.PUBLIC_WEB_ORIGINS = 'https://app.example.com/path';
    expect(() => parsePublicConfig(path)).toThrow();
  });

  it('fails every provider secret parser closed when values are missing', () => {
    expect(() => parseDatabaseConfig({})).toThrow();
    expect(() => parseGoogleConfig({})).toThrow();
    expect(() => parseSessionConfig({})).toThrow();
    expect(() => parseAdminConfig({})).toThrow();
    expect(() => parseStripeConfig({})).toThrow();
    expect(() => parseBlobConfig({})).toThrow();
    expect(() => parseMigrationConfig({})).toThrow();
    expect(() => parseUsageConfig({})).toThrow();
  });

  it('accepts normalized bootstrap emails without requiring legacy subjects', () => {
    const environment = testEnvironment();
    delete environment.ADMIN_GOOGLE_SUBJECTS;
    environment.ADMIN_GOOGLE_BOOTSTRAP_EMAILS =
      'owner@example.com,second-admin@example.com';

    expect(parseAdminConfig(environment)).toEqual({
      bootstrapEmails: ['owner@example.com', 'second-admin@example.com'],
      googleSubjects: [],
    });

    environment.ADMIN_GOOGLE_BOOTSTRAP_EMAILS = 'Owner@Example.com';
    expect(() => parseAdminConfig(environment)).toThrow(
      /normalized lowercase/u,
    );
    environment.ADMIN_GOOGLE_BOOTSTRAP_EMAILS =
      'owner@example.com,owner@example.com';
    expect(() => parseAdminConfig(environment)).toThrow(/duplicates/u);
  });
});
