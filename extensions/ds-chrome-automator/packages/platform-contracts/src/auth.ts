import { z } from 'zod';

import {
  accessTokenSchema,
  appIdSchema,
  httpsUrlSchema,
  isoDateTimeSchema,
  opaqueIdSchema,
} from './primitives.js';
import { sessionSchema } from './session.js';

export const identityProviderSchema = z.literal('google');

export const webAuthClientSchema = z.literal('dashboard');

export const startWebAuthQuerySchema = z.strictObject({
  client: webAuthClientSchema,
});

export const pkceCodeChallengeSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Invalid PKCE S256 challenge');

export const pkceCodeVerifierSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/u, 'Invalid PKCE verifier');

export const extensionAuthProtocolVersionV1Schema = z.literal(1);
export const extensionAuthProtocolVersionV2Schema = z.literal(2);
export const extensionAuthProtocolVersionSchema =
  extensionAuthProtocolVersionV2Schema;

export const extensionUserCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u,
    'Invalid extension verification code',
  );

export const createExtensionAuthFlowRequestV1Schema = z.strictObject({
  appId: appIdSchema,
  provider: identityProviderSchema,
  codeChallenge: pkceCodeChallengeSchema,
  codeChallengeMethod: z.literal('S256'),
});

export const createExtensionAuthFlowRequestV2Schema =
  createExtensionAuthFlowRequestV1Schema.extend({
    schemaVersion: extensionAuthProtocolVersionSchema,
  });

export const createExtensionAuthFlowRequestSchema = z.union([
  createExtensionAuthFlowRequestV2Schema,
  createExtensionAuthFlowRequestV1Schema,
]);

const createExtensionAuthFlowResponseV1Shape = {
  flowId: opaqueIdSchema,
  provider: identityProviderSchema,
  authorizationUrl: httpsUrlSchema,
  expiresAt: isoDateTimeSchema,
  pollIntervalSeconds: z.number().int().min(1).max(15),
};

export const createExtensionAuthFlowResponseV1Schema = z.strictObject(
  createExtensionAuthFlowResponseV1Shape,
);

export const createExtensionAuthFlowResponseV2Schema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionV2Schema,
  ...createExtensionAuthFlowResponseV1Shape,
  userCode: extensionUserCodeSchema,
});

export const createExtensionAuthFlowResponseSchema =
  createExtensionAuthFlowResponseV2Schema;

export const negotiatedCreateExtensionAuthFlowResponseSchema = z.union([
  createExtensionAuthFlowResponseV2Schema,
  createExtensionAuthFlowResponseV1Schema,
]);

export const verifyExtensionAuthFlowRequestSchema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionSchema,
  userCode: extensionUserCodeSchema,
});

export const verifyExtensionAuthFlowResponseSchema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionSchema,
  flowId: opaqueIdSchema,
  status: z.literal('verified'),
  attemptsRemaining: z.number().int().min(0).max(5),
});

export const extensionAuthFlowPageV1StatusSchema = z.enum([
  'pending',
  'authorized',
  'denied',
  'expired',
  'consumed',
]);

export const extensionAuthFlowPageStatusSchema = z.enum([
  'verification_required',
  'pending',
  'authorized',
  'denied',
  'expired',
  'consumed',
]);

const extensionAuthFlowPageV1ResponseShape = {
  flowId: opaqueIdSchema,
  appId: appIdSchema,
  appDisplayName: z.string().min(1).max(80),
  expiresAt: isoDateTimeSchema,
};

export const extensionAuthFlowPageResponseV1Schema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionV1Schema,
  ...extensionAuthFlowPageV1ResponseShape,
  status: extensionAuthFlowPageV1StatusSchema,
});

export const extensionAuthFlowPageResponseV2Schema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionV2Schema,
  ...extensionAuthFlowPageV1ResponseShape,
  status: extensionAuthFlowPageStatusSchema,
  verificationAttemptsRemaining: z.number().int().min(0).max(5),
  csrfToken: z.string().min(32).max(128).nullable(),
});

export const extensionAuthFlowPageResponseSchema =
  extensionAuthFlowPageResponseV2Schema;

export const negotiatedExtensionAuthFlowPageResponseSchema = z.union([
  extensionAuthFlowPageResponseV2Schema,
  extensionAuthFlowPageResponseV1Schema,
]);

export const exchangeExtensionAuthFlowRequestV1Schema = z.strictObject({
  codeVerifier: pkceCodeVerifierSchema,
});

export const exchangeExtensionAuthFlowRequestV2Schema =
  exchangeExtensionAuthFlowRequestV1Schema.extend({
    schemaVersion: extensionAuthProtocolVersionSchema,
  });

export const exchangeExtensionAuthFlowRequestSchema = z.union([
  exchangeExtensionAuthFlowRequestV2Schema,
  exchangeExtensionAuthFlowRequestV1Schema,
]);

export const pendingExtensionAuthFlowResponseV1Schema = z.strictObject({
  status: z.literal('pending'),
  retryAfterSeconds: z.number().int().min(1).max(15),
});

export const authorizedExtensionAuthFlowResponseV1Schema = z.strictObject({
  status: z.literal('authorized'),
  accessToken: accessTokenSchema,
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int().min(60).max(3_600),
  session: sessionSchema,
});

export const exchangeExtensionAuthFlowResponseV1Schema = z.discriminatedUnion(
  'status',
  [
    pendingExtensionAuthFlowResponseV1Schema,
    authorizedExtensionAuthFlowResponseV1Schema,
  ],
);

export const pendingExtensionAuthFlowResponseV2Schema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionV2Schema,
  status: z.literal('pending'),
  retryAfterSeconds: z.number().int().min(1).max(15),
});

export const pendingExtensionAuthFlowResponseSchema =
  pendingExtensionAuthFlowResponseV2Schema;

export const authorizedExtensionAuthFlowResponseV2Schema = z.strictObject({
  schemaVersion: extensionAuthProtocolVersionV2Schema,
  status: z.literal('authorized'),
  accessToken: accessTokenSchema,
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int().min(60).max(3_600),
  session: sessionSchema,
});

export const authorizedExtensionAuthFlowResponseSchema =
  authorizedExtensionAuthFlowResponseV2Schema;

export const exchangeExtensionAuthFlowResponseSchema = z.discriminatedUnion(
  'status',
  [
    pendingExtensionAuthFlowResponseSchema,
    authorizedExtensionAuthFlowResponseSchema,
  ],
);

export const negotiatedExchangeExtensionAuthFlowResponseSchema = z.union([
  exchangeExtensionAuthFlowResponseSchema,
  exchangeExtensionAuthFlowResponseV1Schema,
]);

export type IdentityProvider = z.infer<typeof identityProviderSchema>;
export type WebAuthClient = z.infer<typeof webAuthClientSchema>;
export type StartWebAuthQuery = z.infer<typeof startWebAuthQuerySchema>;
export type CreateExtensionAuthFlowRequest = z.infer<
  typeof createExtensionAuthFlowRequestSchema
>;
export type CreateExtensionAuthFlowResponse = z.infer<
  typeof createExtensionAuthFlowResponseSchema
>;
export type CreateExtensionAuthFlowResponseV1 = z.infer<
  typeof createExtensionAuthFlowResponseV1Schema
>;
export type NegotiatedCreateExtensionAuthFlowResponse = z.infer<
  typeof negotiatedCreateExtensionAuthFlowResponseSchema
>;
export type VerifyExtensionAuthFlowRequest = z.infer<
  typeof verifyExtensionAuthFlowRequestSchema
>;
export type VerifyExtensionAuthFlowResponse = z.infer<
  typeof verifyExtensionAuthFlowResponseSchema
>;
export type ExtensionAuthFlowPageResponse = z.infer<
  typeof extensionAuthFlowPageResponseSchema
>;
export type ExtensionAuthFlowPageResponseV1 = z.infer<
  typeof extensionAuthFlowPageResponseV1Schema
>;
export type NegotiatedExtensionAuthFlowPageResponse = z.infer<
  typeof negotiatedExtensionAuthFlowPageResponseSchema
>;
export type ExchangeExtensionAuthFlowRequest = z.infer<
  typeof exchangeExtensionAuthFlowRequestSchema
>;
export type ExchangeExtensionAuthFlowResponse = z.infer<
  typeof exchangeExtensionAuthFlowResponseSchema
>;
export type ExchangeExtensionAuthFlowResponseV1 = z.infer<
  typeof exchangeExtensionAuthFlowResponseV1Schema
>;
export type NegotiatedExchangeExtensionAuthFlowResponse = z.infer<
  typeof negotiatedExchangeExtensionAuthFlowResponseSchema
>;
