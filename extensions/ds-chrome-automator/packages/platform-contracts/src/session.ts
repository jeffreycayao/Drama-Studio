import { z } from 'zod';

import {
  appIdSchema,
  capabilityIdSchema,
  emailSchema,
  isoDateTimeSchema,
  opaqueIdSchema,
  planCodeSchema,
} from './primitives.js';

const capabilityListSchema = z
  .array(capabilityIdSchema)
  .max(100)
  .refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    'Capabilities must be unique',
  );

export const verifiedGoogleAccountSchema = z.strictObject({
  userId: opaqueIdSchema,
  provider: z.literal('google'),
  email: emailSchema,
  emailVerified: z.literal(true),
  displayName: z.string().min(1).max(120).optional(),
});

export const appAccessSchema = z.strictObject({
  appId: appIdSchema,
  planCode: planCodeSchema,
  capabilities: capabilityListSchema,
});

export const sessionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: opaqueIdSchema,
    account: verifiedGoogleAccountSchema,
    access: appAccessSchema,
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .refine(
    (session) => Date.parse(session.expiresAt) > Date.parse(session.issuedAt),
    {
      message: 'Session expiry must be later than issuance',
      path: ['expiresAt'],
    },
  );

export type VerifiedGoogleAccount = z.infer<typeof verifiedGoogleAccountSchema>;
export type AppAccess = z.infer<typeof appAccessSchema>;
export type PlatformSession = z.infer<typeof sessionSchema>;
