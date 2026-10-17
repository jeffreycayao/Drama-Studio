import { describe, expect, it, vi } from 'vitest';

import { createPlatformApp } from '../src/http/app.js';
import type { GoogleIdentityPort } from '../src/ports/providers.js';
import {
  adminSession,
  FakeDatabase,
  testEnvironment,
  timestamp,
} from './helpers.js';

function bootstrapEnvironment(bootstrapEmail: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...testEnvironment(),
    ADMIN_GOOGLE_BOOTSTRAP_EMAILS: bootstrapEmail,
    GOOGLE_CLIENT_ID: 'google-client-id-for-bootstrap-test',
    GOOGLE_CLIENT_SECRET: 'google-client-secret-for-bootstrap-test',
    GOOGLE_OAUTH_REDIRECT_URI:
      'https://api.example.com/v1/auth/google/callback',
    OAUTH_TRANSIENT_KEY: 'o'.repeat(48),
  };
  delete environment.ADMIN_GOOGLE_SUBJECTS;
  return environment;
}

async function completeDashboardCallback(input: {
  database: FakeDatabase;
  environment: NodeJS.ProcessEnv;
  identityEmail?: string;
  identitySubject?: string;
}) {
  const google: GoogleIdentityPort = {
    createAuthorizationUrl(parameters) {
      return `https://accounts.example.test/authorize?state=${parameters.state}`;
    },
    exchangeAndVerify: vi.fn(async () => ({
      displayName: 'Owner',
      email: input.identityEmail ?? 'Owner@Example.com',
      issuer: 'https://accounts.google.com',
      subject: input.identitySubject ?? adminSession.googleSubject,
    })),
  };
  const app = createPlatformApp({
    database: input.database,
    environment: input.environment,
    google,
    now: () => new Date(timestamp),
  });
  const start = await app(
    new Request(
      'https://api.example.com/v1/auth/google/start?client=dashboard',
    ),
  );
  const location = start.headers.get('location');
  if (location === null) throw new Error('Expected Google redirect');
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('Expected Google OAuth state');
  const callback = await app(
    new Request(
      `https://api.example.com/v1/auth/google/callback?code=${'c'.repeat(32)}&state=${state}`,
      { headers: { Cookie: `__Host-fa_oauth_state=${state}` } },
    ),
  );
  return { app, callback };
}

describe('Google admin bootstrap', () => {
  it('claims an exact allowlisted verified email once using normalized provider identity', async () => {
    const database = new FakeDatabase();
    const environment = bootstrapEnvironment('owner@example.com');
    const { app, callback } = await completeDashboardCallback({
      database,
      environment,
    });

    expect(callback.status).toBe(302);
    expect(database.adminIdentityClaimInput).toMatchObject({
      email: 'owner@example.com',
      issuer: 'https://accounts.google.com',
      subject: adminSession.googleSubject,
      userId: adminSession.userId,
    });
    expect(database.adminIdentityClaimInput?.auditTargetId).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const session = await app(
      new Request('https://api.example.com/v1/session', {
        headers: { Authorization: `Bearer ${'a'.repeat(48)}` },
      }),
    );
    await expect(session.json()).resolves.toMatchObject({ admin: true });
  });

  it('never claims a non-allowlisted email', async () => {
    const database = new FakeDatabase();
    const { app } = await completeDashboardCallback({
      database,
      environment: bootstrapEnvironment('another-admin@example.com'),
    });
    expect(database.adminIdentityClaimed).toBe(false);

    const session = await app(
      new Request('https://api.example.com/v1/session', {
        headers: { Authorization: `Bearer ${'a'.repeat(48)}` },
      }),
    );
    await expect(session.json()).resolves.toMatchObject({ admin: false });
  });

  it('keeps a colliding or rejected claim non-admin', async () => {
    const database = new FakeDatabase();
    database.adminIdentityClaimResult = false;
    const { app } = await completeDashboardCallback({
      database,
      environment: bootstrapEnvironment('owner@example.com'),
      identitySubject: 'different-google-subject',
    });
    expect(database.adminIdentityClaimed).toBe(true);
    expect(database.adminIdentityAuthorized).toBe(false);

    const session = await app(
      new Request('https://api.example.com/v1/session', {
        headers: { Authorization: `Bearer ${'a'.repeat(48)}` },
      }),
    );
    await expect(session.json()).resolves.toMatchObject({ admin: false });
  });

  it('keeps ordinary sign-in available when bootstrap persistence fails', async () => {
    const database = new FakeDatabase();
    vi.spyOn(database, 'claimAdminIdentity').mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { app, callback } = await completeDashboardCallback({
      database,
      environment: bootstrapEnvironment('owner@example.com'),
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.getSetCookie().join(';')).toContain(
      '__Host-fa_session=',
    );

    const session = await app(
      new Request('https://api.example.com/v1/session', {
        headers: { Authorization: `Bearer ${'a'.repeat(48)}` },
      }),
    );
    await expect(session.json()).resolves.toMatchObject({ admin: false });
    expect(error).toHaveBeenCalledWith(
      '[admin-bootstrap-failed]',
      JSON.stringify({ stage: 'persist_stable_identity' }),
    );
    error.mockRestore();
  });

  it('authorizes a persisted stable subject without the legacy subject env', async () => {
    const database = new FakeDatabase();
    database.adminIdentityAuthorized = true;
    const app = createPlatformApp({
      database,
      environment: bootstrapEnvironment('another-admin@example.com'),
    });
    const response = await app(
      new Request('https://api.example.com/v1/admin/session', {
        headers: { Authorization: `Bearer ${'a'.repeat(48)}` },
      }),
    );
    expect(response.status).toBe(200);
  });
});
