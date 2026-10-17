import type {
  CreateExtensionAuthFlowRequest,
  CreateExtensionAuthFlowResponse,
  ExchangeExtensionAuthFlowRequest,
  ExchangeExtensionAuthFlowResponse,
  PlatformSession,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod/mini';

const lowerKebabPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const opaqueIdentifierPattern = /^[A-Za-z0-9_-]+$/u;
const capabilityPattern = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/u;

const appIdSchema = z
  .string()
  .check(z.minLength(3), z.maxLength(63), z.regex(lowerKebabPattern));
const opaqueIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(opaqueIdentifierPattern));
const capabilityIdSchema = z
  .string()
  .check(z.minLength(3), z.maxLength(128), z.regex(capabilityPattern));
const planCodeSchema = z
  .string()
  .check(z.minLength(3), z.maxLength(64), z.regex(lowerKebabPattern));

export const isoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .check(z.minLength(20), z.maxLength(35));

const httpsUrlSchema = z.string().check(
  z.minLength(1),
  z.maxLength(2_048),
  z.refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        url.hash.length === 0
      );
    } catch {
      return false;
    }
  }),
);

export const accessTokenSchema = z
  .string()
  .check(z.minLength(32), z.maxLength(4_096), z.regex(/^[A-Za-z0-9._~-]+$/u));

const accountSchema = z.strictObject({
  userId: opaqueIdSchema,
  provider: z.literal('google'),
  email: z.email().check(z.maxLength(320)),
  emailVerified: z.literal(true),
  displayName: z.optional(z.string().check(z.minLength(1), z.maxLength(120))),
});

const appAccessSchema = z.strictObject({
  appId: appIdSchema,
  planCode: planCodeSchema,
  capabilities: z.array(capabilityIdSchema).check(
    z.maxLength(100),
    z.refine(
      (capabilities) => new Set(capabilities).size === capabilities.length,
    ),
  ),
});

export const sessionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: opaqueIdSchema,
    account: accountSchema,
    access: appAccessSchema,
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .check(
    z.refine(
      (session) => Date.parse(session.expiresAt) > Date.parse(session.issuedAt),
    ),
  );

const pkceCodeChallengeSchema = z
  .string()
  .check(z.length(43), z.regex(/^[A-Za-z0-9_-]+$/u));
const pkceCodeVerifierSchema = z
  .string()
  .check(z.minLength(43), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const extensionUserCodeSchema = z
  .string()
  .check(
    z.length(9),
    z.regex(
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u,
    ),
  );

export const createExtensionAuthFlowRequestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  appId: appIdSchema,
  provider: z.literal('google'),
  codeChallenge: pkceCodeChallengeSchema,
  codeChallengeMethod: z.literal('S256'),
});

export const legacyCreateExtensionAuthFlowRequestSchema = z.strictObject({
  appId: appIdSchema,
  provider: z.literal('google'),
  codeChallenge: pkceCodeChallengeSchema,
  codeChallengeMethod: z.literal('S256'),
});

export const createExtensionAuthFlowResponseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  flowId: opaqueIdSchema,
  provider: z.literal('google'),
  authorizationUrl: httpsUrlSchema,
  expiresAt: isoDateTimeSchema,
  pollIntervalSeconds: z.number().check(z.int(), z.minimum(1), z.maximum(15)),
  userCode: extensionUserCodeSchema,
});

export const legacyCreateExtensionAuthFlowResponseSchema = z.strictObject({
  flowId: opaqueIdSchema,
  provider: z.literal('google'),
  authorizationUrl: httpsUrlSchema,
  expiresAt: isoDateTimeSchema,
  pollIntervalSeconds: z.number().check(z.int(), z.minimum(1), z.maximum(15)),
});

export const exchangeExtensionAuthFlowRequestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  codeVerifier: pkceCodeVerifierSchema,
});

export const legacyExchangeExtensionAuthFlowRequestSchema = z.strictObject({
  codeVerifier: pkceCodeVerifierSchema,
});

const pendingExtensionAuthFlowResponseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  status: z.literal('pending'),
  retryAfterSeconds: z.number().check(z.int(), z.minimum(1), z.maximum(15)),
});

const legacyPendingExtensionAuthFlowResponseSchema = z.strictObject({
  status: z.literal('pending'),
  retryAfterSeconds: z.number().check(z.int(), z.minimum(1), z.maximum(15)),
});

export const authorizedExtensionAuthFlowResponseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  status: z.literal('authorized'),
  accessToken: accessTokenSchema,
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().check(z.int(), z.minimum(60), z.maximum(3_600)),
  session: sessionSchema,
});

export const legacyAuthorizedExtensionAuthFlowResponseSchema = z.strictObject({
  status: z.literal('authorized'),
  accessToken: accessTokenSchema,
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().check(z.int(), z.minimum(60), z.maximum(3_600)),
  session: sessionSchema,
});

export const exchangeExtensionAuthFlowResponseSchema = z.discriminatedUnion(
  'status',
  [
    pendingExtensionAuthFlowResponseSchema,
    authorizedExtensionAuthFlowResponseSchema,
  ],
);

export const legacyExchangeExtensionAuthFlowResponseSchema =
  z.discriminatedUnion('status', [
    legacyPendingExtensionAuthFlowResponseSchema,
    legacyAuthorizedExtensionAuthFlowResponseSchema,
  ]);

export type AuthProtocolVersion = 1 | 2;
export type LegacyCreateExtensionAuthFlowResponse = z.infer<
  typeof legacyCreateExtensionAuthFlowResponseSchema
>;
export type LegacyExchangeExtensionAuthFlowResponse = z.infer<
  typeof legacyExchangeExtensionAuthFlowResponseSchema
>;

export type NegotiatedCreateExtensionAuthFlowResponse =
  | {
      protocolVersion: 2;
      value: CreateExtensionAuthFlowResponse;
    }
  | {
      protocolVersion: 1;
      value: LegacyCreateExtensionAuthFlowResponse;
    };

export type NegotiatedExchangeExtensionAuthFlowResponse =
  | {
      protocolVersion: 2;
      value: ExchangeExtensionAuthFlowResponse;
    }
  | {
      protocolVersion: 1;
      value: LegacyExchangeExtensionAuthFlowResponse;
    };

export function parseCreateExtensionAuthFlowRequest(
  value: unknown,
): CreateExtensionAuthFlowRequest {
  return createExtensionAuthFlowRequestSchema.parse(value);
}

export function parseLegacyCreateExtensionAuthFlowRequest(
  value: unknown,
): z.infer<typeof legacyCreateExtensionAuthFlowRequestSchema> {
  return legacyCreateExtensionAuthFlowRequestSchema.parse(value);
}

export function parseLegacyCreateExtensionAuthFlowResponse(
  value: unknown,
): LegacyCreateExtensionAuthFlowResponse {
  return legacyCreateExtensionAuthFlowResponseSchema.parse(value);
}

export function parseCreateExtensionAuthFlowResponse(
  value: unknown,
): CreateExtensionAuthFlowResponse {
  return createExtensionAuthFlowResponseSchema.parse(value);
}

export function parseNegotiatedCreateExtensionAuthFlowResponse(
  value: unknown,
): NegotiatedCreateExtensionAuthFlowResponse {
  const current = createExtensionAuthFlowResponseSchema.safeParse(value);
  if (current.success) return { protocolVersion: 2, value: current.data };
  return {
    protocolVersion: 1,
    value: legacyCreateExtensionAuthFlowResponseSchema.parse(value),
  };
}

export function parseExchangeExtensionAuthFlowRequest(
  value: unknown,
): ExchangeExtensionAuthFlowRequest {
  return exchangeExtensionAuthFlowRequestSchema.parse(value);
}

export function parseLegacyExchangeExtensionAuthFlowRequest(
  value: unknown,
): z.infer<typeof legacyExchangeExtensionAuthFlowRequestSchema> {
  return legacyExchangeExtensionAuthFlowRequestSchema.parse(value);
}

export function parseExchangeExtensionAuthFlowResponse(
  value: unknown,
): ExchangeExtensionAuthFlowResponse {
  return exchangeExtensionAuthFlowResponseSchema.parse(value);
}

export function parseNegotiatedExchangeExtensionAuthFlowResponse(
  protocolVersion: AuthProtocolVersion,
  value: unknown,
): NegotiatedExchangeExtensionAuthFlowResponse {
  return protocolVersion === 2
    ? {
        protocolVersion,
        value: exchangeExtensionAuthFlowResponseSchema.parse(value),
      }
    : {
        protocolVersion,
        value: legacyExchangeExtensionAuthFlowResponseSchema.parse(value),
      };
}

export function parseAuthorizedExtensionAuthFlowResponse(
  value: unknown,
):
  | z.infer<typeof authorizedExtensionAuthFlowResponseSchema>
  | z.infer<typeof legacyAuthorizedExtensionAuthFlowResponseSchema> {
  const current = authorizedExtensionAuthFlowResponseSchema.safeParse(value);
  return current.success
    ? current.data
    : legacyAuthorizedExtensionAuthFlowResponseSchema.parse(value);
}

export function parsePlatformSession(value: unknown): PlatformSession {
  return sessionSchema.parse(value);
}
