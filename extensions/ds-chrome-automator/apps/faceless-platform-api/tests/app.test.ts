import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

import { getCsrfToken } from '../src/http/auth.js';
import { createPlatformApp } from '../src/http/app.js';
import type {
  BlobPort,
  GoogleIdentityPort,
  StripePort,
} from '../src/ports/providers.js';
import {
  adminSession,
  FakeDatabase,
  platformSettings,
  testEnvironment,
  timestamp,
} from './helpers.js';

const bearerToken = 'a'.repeat(48);

function authenticatedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${bearerToken}`);
  return new Request(`https://api.example.com${path}`, { ...init, headers });
}

describe('platform application', () => {
  it('keeps liveness independent and readiness closed without provider secrets', async () => {
    const app = createPlatformApp({ environment: {} });
    const live = await app(new Request('https://api.example.com/health/live'));
    const ready = await app(
      new Request('https://api.example.com/health/ready'),
    );
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({ status: 'live' });
    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toEqual({ status: 'not_ready' });
  });

  it('keeps readiness closed until the source migration is applied', async () => {
    const database = new FakeDatabase();
    const environment = {
      ...testEnvironment(),
      BLOB_READ_WRITE_TOKEN: 'b'.repeat(48),
      GOOGLE_CLIENT_ID: 'google-client-id-for-readiness-test',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-for-readiness-test',
      GOOGLE_OAUTH_REDIRECT_URI:
        'https://api.example.com/v1/auth/google/callback',
      OAUTH_TRANSIENT_KEY: 'o'.repeat(48),
      STRIPE_PRICE_CATALOG_JSON: JSON.stringify({
        'grok-pro': {
          entitlementCode: 'extension:grok-automator',
          mode: 'payment',
          priceId: 'price_readiness001',
        },
      }),
      STRIPE_RESTRICTED_KEY: 'rk_test_readiness001',
      STRIPE_WEBHOOK_SECRET: 'whsec_readiness001',
    };
    const blob: BlobPort = { async ping() {} };
    const google: GoogleIdentityPort = {
      createAuthorizationUrl: vi.fn(() => 'https://accounts.example.test/'),
      exchangeAndVerify: vi.fn(),
    };
    const stripe: StripePort = {
      createCheckout: vi.fn(),
      verifyWebhook: vi.fn(),
    };
    database.currentMigrationVersion = '0003_brand_rename';
    const app = createPlatformApp({
      blob,
      database,
      environment,
      google,
      stripe,
    });

    const behind = await app(
      new Request('https://api.example.com/health/ready'),
    );
    expect(behind.status).toBe(503);
    await expect(behind.json()).resolves.toEqual({ status: 'not_ready' });

    database.currentMigrationVersion = '0005_future_schema';
    const ahead = await app(
      new Request('https://api.example.com/health/ready'),
    );
    expect(ahead.status).toBe(503);
    await expect(ahead.json()).resolves.toEqual({ status: 'not_ready' });

    database.currentMigrationVersion = '0005_guide_cms';
    const current = await app(
      new Request('https://api.example.com/health/ready'),
    );
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual({ status: 'ready' });
  });

  it('does not expose the server-side migration runner without Vercel cron authentication', async () => {
    const app = createPlatformApp({ environment: testEnvironment() });
    const response = await app(
      new Request('https://api.example.com/v1/internal/migrations'),
    );
    expect(response.status).toBe(401);
  });

  it('returns the shared dashboard session contract only to an allowlisted owner', async () => {
    const database = new FakeDatabase();
    const environment = testEnvironment();
    const app = createPlatformApp({ database, environment });
    const response = await app(authenticatedRequest('/v1/admin/session'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      account: {
        displayName: 'Owner',
        email: 'owner@example.com',
        provider: 'google',
        role: 'admin',
        userId: 'user_identifier_000001',
      },
      csrfToken: getCsrfToken(adminSession, environment),
      expiresAt: '2026-08-16T08:00:00.000Z',
      schemaVersion: 1,
    });

    environment.ADMIN_GOOGLE_SUBJECTS = 'different-google-subject';
    const denied = await createPlatformApp({ database, environment })(
      authenticatedRequest('/v1/admin/session'),
    );
    expect(denied.status).toBe(403);
  });

  it('requires CSRF for admin mutations and prevents self-ban', async () => {
    const database = new FakeDatabase();
    const environment = testEnvironment();
    const app = createPlatformApp({
      database,
      environment,
      now: () => new Date(timestamp),
    });
    const body = JSON.stringify({ reason: 'Confirmed account abuse' });
    const missingCsrf = await app(
      authenticatedRequest('/v1/admin/users/another_user_identifier/ban', {
        body,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(missingCsrf.status).toBe(403);
    expect(database.banCalled).toBe(false);

    const allowed = await app(
      authenticatedRequest('/v1/admin/users/another_user_identifier/ban', {
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
        },
        method: 'POST',
      }),
    );
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({
      schemaVersion: 1,
      updatedAt: timestamp,
    });
    expect(database.banCalled).toBe(true);

    const selfBan = await app(
      authenticatedRequest(`/v1/admin/users/${adminSession.userId}/ban`, {
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
        },
        method: 'POST',
      }),
    );
    expect(selfBan.status).toBe(409);
  });

  it('returns and updates the exact public platform settings contract', async () => {
    const database = new FakeDatabase();
    const environment = testEnvironment();
    const app = createPlatformApp({ database, environment });
    const publicResponse = await app(
      new Request('https://api.example.com/v1/platform-settings', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    );
    await expect(publicResponse.json()).resolves.toEqual(platformSettings);

    const updateResponse = await app(
      authenticatedRequest('/v1/admin/platform-settings', {
        body: JSON.stringify({
          expectedRevision: platformSettings.revision,
          seo: platformSettings.seo,
          theme: platformSettings.theme,
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
        },
        method: 'PUT',
      }),
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual({
      ...platformSettings,
      revision: '1',
    });
  });

  it('verifies Stripe before durable idempotent webhook intake', async () => {
    const database = new FakeDatabase();
    const verifyWebhook = vi
      .fn<StripePort['verifyWebhook']>()
      .mockResolvedValue({
        id: 'evt_verified_001',
        livemode: false,
        type: 'checkout.session.completed',
      } as unknown as Stripe.Event);
    const stripe: StripePort = {
      createCheckout: vi.fn(),
      verifyWebhook,
    };
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      stripe,
    });
    const request = new Request('https://api.example.com/v1/webhooks/stripe', {
      body: '{"id":"evt_verified_001"}',
      headers: { 'Stripe-Signature': 'signed-value' },
      method: 'POST',
    });
    const first = await app(request);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      duplicate: false,
      received: true,
    });
    expect(verifyWebhook).toHaveBeenCalledOnce();

    database.stripeEventInserted = false;
    const duplicate = await app(
      new Request('https://api.example.com/v1/webhooks/stripe', {
        body: '{"id":"evt_verified_001"}',
        headers: { 'Stripe-Signature': 'signed-value' },
        method: 'POST',
      }),
    );
    await expect(duplicate.json()).resolves.toEqual({
      duplicate: true,
      received: true,
    });
  });
});
