import {
  authorizedExtensionAuthFlowResponseSchema as sharedAuthorizedSchema,
  createExtensionAuthFlowRequestSchema as sharedCreateRequestSchema,
  createExtensionAuthFlowResponseSchema as sharedCreateResponseSchema,
  exchangeExtensionAuthFlowRequestSchema as sharedExchangeRequestSchema,
} from '@faceless-automations/platform-contracts';
import { describe, expect, it } from 'vitest';

import {
  authorizedExtensionAuthFlowResponseSchema,
  createExtensionAuthFlowRequestSchema,
  createExtensionAuthFlowResponseSchema,
  exchangeExtensionAuthFlowRequestSchema,
  legacyAuthorizedExtensionAuthFlowResponseSchema,
  legacyCreateExtensionAuthFlowRequestSchema,
  legacyCreateExtensionAuthFlowResponseSchema,
  legacyExchangeExtensionAuthFlowRequestSchema,
} from '../../src/sidepanel/auth-contract';

const NOW = Date.parse('2026-08-15T00:00:00.000Z');
const validCreateRequest = {
  schemaVersion: 2,
  appId: 'grok-automator',
  provider: 'google',
  codeChallenge: 'A'.repeat(43),
  codeChallengeMethod: 'S256',
};
const validCreateResponse = {
  schemaVersion: 2,
  flowId: 'flow_1234567890abcdef',
  provider: 'google',
  authorizationUrl:
    'https://accounts.example/auth/extension/flow_1234567890abcdef',
  expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
  pollIntervalSeconds: 3,
  userCode: 'ABCD-EFGH',
};
const validAuthorizedResponse = {
  schemaVersion: 2,
  status: 'authorized',
  accessToken: 'application.token_1234567890abcdef',
  tokenType: 'Bearer',
  expiresInSeconds: 900,
  session: {
    schemaVersion: 1,
    sessionId: 'session_1234567890abcdef',
    account: {
      userId: 'user_1234567890abcdef',
      provider: 'google',
      email: 'owner@example.test',
      emailVerified: true,
    },
    access: {
      appId: 'grok-automator',
      planCode: 'free-plan',
      capabilities: ['automation.run'],
    },
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 15 * 60_000).toISOString(),
  },
};

function expectParity(
  local: { safeParse: (value: unknown) => { success: boolean } },
  shared: { safeParse: (value: unknown) => { success: boolean } },
  cases: unknown[],
): void {
  for (const value of cases) {
    expect(local.safeParse(value).success).toBe(
      shared.safeParse(value).success,
    );
  }
}

describe('browser-safe central auth contract adapter', () => {
  it('matches the shared create-flow request and response boundaries', () => {
    expectParity(
      createExtensionAuthFlowRequestSchema,
      sharedCreateRequestSchema,
      [
        validCreateRequest,
        { ...validCreateRequest, provider: 'password' },
        { ...validCreateRequest, codeChallengeMethod: 'plain' },
        { ...validCreateRequest, extensionOrigin: 'client-authored' },
      ],
    );
    expectParity(
      createExtensionAuthFlowResponseSchema,
      sharedCreateResponseSchema,
      [
        validCreateResponse,
        { ...validCreateResponse, authorizationUrl: 'http://accounts.example' },
        { ...validCreateResponse, pollIntervalSeconds: 0 },
        { ...validCreateResponse, provider: 'facebook' },
      ],
    );
  });

  it('matches the shared exchange and authorized-session boundaries', () => {
    const validExchange = {
      schemaVersion: 2,
      codeVerifier: 'verifier-0123456789._~ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    };
    expectParity(
      exchangeExtensionAuthFlowRequestSchema,
      sharedExchangeRequestSchema,
      [
        validExchange,
        { ...validExchange, codeVerifier: `${validExchange.codeVerifier}=` },
        { ...validExchange, accessToken: 'client-authored' },
      ],
    );
    expectParity(
      authorizedExtensionAuthFlowResponseSchema,
      sharedAuthorizedSchema,
      [
        validAuthorizedResponse,
        { ...validAuthorizedResponse, tokenType: 'Google' },
        { ...validAuthorizedResponse, googleAccessToken: 'provider-token' },
        {
          ...validAuthorizedResponse,
          session: {
            ...validAuthorizedResponse.session,
            account: {
              ...validAuthorizedResponse.session.account,
              emailVerified: false,
            },
          },
        },
      ],
    );
  });

  it('keeps the negotiated legacy wire shapes exact and separate from v2', () => {
    const legacyCreateRequest = { ...validCreateRequest };
    delete (legacyCreateRequest as { schemaVersion?: number }).schemaVersion;
    const legacyCreateResponse = { ...validCreateResponse };
    delete (legacyCreateResponse as { schemaVersion?: number }).schemaVersion;
    delete (legacyCreateResponse as { userCode?: string }).userCode;
    const legacyExchangeRequest = {
      codeVerifier: 'verifier-0123456789._~ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    };
    const legacyAuthorized = { ...validAuthorizedResponse };
    delete (legacyAuthorized as { schemaVersion?: number }).schemaVersion;

    expect(
      legacyCreateExtensionAuthFlowRequestSchema.safeParse(legacyCreateRequest)
        .success,
    ).toBe(true);
    expect(
      legacyCreateExtensionAuthFlowResponseSchema.safeParse(
        legacyCreateResponse,
      ).success,
    ).toBe(true);
    expect(
      legacyExchangeExtensionAuthFlowRequestSchema.safeParse(
        legacyExchangeRequest,
      ).success,
    ).toBe(true);
    expect(
      legacyAuthorizedExtensionAuthFlowResponseSchema.safeParse(
        legacyAuthorized,
      ).success,
    ).toBe(true);
    expect(
      legacyCreateExtensionAuthFlowResponseSchema.safeParse({
        ...legacyCreateResponse,
        userCode: 'ABCD-EFGH',
      }).success,
    ).toBe(false);
    expect(
      createExtensionAuthFlowResponseSchema.safeParse(legacyCreateResponse)
        .success,
    ).toBe(false);
  });
});
