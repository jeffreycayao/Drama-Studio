import { describe, expect, it } from 'vitest';

import { getCsrfToken } from '../src/http/auth.js';
import { createPlatformApp } from '../src/http/app.js';
import {
  adminGuide,
  adminSession,
  FakeDatabase,
  guideContent,
  publicGuide,
  testEnvironment,
  timestamp,
} from './helpers.js';

const bearerToken = 'a'.repeat(48);

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${bearerToken}`);
  return new Request(`https://api.example.com${path}`, { ...init, headers });
}

function guideBody(overrides: Record<string, unknown> = {}) {
  return {
    appId: 'grok-automator',
    content: guideContent,
    status: 'published',
    summary: 'A safe operating guide.',
    title: 'Grok Automator guide',
    ...overrides,
  };
}

describe('tool guide CMS routes', () => {
  it('returns only the current published guide on the public route', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({ database, environment: testEnvironment() });

    const published = await app(
      new Request('https://api.example.com/v1/guides/grok-automator'),
    );
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toEqual(publicGuide);

    database.guide = { ...adminGuide, publishedAt: null, status: 'draft' };
    const draft = await app(
      new Request('https://api.example.com/v1/guides/grok-automator'),
    );
    expect(draft.status).toBe(404);

    const invalid = await app(
      new Request('https://api.example.com/v1/guides/INVALID_SLUG'),
    );
    expect(invalid.status).toBe(404);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: 'not_found' },
    });
  });

  it('lists and reads draft-capable guide records only for an admin', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({ database, environment: testEnvironment() });

    const list = await app(adminRequest('/v1/admin/guides'));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({
      items: [
        {
          appId: adminGuide.appId,
          publishedAt: adminGuide.publishedAt,
          revision: adminGuide.revision,
          schemaVersion: 1,
          slug: adminGuide.slug,
          status: adminGuide.status,
          summary: adminGuide.summary,
          title: adminGuide.title,
          updatedAt: adminGuide.updatedAt,
        },
      ],
    });

    const detail = await app(adminRequest('/v1/admin/guides/grok-automator'));
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toEqual(adminGuide);
  });

  it('creates future tool guides with CSRF and rejects duplicate slugs', async () => {
    const database = new FakeDatabase();
    database.guide = null;
    const environment = testEnvironment();
    const app = createPlatformApp({
      database,
      environment,
      now: () => new Date(timestamp),
    });
    const body = JSON.stringify({ slug: 'future-tool', ...guideBody() });

    const noCsrf = await app(
      adminRequest('/v1/admin/guides', {
        body,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(noCsrf.status).toBe(403);
    expect(database.guide).toBeNull();

    const created = await app(
      adminRequest('/v1/admin/guides', {
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
        },
        method: 'POST',
      }),
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      revision: '0',
      slug: 'future-tool',
      status: 'published',
    });

    const duplicate = await app(
      adminRequest('/v1/admin/guides', {
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
        },
        method: 'POST',
      }),
    );
    expect(duplicate.status).toBe(409);
  });

  it('accepts a contract-valid guide body above the generic JSON limit', async () => {
    const database = new FakeDatabase();
    database.guide = null;
    const environment = testEnvironment();
    const app = createPlatformApp({ database, environment });
    const largeContent = {
      schemaVersion: 1,
      sections: [
        {
          id: 'large-section',
          title: 'Large section',
          blocks: Array.from({ length: 18 }, () => ({
            type: 'paragraph',
            text: '界'.repeat(5_000),
          })),
        },
      ],
    };
    const body = JSON.stringify({
      slug: 'large-guide',
      ...guideBody({ content: largeContent }),
    });
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(64 * 1_024);

    const response = await app(
      adminRequest('/v1/admin/guides', {
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(201);
  });

  it('updates with optimistic revision and distinguishes missing from stale', async () => {
    const database = new FakeDatabase();
    const environment = testEnvironment();
    const app = createPlatformApp({
      database,
      environment,
      now: () => new Date(timestamp),
    });
    const headers = {
      'Content-Type': 'application/json',
      'X-Faceless-CSRF': getCsrfToken(adminSession, environment),
    };
    const updated = await app(
      adminRequest('/v1/admin/guides/grok-automator', {
        body: JSON.stringify(
          guideBody({ expectedRevision: '0', status: 'draft' }),
        ),
        headers,
        method: 'PUT',
      }),
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      publishedAt: null,
      revision: '1',
      status: 'draft',
    });

    const stale = await app(
      adminRequest('/v1/admin/guides/grok-automator', {
        body: JSON.stringify(guideBody({ expectedRevision: '0' })),
        headers,
        method: 'PUT',
      }),
    );
    expect(stale.status).toBe(409);

    const missing = await app(
      adminRequest('/v1/admin/guides/missing-tool', {
        body: JSON.stringify(guideBody({ expectedRevision: '0' })),
        headers,
        method: 'PUT',
      }),
    );
    expect(missing.status).toBe(404);

    const malformedRevision = await app(
      adminRequest('/v1/admin/guides/grok-automator', {
        body: JSON.stringify(guideBody({ expectedRevision: 'abc' })),
        headers,
        method: 'PUT',
      }),
    );
    expect(malformedRevision.status).toBe(422);
  });
});
