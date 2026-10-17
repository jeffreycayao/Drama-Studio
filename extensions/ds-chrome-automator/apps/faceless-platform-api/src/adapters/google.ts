import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

import { parseGoogleConfig } from '../config/env.js';
import { constantTimeEqual } from '../core/crypto.js';
import type { GoogleIdentityPort } from '../ports/providers.js';

const googleTokenResponseSchema = z.looseObject({
  id_token: z.string().min(100),
});

const googleIdentityPayloadSchema = z.looseObject({
  email: z.email(),
  email_verified: z.literal(true),
  iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  name: z.string().min(1).max(120).optional(),
  nonce: z.string().min(16),
  sub: z.string().min(1).max(255),
});

const googleJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

export function createGoogleIdentityAdapter(
  environment: NodeJS.ProcessEnv,
  fetchImplementation: typeof fetch = fetch,
): GoogleIdentityPort {
  const config = parseGoogleConfig(environment);

  return {
    createAuthorizationUrl(input) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.oauthRedirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', input.state);
      url.searchParams.set('nonce', input.nonce);
      url.searchParams.set('code_challenge', input.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    },

    async exchangeAndVerify(input) {
      const response = await fetchImplementation(
        'https://oauth2.googleapis.com/token',
        {
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code: input.code,
            code_verifier: input.codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: config.oauthRedirectUri,
          }),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        throw new Error('Google token exchange failed');
      }

      const tokenResponse = googleTokenResponseSchema.parse(
        await response.json(),
      );
      const verified = await jwtVerify(tokenResponse.id_token, googleJwks, {
        audience: config.clientId,
        issuer: ['accounts.google.com', 'https://accounts.google.com'],
      });
      const payload = googleIdentityPayloadSchema.parse(verified.payload);
      if (!constantTimeEqual(payload.nonce, input.expectedNonce)) {
        throw new Error('Google nonce mismatch');
      }

      return {
        displayName: payload.name ?? null,
        email: payload.email,
        issuer: payload.iss,
        subject: payload.sub,
      };
    },
  };
}
