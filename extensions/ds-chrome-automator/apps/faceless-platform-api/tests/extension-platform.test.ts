import {
  apiErrorEnvelopeSchema,
  createExtensionAuthFlowResponseV1Schema,
  createExtensionAuthFlowResponseSchema,
  exchangeExtensionAuthFlowResponseV1Schema,
  exchangeExtensionAuthFlowResponseSchema,
  extensionAuthFlowPageResponseV1Schema,
  opaqueIdSchema,
  usageAuthorizationResponseSchema,
  usageReservationResponseSchema,
  usageReservationTransitionResponseSchema,
  verifyExtensionAuthFlowResponseSchema,
} from '@faceless-automations/platform-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createPkceChallenge } from '../src/core/crypto.js';
import { getCsrfToken } from '../src/http/auth.js';
import { createPlatformApp } from '../src/http/app.js';
import type { GoogleIdentityPort } from '../src/ports/providers.js';
import { extensionFlowPageResponseSchema } from '../src/schemas/extension.js';
import {
  adminSession,
  FakeDatabase,
  testEnvironment,
  timestamp,
} from './helpers.js';

const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const secondExtensionOrigin = `chrome-extension://${'b'.repeat(32)}`;
const codeVerifier = 'v'.repeat(64);
const wrongCodeVerifier = 'w'.repeat(64);
const usagePath = '/v1/apps/grok-automator/usage/reservations';

type PlatformApp = ReturnType<typeof createPlatformApp>;

function extensionRequest(
  path: string,
  init: RequestInit = {},
  origin = extensionOrigin,
): Request {
  const headers = new Headers(init.headers);
  headers.set('Origin', origin);
  if (init.body !== undefined && init.body !== null) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(`https://api.example.com${path}`, { ...init, headers });
}

function environmentWithSecondOrigin(): NodeJS.ProcessEnv {
  const environment = testEnvironment();
  environment.PUBLIC_EXTENSION_REGISTRATIONS_JSON = JSON.stringify([
    {
      appId: 'grok-automator',
      environment: 'development',
      origin: extensionOrigin,
    },
    {
      appId: 'grok-automator',
      environment: 'development',
      origin: secondExtensionOrigin,
    },
  ]);
  return environment;
}

function googleEnvironment(): NodeJS.ProcessEnv {
  return {
    ...testEnvironment(),
    GOOGLE_CLIENT_ID: 'google-client-id-for-extension-tests',
    GOOGLE_CLIENT_SECRET: 'google-client-secret-for-extension-tests',
    GOOGLE_OAUTH_REDIRECT_URI:
      'https://api.example.com/v1/auth/google/callback',
    OAUTH_TRANSIENT_KEY: 'o'.repeat(48),
  };
}

async function createFlow(app: PlatformApp) {
  const response = await app(
    extensionRequest('/v1/auth/extension-flows', {
      body: JSON.stringify({
        schemaVersion: 2,
        appId: 'grok-automator',
        codeChallenge: createPkceChallenge(codeVerifier),
        codeChallengeMethod: 'S256',
        provider: 'google',
      }),
      method: 'POST',
    }),
  );
  expect(response.status).toBe(201);
  const flow = createExtensionAuthFlowResponseSchema.parse(
    await response.json(),
  );
  return flow;
}

async function createLegacyFlow(app: PlatformApp) {
  const response = await app(
    extensionRequest('/v1/auth/extension-flows', {
      body: JSON.stringify({
        appId: 'grok-automator',
        codeChallenge: createPkceChallenge(codeVerifier),
        codeChallengeMethod: 'S256',
        provider: 'google',
      }),
      method: 'POST',
    }),
  );
  expect(response.status).toBe(201);
  return createExtensionAuthFlowResponseV1Schema.parse(await response.json());
}

async function bindAndVerifyFlow(
  app: PlatformApp,
  database: FakeDatabase,
  flow: Awaited<ReturnType<typeof createFlow>>,
) {
  const grant = database.extensionSessionGrant;
  if (grant === null) throw new Error('The fake session grant is unavailable');
  const webSession = {
    ...database.session!,
    userId: grant.userId,
  };
  database.session = webSession;
  await expect(
    database.completeExtensionGoogleCallback({
      flowId: flow.flowId,
      now: timestamp,
      userId: grant.userId,
    }),
  ).resolves.toEqual({ protocolVersion: 2, status: 'bound' });
  const verification = await app(
    extensionRequest(
      `/v1/auth/extension-flows/${flow.flowId}/verify`,
      {
        body: JSON.stringify({
          schemaVersion: 2,
          userCode: flow.userCode,
        }),
        headers: {
          Cookie: `__Host-fa_session=${'s'.repeat(32)}`,
          'X-Faceless-CSRF': getCsrfToken(webSession, testEnvironment()),
        },
        method: 'POST',
      },
      'https://app.example.com',
    ),
  );
  expect(verification.status).toBe(200);
  expect(
    verifyExtensionAuthFlowResponseSchema.parse(await verification.json()),
  ).toMatchObject({ flowId: flow.flowId, status: 'verified' });
}

async function verifyAndExchangeBoundFlow(
  app: PlatformApp,
  database: FakeDatabase,
  flow: Awaited<ReturnType<typeof createFlow>>,
  webSession: typeof adminSession,
  environment: NodeJS.ProcessEnv,
) {
  database.session = webSession;
  const grant = database.extensionSessionGrant;
  if (grant === null) throw new Error('The fake session grant is unavailable');
  database.extensionSessionGrant = { ...grant, userId: webSession.userId };

  const statusResponse = await app(
    new Request(
      `https://api.example.com/v1/auth/extension-flows/${flow.flowId}`,
      {
        headers: {
          Cookie: `__Host-fa_session=${'s'.repeat(32)}`,
          Origin: 'https://app.example.com',
        },
      },
    ),
  );
  const status = extensionFlowPageResponseSchema.parse(
    await statusResponse.json(),
  );
  expect(status.status).toBe('verification_required');
  if (status.csrfToken === null) {
    throw new Error('Expected a bound flow CSRF token');
  }
  const verification = await app(
    extensionRequest(
      `/v1/auth/extension-flows/${flow.flowId}/verify`,
      {
        body: JSON.stringify({
          schemaVersion: 2,
          userCode: flow.userCode,
        }),
        headers: {
          Cookie: `__Host-fa_session=${'s'.repeat(32)}`,
          'X-Faceless-CSRF': getCsrfToken(webSession, environment),
        },
        method: 'POST',
      },
      'https://app.example.com',
    ),
  );
  expect(verification.status).toBe(200);

  const exchange = await app(
    extensionRequest(`/v1/auth/extension-flows/${flow.flowId}/exchange`, {
      body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
      method: 'POST',
    }),
  );
  expect(exchange.status).toBe(200);
  expect(
    exchangeExtensionAuthFlowResponseSchema.parse(await exchange.json()).status,
  ).toBe('authorized');
}

async function issueExtensionSession(app: PlatformApp, database: FakeDatabase) {
  const flow = await createFlow(app);
  await bindAndVerifyFlow(app, database, flow);
  const response = await app(
    extensionRequest(`/v1/auth/extension-flows/${flow.flowId}/exchange`, {
      body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
      method: 'POST',
    }),
  );
  expect(response.status).toBe(200);
  const exchange = exchangeExtensionAuthFlowResponseSchema.parse(
    await response.json(),
  );
  if (exchange.status !== 'authorized') {
    throw new Error('Expected the extension flow to be authorized');
  }
  return exchange;
}

function usageRequest(
  accessToken: string | null,
  input: {
    idempotencyKey?: string;
    operation?: string;
    origin?: string;
    units?: number;
  } = {},
): Request {
  const headers = new Headers();
  if (accessToken !== null) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return extensionRequest(
    usagePath,
    {
      body: JSON.stringify({
        appId: 'grok-automator',
        idempotencyKey: input.idempotencyKey ?? 'run_request_0000001',
        operation: input.operation ?? 'automation.run',
        schemaVersion: 2,
        units: input.units ?? 1,
      }),
      headers,
      method: 'POST',
    },
    input.origin,
  );
}

describe('extension platform routes', () => {
  it('creates only exact registered app/origin flows and exposes a safe status view', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const body = JSON.stringify({
      appId: 'grok-automator',
      codeChallenge: createPkceChallenge(codeVerifier),
      codeChallengeMethod: 'S256',
      provider: 'google',
    });

    const unregisteredOrigin = await app(
      extensionRequest(
        '/v1/auth/extension-flows',
        { body, method: 'POST' },
        secondExtensionOrigin,
      ),
    );
    expect(unregisteredOrigin.status).toBe(403);
    expect(
      apiErrorEnvelopeSchema.parse(await unregisteredOrigin.json()).error.code,
    ).toBe('forbidden');

    const mismatchedApp = await app(
      extensionRequest('/v1/auth/extension-flows', {
        body: JSON.stringify({
          appId: 'another-app',
          codeChallenge: createPkceChallenge(codeVerifier),
          codeChallengeMethod: 'S256',
          provider: 'google',
        }),
        method: 'POST',
      }),
    );
    expect(mismatchedApp.status).toBe(403);
    expect(database.extensionFlow).toBeNull();

    const created = await createFlow(app);
    expect(created).toMatchObject({
      authorizationUrl: `https://app.example.com/auth/extension/${created.flowId}`,
      expiresAt: '2026-08-16T00:10:00.000Z',
      flowId: created.flowId,
      pollIntervalSeconds: 2,
      provider: 'google',
      schemaVersion: 2,
    });
    expect(created.userCode).toMatch(/^[23456789A-Z]{4}-[23456789A-Z]{4}$/u);
    expect(database.extensionFlow).toMatchObject({
      appId: 'grok-automator',
      codeChallenge: createPkceChallenge(codeVerifier),
      expiresAt: created.expiresAt,
      extensionOrigin,
      flowId: created.flowId,
      initiatorVerifiedAt: null,
      status: 'pending',
      verificationAttempts: 0,
    });
    expect(database.extensionFlow?.userCodeHash).not.toBe(created.userCode);

    const statusResponse = await app(
      new Request(
        `https://api.example.com/v1/auth/extension-flows/${created.flowId}`,
        { headers: { Origin: 'https://app.example.com' } },
      ),
    );
    expect(statusResponse.status).toBe(200);
    const status = extensionFlowPageResponseSchema.parse(
      await statusResponse.json(),
    );
    expect(status).toEqual({
      appDisplayName: 'Grok Automator™',
      appId: 'grok-automator',
      expiresAt: created.expiresAt,
      flowId: created.flowId,
      schemaVersion: 2,
      csrfToken: null,
      status: 'pending',
      verificationAttemptsRemaining: 5,
    });
    expect(Object.keys(status).sort()).toEqual([
      'appDisplayName',
      'appId',
      'csrfToken',
      'expiresAt',
      'flowId',
      'schemaVersion',
      'status',
      'verificationAttemptsRemaining',
    ]);
  });

  it('preserves exact v1 auth only for v1-created flows and rejects protocol confusion', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const legacy = await createLegacyFlow(app);
    expect(legacy).toEqual({
      authorizationUrl: `https://app.example.com/auth/extension/${legacy.flowId}`,
      expiresAt: '2026-08-16T00:10:00.000Z',
      flowId: legacy.flowId,
      pollIntervalSeconds: 2,
      provider: 'google',
    });
    expect(database.extensionFlow?.protocolVersion).toBe(1);

    const pending = await app(
      new Request(
        `https://api.example.com/v1/auth/extension-flows/${legacy.flowId}`,
        { headers: { Origin: 'https://app.example.com' } },
      ),
    );
    expect(
      extensionAuthFlowPageResponseV1Schema.parse(await pending.json()),
    ).toEqual({
      appDisplayName: 'Grok Automator™',
      appId: 'grok-automator',
      expiresAt: legacy.expiresAt,
      flowId: legacy.flowId,
      schemaVersion: 1,
      status: 'pending',
    });

    const verifyLegacy = await app(
      extensionRequest(
        `/v1/auth/extension-flows/${legacy.flowId}/verify`,
        {
          body: JSON.stringify({
            schemaVersion: 2,
            userCode: '2345-6789',
          }),
          method: 'POST',
        },
        'https://app.example.com',
      ),
    );
    expect(verifyLegacy.status).toBe(409);

    const grant = database.extensionSessionGrant;
    if (grant === null) throw new Error('Expected a fake extension grant');
    await expect(
      database.completeExtensionGoogleCallback({
        flowId: legacy.flowId,
        now: timestamp,
        userId: grant.userId,
      }),
    ).resolves.toEqual({ protocolVersion: 1, status: 'bound' });
    const confusedV2 = await app(
      extensionRequest(`/v1/auth/extension-flows/${legacy.flowId}/exchange`, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(confusedV2.status).toBe(422);

    const exchanged = await app(
      extensionRequest(`/v1/auth/extension-flows/${legacy.flowId}/exchange`, {
        body: JSON.stringify({ codeVerifier }),
        method: 'POST',
      }),
    );
    expect(exchanged.status).toBe(200);
    const legacyExchange = exchangeExtensionAuthFlowResponseV1Schema.parse(
      await exchanged.json(),
    );
    expect(legacyExchange.status).toBe('authorized');
    expect('schemaVersion' in legacyExchange).toBe(false);

    const strictDatabase = new FakeDatabase();
    const strictApp = createPlatformApp({
      database: strictDatabase,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const strictFlow = await createFlow(strictApp);
    await bindAndVerifyFlow(strictApp, strictDatabase, strictFlow);
    const confusedV1 = await strictApp(
      extensionRequest(
        `/v1/auth/extension-flows/${strictFlow.flowId}/exchange`,
        {
          body: JSON.stringify({ codeVerifier }),
          method: 'POST',
        },
      ),
    );
    expect(confusedV1.status).toBe(422);
  });

  it('preserves v1 pending-flow denial when Google authorization is cancelled', async () => {
    const database = new FakeDatabase();
    const environment = googleEnvironment();
    const google: GoogleIdentityPort = {
      createAuthorizationUrl(input) {
        return `https://accounts.example.test/authorize?state=${input.state}`;
      },
      async exchangeAndVerify() {
        throw new Error('A cancellation must not exchange a Google code');
      },
    };
    const app = createPlatformApp({
      database,
      environment,
      google,
      now: () => new Date(timestamp),
    });
    const flow = await createLegacyFlow(app);
    const start = await app(
      new Request(
        `https://api.example.com/v1/auth/google/start?client=extension&flowId=${flow.flowId}`,
      ),
    );
    const authorizationLocation = start.headers.get('location');
    if (authorizationLocation === null) {
      throw new Error('Expected an OAuth authorization redirect');
    }
    const oauthState = new URL(authorizationLocation).searchParams.get('state');
    if (oauthState === null) throw new Error('Expected an OAuth state');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const callback = await app(
        new Request(
          `https://api.example.com/v1/auth/google/callback?error=access_denied&state=${oauthState}`,
          { headers: { Cookie: `__Host-fa_oauth_state=${oauthState}` } },
        ),
      );
      expect(callback.status).toBe(302);
    } finally {
      errorLog.mockRestore();
    }
    expect(database.extensionFlow).toMatchObject({
      protocolVersion: 1,
      status: 'denied',
      userId: null,
    });

    const exchange = await app(
      extensionRequest(`/v1/auth/extension-flows/${flow.flowId}/exchange`, {
        body: JSON.stringify({ codeVerifier }),
        method: 'POST',
      }),
    );
    expect(exchange.status).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(await exchange.json()).error.code).toBe(
      'auth_flow_denied',
    );
  });

  it('fails legacy flow allocation closed at the compatibility sunset', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      now: () => new Date('2026-11-30T00:00:00.000Z'),
    });
    const response = await app(
      extensionRequest('/v1/auth/extension-flows', {
        body: JSON.stringify({
          appId: 'grok-automator',
          codeChallenge: createPkceChallenge(codeVerifier),
          codeChallengeMethod: 'S256',
          provider: 'google',
        }),
        method: 'POST',
      }),
    );

    expect(response.status).toBe(426);
    expect(apiErrorEnvelopeSchema.parse(await response.json()).error.code).toBe(
      'upgrade_required',
    );
    expect(database.extensionFlow).toBeNull();
  });

  it('requires the independent user code and locks after five failed attempts', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const flow = await createFlow(app);
    const replacement = flow.userCode.startsWith('A') ? 'B' : 'A';
    const wrongCode = `${replacement}${flow.userCode.slice(1)}`;
    const verifyPath = `/v1/auth/extension-flows/${flow.flowId}/verify`;
    const rawCreator = await app(
      extensionRequest(
        verifyPath,
        {
          body: JSON.stringify({
            schemaVersion: 2,
            userCode: flow.userCode,
          }),
          method: 'POST',
        },
        'https://app.example.com',
      ),
    );
    expect(rawCreator.status).toBe(401);
    await expect(
      database.completeExtensionGoogleCallback({
        flowId: flow.flowId,
        now: timestamp,
        userId: adminSession.userId,
      }),
    ).resolves.toEqual({ protocolVersion: 2, status: 'bound' });
    const boundHeaders = {
      Cookie: `__Host-fa_session=${'s'.repeat(32)}`,
      'X-Faceless-CSRF': getCsrfToken(adminSession, testEnvironment()),
    };
    const otherSession = {
      ...adminSession,
      sessionId: 'session_identifier_0002',
      userId: 'different_user_identifier_0002',
    };
    database.session = otherSession;
    const wrongUser = await app(
      extensionRequest(
        verifyPath,
        {
          body: JSON.stringify({
            schemaVersion: 2,
            userCode: flow.userCode,
          }),
          headers: {
            Cookie: `__Host-fa_session=${'t'.repeat(32)}`,
            'X-Faceless-CSRF': getCsrfToken(otherSession, testEnvironment()),
          },
          method: 'POST',
        },
        'https://app.example.com',
      ),
    );
    expect(wrongUser.status).toBe(403);
    database.session = adminSession;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app(
        extensionRequest(
          verifyPath,
          {
            body: JSON.stringify({
              schemaVersion: 2,
              userCode: wrongCode,
            }),
            headers: boundHeaders,
            method: 'POST',
          },
          'https://app.example.com',
        ),
      );
      expect(response.status).toBe(401);
    }
    expect(database.extensionFlow).toMatchObject({
      status: 'denied',
      verificationAttempts: 5,
    });
    const locked = await app(
      extensionRequest(
        verifyPath,
        {
          body: JSON.stringify({
            schemaVersion: 2,
            userCode: flow.userCode,
          }),
          headers: boundHeaders,
          method: 'POST',
        },
        'https://app.example.com',
      ),
    );
    expect(locked.status).toBe(410);
  });

  it('fails flow allocation closed for rate and concurrency limits', async () => {
    const rateLimitedDatabase = new FakeDatabase();
    rateLimitedDatabase.rateLimitsAllowed = false;
    const rateLimitedApp = createPlatformApp({
      database: rateLimitedDatabase,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const requestBody = JSON.stringify({
      appId: 'grok-automator',
      codeChallenge: createPkceChallenge(codeVerifier),
      codeChallengeMethod: 'S256',
      provider: 'google',
      schemaVersion: 2,
    });
    const limited = await rateLimitedApp(
      extensionRequest('/v1/auth/extension-flows', {
        body: requestBody,
        method: 'POST',
      }),
    );
    expect(limited.status).toBe(429);
    expect(rateLimitedDatabase.extensionFlow).toBeNull();

    const cappedDatabase = new FakeDatabase();
    cappedDatabase.extensionFlowCreationAllowed = false;
    const cappedApp = createPlatformApp({
      database: cappedDatabase,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const capped = await cappedApp(
      extensionRequest('/v1/auth/extension-flows', {
        body: requestBody,
        method: 'POST',
      }),
    );
    expect(capped.status).toBe(429);
    expect(cappedDatabase.extensionFlow).toBeNull();
  });

  it('binds exchange to PKCE and consumes an authorized flow exactly once', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const flow = await createFlow(app);
    const exchangePath = `/v1/auth/extension-flows/${flow.flowId}/exchange`;

    const pendingResponse = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(pendingResponse.status).toBe(409);
    expect(
      apiErrorEnvelopeSchema.parse(await pendingResponse.json()).error.code,
    ).toBe('conflict');

    const pendingFlow = database.extensionFlow;
    if (pendingFlow === null) throw new Error('Expected a pending flow');
    database.extensionFlow = { ...pendingFlow, status: 'denied' };
    const deniedResponse = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(deniedResponse.status).toBe(403);
    expect(
      apiErrorEnvelopeSchema.parse(await deniedResponse.json()).error.code,
    ).toBe('auth_flow_denied');

    database.extensionFlow = { ...pendingFlow, expiresAt: timestamp };
    const expiredResponse = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(expiredResponse.status).toBe(410);
    expect(
      apiErrorEnvelopeSchema.parse(await expiredResponse.json()).error.code,
    ).toBe('auth_flow_expired');

    database.extensionFlow = pendingFlow;

    await bindAndVerifyFlow(app, database, flow);
    const invalidProof = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({
          codeVerifier: wrongCodeVerifier,
          schemaVersion: 2,
        }),
        method: 'POST',
      }),
    );
    expect(invalidProof.status).toBe(401);
    expect(
      apiErrorEnvelopeSchema.parse(await invalidProof.json()).error.code,
    ).toBe('unauthorized');
    expect(database.extensionFlow.status).toBe('authorized');

    const authorizedResponse = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(authorizedResponse.status).toBe(200);
    const authorized = exchangeExtensionAuthFlowResponseSchema.parse(
      await authorizedResponse.json(),
    );
    expect(authorized.status).toBe('authorized');
    if (authorized.status !== 'authorized') {
      throw new Error('Expected an authorized exchange response');
    }
    expect(authorized).toEqual({
      accessToken: authorized.accessToken,
      expiresInSeconds: 900,
      session: {
        access: {
          appId: 'grok-automator',
          capabilities: ['automation.run', 'automation.pro'],
          planCode: 'single-license',
        },
        account: {
          displayName: 'Extension User',
          email: 'extension-user@example.com',
          emailVerified: true,
          provider: 'google',
          userId: 'extension_user_identifier_0001',
        },
        expiresAt: '2026-08-16T00:15:00.000Z',
        issuedAt: timestamp,
        schemaVersion: 1,
        sessionId: authorized.session.sessionId,
      },
      schemaVersion: 2,
      status: 'authorized',
      tokenType: 'Bearer',
    });
    expect(database.extensionFlow.status).toBe('consumed');
    expect(database.appSession).toMatchObject({
      appId: 'grok-automator',
      extensionOrigin,
      status: 'active',
      userId: 'extension_user_identifier_0001',
    });
    expect(database.appSessionTokenHash).not.toBe(authorized.accessToken);

    const replay = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(replay.status).toBe(409);
    expect(apiErrorEnvelopeSchema.parse(await replay.json()).error.code).toBe(
      'auth_flow_consumed',
    );
  });

  it('does not consume a flow from a different registered extension origin', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: environmentWithSecondOrigin(),
      now: () => new Date(timestamp),
    });
    const flow = await createFlow(app);
    await bindAndVerifyFlow(app, database, flow);
    const exchangePath = `/v1/auth/extension-flows/${flow.flowId}/exchange`;

    const wrongOrigin = await app(
      extensionRequest(
        exchangePath,
        {
          body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
          method: 'POST',
        },
        secondExtensionOrigin,
      ),
    );
    expect(wrongOrigin.status).toBe(403);
    expect(
      apiErrorEnvelopeSchema.parse(await wrongOrigin.json()).error.code,
    ).toBe('forbidden');
    expect(database.extensionFlow).toMatchObject({ status: 'authorized' });

    const ownerOrigin = await app(
      extensionRequest(exchangePath, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(ownerOrigin.status).toBe(200);
    expect(
      exchangeExtensionAuthFlowResponseSchema.parse(await ownerOrigin.json())
        .status,
    ).toBe('authorized');
  });

  it('binds Google OAuth to a pending extension flow and clean-redirects the callback', async () => {
    const database = new FakeDatabase();
    const createAuthorizationUrl = vi.fn<
      GoogleIdentityPort['createAuthorizationUrl']
    >((input) => {
      const target = new URL('https://accounts.example.test/authorize');
      target.searchParams.set('state', input.state);
      return target.toString();
    });
    const exchangeAndVerify = vi
      .fn<GoogleIdentityPort['exchangeAndVerify']>()
      .mockResolvedValue({
        displayName: 'Signed In User',
        email: 'signed-in@example.com',
        issuer: 'https://accounts.google.com',
        subject: 'google-extension-subject',
      });
    const google: GoogleIdentityPort = {
      createAuthorizationUrl,
      exchangeAndVerify,
    };
    const app = createPlatformApp({
      database,
      environment: googleEnvironment(),
      google,
      now: () => new Date(timestamp),
    });
    const flow = await createFlow(app);
    const storedFlow = database.extensionFlow;
    if (storedFlow === null)
      throw new Error('Expected a stored extension flow');

    database.extensionFlow = { ...storedFlow, status: 'authorized' };
    const alreadyAuthorized = await app(
      new Request(
        `https://api.example.com/v1/auth/google/start?client=extension&flowId=${flow.flowId}`,
      ),
    );
    expect(alreadyAuthorized.status).toBe(410);
    expect(
      apiErrorEnvelopeSchema.parse(await alreadyAuthorized.json()).error.code,
    ).toBe('auth_flow_expired');

    database.extensionFlow = {
      ...storedFlow,
      expiresAt: timestamp,
      status: 'pending',
    };
    const expired = await app(
      new Request(
        `https://api.example.com/v1/auth/google/start?client=extension&flowId=${flow.flowId}`,
      ),
    );
    expect(expired.status).toBe(410);
    expect(apiErrorEnvelopeSchema.parse(await expired.json()).error.code).toBe(
      'auth_flow_expired',
    );

    database.extensionFlow = storedFlow;
    const start = await app(
      new Request(
        `https://api.example.com/v1/auth/google/start?client=extension&flowId=${flow.flowId}`,
      ),
    );
    expect(start.status).toBe(302);
    expect(createAuthorizationUrl).toHaveBeenCalledOnce();
    expect(database.oauthFlow).toMatchObject({
      client: 'extension',
      extensionFlowId: flow.flowId,
    });
    const authorizationLocation = start.headers.get('location');
    if (authorizationLocation === null) {
      throw new Error('Expected a Google authorization redirect');
    }
    const oauthState = new URL(authorizationLocation).searchParams.get('state');
    if (oauthState === null) throw new Error('Expected an OAuth state');
    expect(database.oauthFlow?.stateHash).not.toBe(oauthState);

    const callback = await app(
      new Request(
        `https://api.example.com/v1/auth/google/callback?code=${'c'.repeat(32)}&state=${oauthState}`,
        { headers: { Cookie: `__Host-fa_oauth_state=${oauthState}` } },
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(
      `https://app.example.com/auth/extension/${flow.flowId}`,
    );
    const callbackLocation = new URL(callback.headers.get('location') ?? '');
    expect(callbackLocation.search).toBe('');
    expect(callbackLocation.hash).toBe('');
    expect(database.extensionFlow).toMatchObject({
      initiatorVerifiedAt: null,
      status: 'pending',
      userId: adminSession.userId,
    });
    expect(database.extensionFlowUserId).toBe('user_identifier_000001');
    expect(exchangeAndVerify).toHaveBeenCalledOnce();
    expect(database.oauthFlow).toBeNull();
    const boundStatusResponse = await app(
      new Request(
        `https://api.example.com/v1/auth/extension-flows/${flow.flowId}`,
        {
          headers: {
            Cookie: `__Host-fa_session=${'s'.repeat(32)}`,
            Origin: 'https://app.example.com',
          },
        },
      ),
    );
    const boundStatus = extensionFlowPageResponseSchema.parse(
      await boundStatusResponse.json(),
    );
    expect(boundStatus).toMatchObject({
      csrfToken: getCsrfToken(adminSession, googleEnvironment()),
      status: 'verification_required',
    });
    const callbackOnlyExchange = await app(
      extensionRequest(`/v1/auth/extension-flows/${flow.flowId}/exchange`, {
        body: JSON.stringify({ codeVerifier, schemaVersion: 2 }),
        method: 'POST',
      }),
    );
    expect(callbackOnlyExchange.status).toBe(409);
    if (boundStatus.csrfToken === null) {
      throw new Error('Expected a flow-scoped CSRF token');
    }
    const verified = await app(
      extensionRequest(
        `/v1/auth/extension-flows/${flow.flowId}/verify`,
        {
          body: JSON.stringify({
            schemaVersion: 2,
            userCode: flow.userCode,
          }),
          headers: {
            Cookie: `__Host-fa_session=${'s'.repeat(32)}`,
            'X-Faceless-CSRF': boundStatus.csrfToken,
          },
          method: 'POST',
        },
        'https://app.example.com',
      ),
    );
    expect(verified.status).toBe(200);
    expect(database.extensionFlow).toMatchObject({ status: 'authorized' });
  });

  it('preserves the first bound identity when a competing callback resolves as another user', async () => {
    const database = new FakeDatabase();
    const environment = googleEnvironment();
    const google: GoogleIdentityPort = {
      createAuthorizationUrl(input) {
        return `https://accounts.example.test/authorize?state=${input.state}`;
      },
      async exchangeAndVerify() {
        return {
          displayName: 'Competing User',
          email: 'competing@example.com',
          issuer: 'https://accounts.google.com',
          subject: 'google-competing-subject',
        };
      },
    };
    const app = createPlatformApp({
      database,
      environment,
      google,
      now: () => new Date(timestamp),
    });
    const flow = await createFlow(app);
    const start = await app(
      new Request(
        `https://api.example.com/v1/auth/google/start?client=extension&flowId=${flow.flowId}`,
      ),
    );
    const authorizationLocation = start.headers.get('location');
    if (authorizationLocation === null) {
      throw new Error('Expected an OAuth authorization redirect');
    }
    const oauthState = new URL(authorizationLocation).searchParams.get('state');
    if (oauthState === null) throw new Error('Expected an OAuth state');

    const firstSession = {
      ...adminSession,
      displayName: 'First User',
      email: 'first@example.com',
      googleSubject: 'google-first-subject',
      sessionId: 'first_session_identifier_0001',
      userId: 'extension_user_identifier_0001',
    };
    await expect(
      database.completeExtensionGoogleCallback({
        flowId: flow.flowId,
        now: timestamp,
        userId: firstSession.userId,
      }),
    ).resolves.toEqual({ protocolVersion: 2, status: 'bound' });
    const competingSession = {
      ...adminSession,
      displayName: 'Competing User',
      email: 'competing@example.com',
      googleSubject: 'google-competing-subject',
      sessionId: 'competing_session_identifier_0002',
      userId: 'competing_user_identifier_0002',
    };
    database.googleSession = competingSession;

    const callback = await app(
      new Request(
        `https://api.example.com/v1/auth/google/callback?code=${'c'.repeat(32)}&state=${oauthState}`,
        { headers: { Cookie: `__Host-fa_oauth_state=${oauthState}` } },
      ),
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.getSetCookie().join(';')).not.toContain(
      '__Host-fa_session=',
    );
    expect(database.revokedSessionIds).toContain(competingSession.sessionId);
    expect(database.extensionFlow).toMatchObject({
      initiatorVerifiedAt: null,
      status: 'pending',
      userId: firstSession.userId,
    });

    await verifyAndExchangeBoundFlow(
      app,
      database,
      flow,
      firstSession,
      environment,
    );
  });

  it('does not let a later OAuth cancellation deny an already-bound v2 flow', async () => {
    const database = new FakeDatabase();
    const environment = googleEnvironment();
    const google: GoogleIdentityPort = {
      createAuthorizationUrl(input) {
        return `https://accounts.example.test/authorize?state=${input.state}`;
      },
      async exchangeAndVerify() {
        throw new Error('A cancellation must not exchange a Google code');
      },
    };
    const app = createPlatformApp({
      database,
      environment,
      google,
      now: () => new Date(timestamp),
    });
    const flow = await createFlow(app);
    const start = await app(
      new Request(
        `https://api.example.com/v1/auth/google/start?client=extension&flowId=${flow.flowId}`,
      ),
    );
    const authorizationLocation = start.headers.get('location');
    if (authorizationLocation === null) {
      throw new Error('Expected an OAuth authorization redirect');
    }
    const oauthState = new URL(authorizationLocation).searchParams.get('state');
    if (oauthState === null) throw new Error('Expected an OAuth state');
    const firstSession = {
      ...adminSession,
      displayName: 'First User',
      email: 'first@example.com',
      googleSubject: 'google-first-subject',
      sessionId: 'first_session_identifier_0001',
      userId: 'extension_user_identifier_0001',
    };
    await database.completeExtensionGoogleCallback({
      flowId: flow.flowId,
      now: timestamp,
      userId: firstSession.userId,
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let callback: Response;
    try {
      callback = await app(
        new Request(
          `https://api.example.com/v1/auth/google/callback?error=access_denied&state=${oauthState}`,
          { headers: { Cookie: `__Host-fa_oauth_state=${oauthState}` } },
        ),
      );
    } finally {
      errorLog.mockRestore();
    }

    expect(callback.status).toBe(302);
    expect(database.extensionFlow).toMatchObject({
      initiatorVerifiedAt: null,
      status: 'pending',
      userId: firstSession.userId,
    });

    await verifyAndExchangeBoundFlow(
      app,
      database,
      flow,
      firstSession,
      environment,
    );
  });

  it('shares the global OAuth allocation bucket across client addresses', async () => {
    const database = new FakeDatabase();
    const google: GoogleIdentityPort = {
      createAuthorizationUrl(input) {
        return `https://accounts.example.test/authorize?state=${input.state}`;
      },
      async exchangeAndVerify() {
        throw new Error('Callback is not part of this test');
      },
    };
    const app = createPlatformApp({
      database,
      environment: googleEnvironment(),
      google,
      now: () => new Date(timestamp),
    });

    for (const address of ['192.0.2.10', '192.0.2.11']) {
      const response = await app(
        new Request(
          'https://api.example.com/v1/auth/google/start?client=dashboard',
          { headers: { 'X-Faceless-Client-Address': address } },
        ),
      );
      expect(response.status).toBe(302);
    }
    expect(database.rateLimitCalls).toHaveLength(2);
    expect(database.rateLimitCalls[0]?.[0]?.key).not.toBe(
      database.rateLimitCalls[1]?.[0]?.key,
    );
    expect(database.rateLimitCalls[0]?.[1]?.key).toBe(
      database.rateLimitCalls[1]?.[1]?.key,
    );
  });

  it('redirects a completed dashboard sign-in to the existing application root', async () => {
    const database = new FakeDatabase();
    const google: GoogleIdentityPort = {
      createAuthorizationUrl(input) {
        const target = new URL('https://accounts.example.test/authorize');
        target.searchParams.set('state', input.state);
        return target.toString();
      },
      async exchangeAndVerify() {
        return {
          displayName: 'Signed In User',
          email: 'signed-in@example.com',
          issuer: 'https://accounts.google.com',
          subject: 'google-dashboard-subject',
        };
      },
    };
    const app = createPlatformApp({
      database,
      environment: googleEnvironment(),
      google,
      now: () => new Date(timestamp),
    });
    const start = await app(
      new Request(
        'https://api.example.com/v1/auth/google/start?client=dashboard',
      ),
    );
    const authorizationLocation = start.headers.get('location');
    if (authorizationLocation === null) {
      throw new Error('Expected a Google authorization redirect');
    }
    const oauthState = new URL(authorizationLocation).searchParams.get('state');
    if (oauthState === null) throw new Error('Expected an OAuth state');

    const callback = await app(
      new Request(
        `https://api.example.com/v1/auth/google/callback?code=${'c'.repeat(32)}&state=${oauthState}`,
        { headers: { Cookie: `__Host-fa_oauth_state=${oauthState}` } },
      ),
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('https://app.example.com/');
    expect(callback.headers.getSetCookie().join(';')).toContain(
      '__Host-fa_session=',
    );
  });

  it('authorizes Run from the server session and returns bounded shared decisions', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: testEnvironment(),
      now: () => new Date(timestamp),
    });
    const session = await issueExtensionSession(app, database);
    database.usageAuthorization = {
      allowed: true,
      appId: 'grok-automator',
      authorizationId: 'usage_authorization_0000001',
      authorizedUnits: 1,
      operation: 'automation.run',
      remainingUnits: 9,
      resetsAt: '2026-08-17T00:00:00.000Z',
      expiresAt: '2026-08-16T00:01:00.000Z',
      schemaVersion: 2,
      status: 'reserved',
    };

    const response = await app(usageRequest(session.accessToken));
    expect(response.status).toBe(200);
    expect(usageReservationResponseSchema.parse(await response.json())).toEqual(
      database.usageAuthorization,
    );
    const usageInput = database.usageAuthorizationInput;
    if (usageInput === null) {
      throw new Error('Expected a persisted usage authorization input');
    }
    expect(opaqueIdSchema.safeParse(usageInput.authorizationId).success).toBe(
      true,
    );
    expect(usageInput).toEqual({
      appId: 'grok-automator',
      appSessionId: session.session.sessionId,
      authorizationExpiresAt: '2026-08-16T00:01:00.000Z',
      authorizationId: usageInput.authorizationId,
      dailyUnitLimit: 10,
      idempotencyKey: 'run_request_0000001',
      now: timestamp,
      operation: 'automation.run',
      protocolVersion: 2,
      resetsAt: '2026-08-17T00:00:00.000Z',
      units: 1,
      userId: 'extension_user_identifier_0001',
    });

    const consume = await app(
      extensionRequest(
        `/v1/apps/grok-automator/usage/reservations/${database.usageAuthorization.authorizationId}/consume`,
        {
          body: JSON.stringify({
            acceptanceId: 'queue.acceptance.0000001',
            schemaVersion: 2,
          }),
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          method: 'POST',
        },
      ),
    );
    expect(consume.status).toBe(200);
    expect(
      usageReservationTransitionResponseSchema.parse(await consume.json()),
    ).toMatchObject({
      acceptanceId: 'queue.acceptance.0000001',
      status: 'accepted',
    });

    const finalize = await app(
      extensionRequest(
        `/v1/apps/grok-automator/usage/reservations/${database.usageAuthorization.authorizationId}/finalize`,
        {
          body: JSON.stringify({
            acceptanceId: 'queue.acceptance.0000001',
            schemaVersion: 2,
          }),
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          method: 'POST',
        },
      ),
    );
    expect(finalize.status).toBe(200);
    expect(
      usageReservationTransitionResponseSchema.parse(await finalize.json()),
    ).toMatchObject({
      acceptanceId: 'queue.acceptance.0000001',
      status: 'consumed',
    });

    const rollback = await app(
      extensionRequest(
        '/v1/apps/grok-automator/usage/reservations/usage_authorization_0000003/rollback',
        {
          body: JSON.stringify({
            acceptanceId: 'queue.acceptance.0000003',
            schemaVersion: 2,
          }),
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          method: 'POST',
        },
      ),
    );
    expect(rollback.status).toBe(200);
    expect(
      usageReservationTransitionResponseSchema.parse(await rollback.json()),
    ).toMatchObject({
      acceptanceId: 'queue.acceptance.0000003',
      status: 'rolled_back',
    });

    const cancel = await app(
      extensionRequest(
        '/v1/apps/grok-automator/usage/reservations/usage_authorization_0000002/cancel',
        {
          body: JSON.stringify({ schemaVersion: 2 }),
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          method: 'POST',
        },
      ),
    );
    expect(cancel.status).toBe(200);
    expect(
      usageReservationTransitionResponseSchema.parse(await cancel.json()),
    ).toMatchObject({ status: 'cancelled' });

    const legacy = await app(
      extensionRequest('/v1/apps/grok-automator/usage/authorize', {
        body: JSON.stringify({
          appId: 'grok-automator',
          idempotencyKey: 'legacy.request.0000001',
          operation: 'automation.run',
          units: 1,
        }),
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        method: 'POST',
      }),
    );
    expect(legacy.status).toBe(200);
    const legacyBody = usageAuthorizationResponseSchema.parse(
      await legacy.json(),
    );
    expect(legacyBody).toEqual({
      allowed: true,
      appId: 'grok-automator',
      authorizationId: 'usage_authorization_0000001',
      authorizedUnits: 1,
      operation: 'automation.run',
      remainingUnits: 9,
      resetsAt: '2026-08-17T00:00:00.000Z',
    });
    expect(legacy.headers.get('deprecation')).toBe('true');
    expect('schemaVersion' in legacyBody).toBe(false);
    expect('status' in legacyBody).toBe(false);

    const legacyDuplicate = await app(
      extensionRequest('/v1/apps/grok-automator/usage/authorize', {
        body: JSON.stringify({
          appId: 'grok-automator',
          idempotencyKey: 'legacy.request.0000001',
          operation: 'automation.run',
          units: 1,
        }),
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        method: 'POST',
      }),
    );
    expect(legacyDuplicate.status).toBe(200);
    expect(await legacyDuplicate.json()).toEqual(legacyBody);
    expect(database.usageAuthorizationInput?.protocolVersion).toBe(1);

    database.usageAuthorizationInput = null;
    const disabledOperation = await app(
      usageRequest(session.accessToken, {
        idempotencyKey: 'run_request_0000002',
        operation: 'automation.delete',
      }),
    );
    expect(disabledOperation.status).toBe(200);
    expect(
      usageReservationResponseSchema.parse(await disabledOperation.json()),
    ).toEqual({
      allowed: false,
      appId: 'grok-automator',
      operation: 'automation.delete',
      reason: 'operation_disabled',
      schemaVersion: 2,
      status: 'denied',
    });
    expect(database.usageAuthorizationInput).toBeNull();

    database.usageAuthorization = {
      allowed: false,
      appId: 'grok-automator',
      operation: 'automation.run',
      reason: 'entitlement_required',
      remainingUnits: 0,
      resetsAt: '2026-08-17T00:00:00.000Z',
      schemaVersion: 2,
      status: 'denied',
    };
    const noEntitlement = await app(
      usageRequest(session.accessToken, {
        idempotencyKey: 'run_request_0000003',
      }),
    );
    expect(noEntitlement.status).toBe(200);
    expect(
      usageReservationResponseSchema.parse(await noEntitlement.json()),
    ).toEqual(database.usageAuthorization);
  });

  it('fails usage closed for missing, mismatched, banned, or stale sessions', async () => {
    const database = new FakeDatabase();
    const app = createPlatformApp({
      database,
      environment: environmentWithSecondOrigin(),
      now: () => new Date(timestamp),
    });
    const session = await issueExtensionSession(app, database);
    const activeAppSession = database.appSession;
    if (activeAppSession === null) {
      throw new Error('Expected the fake app session to be created');
    }

    const missingToken = await app(usageRequest(null));
    expect(missingToken.status).toBe(401);
    expect(
      apiErrorEnvelopeSchema.parse(await missingToken.json()).error.code,
    ).toBe('unauthorized');
    expect(database.usageAuthorizationInput).toBeNull();

    const wrongOrigin = await app(
      usageRequest(session.accessToken, { origin: secondExtensionOrigin }),
    );
    expect(wrongOrigin.status).toBe(401);
    expect(
      apiErrorEnvelopeSchema.parse(await wrongOrigin.json()).error.code,
    ).toBe('unauthorized');
    expect(database.usageAuthorizationInput).toBeNull();

    database.appSession = { ...activeAppSession, status: 'banned' };
    const banned = await app(usageRequest(session.accessToken));
    expect(banned.status).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(await banned.json()).error.code).toBe(
      'forbidden',
    );
    expect(database.usageAuthorizationInput).toBeNull();

    database.appSession = activeAppSession;
    database.usageAuthorization = null;
    const staleDecision = await app(usageRequest(session.accessToken));
    expect(staleDecision.status).toBe(401);
    expect(
      apiErrorEnvelopeSchema.parse(await staleDecision.json()).error.code,
    ).toBe('unauthorized');
    expect(database.usageAuthorizationInput).not.toBeNull();
  });
});
