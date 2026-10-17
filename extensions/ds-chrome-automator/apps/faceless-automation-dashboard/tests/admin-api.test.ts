import {
  ApiFailure,
  createAuthorizedPlatformApi,
  createPlatformApi,
} from '../src/admin/api';
import {
  adminSessionFixture,
  guideDocumentFixture,
  platformSettingsFixture,
  publicGuideFixture,
} from './admin-fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('platform admin API client', () => {
  it('fails closed without a configured API origin', async () => {
    const request = vi.fn<typeof fetch>();
    const api = createPlatformApi({
      origin: null,
      fetchImplementation: request,
    });

    await expect(api.getAdminSession()).rejects.toMatchObject({
      kind: 'not-configured',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('uses credentialed requests and validates the complete admin session', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(adminSessionFixture));
    const api = createPlatformApi({
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: request,
    });

    await expect(api.getAdminSession()).resolves.toEqual(adminSessionFixture);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://faceless-api.vercel.app/v1/admin/session',
    );
    expect(init).toMatchObject({ credentials: 'include', redirect: 'error' });
  });

  it('rejects malformed successful responses instead of inventing defaults', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ authenticated: true }));
    const api = createPlatformApi({
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: request,
    });

    await expect(api.getAdminSession()).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('maps authorization failures without exposing unvalidated data', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'forbidden',
            message: 'Administrator access required.',
            requestId: 'request-0001',
          },
        },
        403,
      ),
    );
    const api = createPlatformApi({
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: request,
    });

    await expect(api.getAdminSession()).rejects.toEqual(
      expect.objectContaining({
        kind: 'forbidden',
        requestId: 'request-0001',
      }),
    );
  });

  it('requires and sends the per-session CSRF token for mutations', async () => {
    const untrustedRequest = vi.fn<typeof fetch>();
    const untrustedApi = createPlatformApi({
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: untrustedRequest,
    });
    await expect(
      untrustedApi.updatePlatformSettings(platformSettingsFixture),
    ).rejects.toBeInstanceOf(ApiFailure);
    expect(untrustedRequest).not.toHaveBeenCalled();

    const trustedRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(platformSettingsFixture));
    const trustedApi = createAuthorizedPlatformApi(adminSessionFixture, {
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: trustedRequest,
    });
    await trustedApi.updatePlatformSettings(platformSettingsFixture);

    const [, init] = trustedRequest.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Faceless-CSRF')).toBe(adminSessionFixture.csrfToken);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('validates and forwards an opaque audit cursor', async () => {
    const cursor = 'A'.repeat(64);
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [],
        nextCursor: null,
      }),
    );
    const api = createPlatformApi({
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: request,
    });

    await expect(api.listAuditEvents(cursor)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(String(request.mock.calls[0]?.[0])).toBe(
      `https://faceless-api.vercel.app/v1/admin/audit-events?cursor=${cursor}`,
    );

    request.mockClear();
    await expect(api.listAuditEvents('short')).rejects.toMatchObject({
      kind: 'request-failed',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('verifies an extension user code with its matching web-session CSRF token', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        schemaVersion: 2,
        flowId: 'extension_flow_0001',
        status: 'verified',
        attemptsRemaining: 4,
      }),
    );
    const api = createPlatformApi({
      origin: 'https://faceless-api.vercel.app',
      fetchImplementation: request,
    });
    const csrfToken = 'c'.repeat(32);

    await expect(
      api.verifyExtensionAuthFlow(
        'extension_flow_0001',
        'abcd-2345',
        csrfToken,
      ),
    ).resolves.toMatchObject({ status: 'verified', attemptsRemaining: 4 });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://faceless-api.vercel.app/v1/auth/extension-flows/extension_flow_0001/verify',
    );
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({ schemaVersion: 2, userCode: 'ABCD-2345' }),
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Faceless-CSRF')).toBe(csrfToken);
  });

  it('loads only a strictly validated public guide at the encoded slug route', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(publicGuideFixture));
    const api = createPlatformApi({
      origin: 'https://paks-tools.vercel.app',
      fetchImplementation: request,
    });

    await expect(api.getPublicGuide('grok-automator')).resolves.toEqual(
      publicGuideFixture,
    );
    expect(String(request.mock.calls[0]?.[0])).toBe(
      'https://paks-tools.vercel.app/v1/guides/grok-automator',
    );

    request.mockClear();
    await expect(api.getPublicGuide('Invalid Slug')).rejects.toMatchObject({
      kind: 'not-found',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps missing public guides without conflating them with API downtime', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'not_found',
            message: 'Guide was not found',
            requestId: 'request-guide-0001',
          },
        },
        404,
      ),
    );
    const api = createPlatformApi({
      origin: 'https://paks-tools.vercel.app',
      fetchImplementation: request,
    });

    await expect(api.getPublicGuide('grok-automator')).rejects.toMatchObject({
      kind: 'not-found',
      requestId: 'request-guide-0001',
    });
  });

  it('creates a future-tool guide with session CSRF and no invented revision', async () => {
    const created = {
      ...guideDocumentFixture,
      revision: '0',
      slug: 'future-tool',
      appId: 'future-tool',
      title: 'Future Tool guide',
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(created, 201));
    const api = createAuthorizedPlatformApi(adminSessionFixture, {
      origin: 'https://paks-tools.vercel.app',
      fetchImplementation: request,
    });

    await api.createGuide({
      slug: created.slug,
      appId: created.appId,
      title: created.title,
      summary: created.summary,
      status: created.status,
      content: created.content,
    });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://paks-tools.vercel.app/v1/admin/guides');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      slug: created.slug,
      appId: created.appId,
      title: created.title,
      summary: created.summary,
      status: created.status,
      content: created.content,
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Faceless-CSRF')).toBe(adminSessionFixture.csrfToken);
  });

  it('updates a guide with its exact optimistic revision and maps conflicts', async () => {
    const updated = { ...guideDocumentFixture, revision: '4' };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(updated));
    const api = createAuthorizedPlatformApi(adminSessionFixture, {
      origin: 'https://paks-tools.vercel.app',
      fetchImplementation: request,
    });
    const input = {
      expectedRevision: guideDocumentFixture.revision,
      appId: guideDocumentFixture.appId,
      title: guideDocumentFixture.title,
      summary: guideDocumentFixture.summary,
      status: guideDocumentFixture.status,
      content: guideDocumentFixture.content,
    } as const;

    await expect(api.updateGuide('grok-automator', input)).resolves.toEqual(
      updated,
    );
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://paks-tools.vercel.app/v1/admin/guides/grok-automator',
    );
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(new Headers(init?.headers).get('X-Faceless-CSRF')).toBe(
      adminSessionFixture.csrfToken,
    );

    request.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'conflict',
            message: 'Guide changed; refresh and retry',
            requestId: 'request-guide-conflict',
          },
        },
        409,
      ),
    );
    await expect(
      api.updateGuide('grok-automator', input),
    ).rejects.toMatchObject({
      kind: 'conflict',
      requestId: 'request-guide-conflict',
    });
  });
});
