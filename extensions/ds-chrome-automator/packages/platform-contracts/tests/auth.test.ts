import { describe, expect, it } from 'vitest';

import {
  authorizedExtensionAuthFlowResponseSchema,
  createExtensionAuthFlowRequestSchema,
  createExtensionAuthFlowResponseV1Schema,
  createExtensionAuthFlowResponseSchema,
  exchangeExtensionAuthFlowRequestV1Schema,
  exchangeExtensionAuthFlowRequestV2Schema,
  exchangeExtensionAuthFlowResponseV1Schema,
  exchangeExtensionAuthFlowRequestSchema,
  exchangeExtensionAuthFlowResponseSchema,
  extensionAuthFlowPageResponseV1Schema,
  extensionAuthFlowPageResponseSchema,
  startWebAuthQuerySchema,
  verifyExtensionAuthFlowRequestSchema,
} from '../src/index.js';
import { validSession } from './fixtures.js';

const validChallenge = 'A'.repeat(43);
const validVerifier = 'verifier-0123456789._~ABCDEFGHIJKLMNOPQRSTUVWXYZ';

describe('Google-only extension authentication contracts', () => {
  it('accepts only the central dashboard as a web-auth client', () => {
    expect(startWebAuthQuerySchema.parse({ client: 'dashboard' })).toEqual({
      client: 'dashboard',
    });
    expect(
      startWebAuthQuerySchema.safeParse({ client: 'password-login' }).success,
    ).toBe(false);
    expect(
      startWebAuthQuerySchema.safeParse({
        client: 'dashboard',
        provider: 'facebook',
      }).success,
    ).toBe(false);
  });

  it('accepts only Google with PKCE S256 and no client-supplied origin', () => {
    const request = {
      schemaVersion: 2 as const,
      appId: 'grok-automator',
      provider: 'google',
      codeChallenge: validChallenge,
      codeChallengeMethod: 'S256',
    };

    expect(createExtensionAuthFlowRequestSchema.parse(request)).toEqual(
      request,
    );
    expect(
      createExtensionAuthFlowRequestSchema.safeParse({
        ...request,
        provider: 'password',
      }).success,
    ).toBe(false);
    expect(
      createExtensionAuthFlowRequestSchema.safeParse({
        ...request,
        extensionOrigin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }).success,
    ).toBe(false);
  });

  it('validates a bounded HTTPS authorization response', () => {
    const response = {
      schemaVersion: 2 as const,
      flowId: 'flow_1234567890abcdef',
      provider: 'google',
      authorizationUrl: 'https://auth.example.com/extension/flow',
      expiresAt: '2026-08-14T00:05:00.000Z',
      pollIntervalSeconds: 3,
      userCode: 'ABCD-2345',
    };

    expect(createExtensionAuthFlowResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      createExtensionAuthFlowResponseSchema.safeParse({
        ...response,
        authorizationUrl: 'http://auth.example.com/extension/flow',
      }).success,
    ).toBe(false);
  });

  it('validates a PKCE verifier and rejects padding or unknown fields', () => {
    expect(
      exchangeExtensionAuthFlowRequestSchema.parse({
        codeVerifier: validVerifier,
      }),
    ).toEqual({ codeVerifier: validVerifier });
    expect(
      exchangeExtensionAuthFlowRequestSchema.safeParse({
        codeVerifier: `${validVerifier}=`,
      }).success,
    ).toBe(false);
    expect(
      exchangeExtensionAuthFlowRequestSchema.safeParse({
        codeVerifier: validVerifier,
        accessToken: 'client-must-not-supply-a-token',
      }).success,
    ).toBe(false);
  });

  it('normalizes and validates the independent initiator code', () => {
    expect(
      verifyExtensionAuthFlowRequestSchema.parse({
        schemaVersion: 2,
        userCode: ' abcd-2345 ',
      }),
    ).toEqual({ schemaVersion: 2, userCode: 'ABCD-2345' });
    expect(
      verifyExtensionAuthFlowRequestSchema.safeParse({
        schemaVersion: 2,
        userCode: 'ABCO-1234',
      }).success,
    ).toBe(false);
  });

  it('versions the safe central-page status without proof material', () => {
    const status = extensionAuthFlowPageResponseSchema.parse({
      appDisplayName: 'Grok Automator™',
      appId: 'grok-automator',
      expiresAt: '2026-08-14T00:05:00.000Z',
      flowId: 'flow_1234567890abcdef',
      csrfToken: null,
      schemaVersion: 2,
      status: 'verification_required',
      verificationAttemptsRemaining: 5,
    });

    expect(status.status).toBe('verification_required');
    expect(JSON.stringify(status)).not.toMatch(/codeChallenge|userCode/u);
  });

  it('keeps the temporary v1 wire shape exact and rejects cross-protocol bodies', () => {
    const legacyCreate = createExtensionAuthFlowResponseV1Schema.parse({
      flowId: 'flow_1234567890abcdef',
      provider: 'google',
      authorizationUrl: 'https://auth.example.com/extension/flow',
      expiresAt: '2026-08-14T00:05:00.000Z',
      pollIntervalSeconds: 3,
    });
    expect('schemaVersion' in legacyCreate).toBe(false);
    expect('userCode' in legacyCreate).toBe(false);
    expect(
      extensionAuthFlowPageResponseV1Schema.parse({
        appDisplayName: 'Grok Automator™',
        appId: 'grok-automator',
        expiresAt: '2026-08-14T00:05:00.000Z',
        flowId: 'flow_1234567890abcdef',
        schemaVersion: 1,
        status: 'pending',
      }).schemaVersion,
    ).toBe(1);
    expect(
      exchangeExtensionAuthFlowRequestV1Schema.safeParse({
        codeVerifier: validVerifier,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      exchangeExtensionAuthFlowRequestV2Schema.safeParse({
        codeVerifier: validVerifier,
      }).success,
    ).toBe(false);
    const legacyExchange = exchangeExtensionAuthFlowResponseV1Schema.parse({
      status: 'pending',
      retryAfterSeconds: 3,
    });
    expect('schemaVersion' in legacyExchange).toBe(false);
  });

  it('supports pending and authorized exchanges without Google tokens', () => {
    expect(
      exchangeExtensionAuthFlowResponseSchema.parse({
        schemaVersion: 2,
        status: 'pending',
        retryAfterSeconds: 3,
      }),
    ).toEqual({
      retryAfterSeconds: 3,
      schemaVersion: 2,
      status: 'pending',
    });

    const authorized = {
      schemaVersion: 2 as const,
      status: 'authorized' as const,
      accessToken: 'application.token_1234567890abcdef',
      tokenType: 'Bearer' as const,
      expiresInSeconds: 900,
      session: validSession,
    };
    expect(authorizedExtensionAuthFlowResponseSchema.parse(authorized)).toEqual(
      authorized,
    );
    expect(JSON.stringify(authorized)).not.toMatch(/googleAccessToken/u);
  });
});
