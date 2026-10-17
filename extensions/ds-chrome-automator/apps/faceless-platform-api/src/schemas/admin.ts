import {
  emailSchema,
  isoDateTimeSchema,
  opaqueIdSchema,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod';

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/u);
const reasonSchema = z.string().trim().min(3).max(500);
const platformFontSchema = z.enum([
  'Instrument Serif',
  'Manrope',
  'IBM Plex Mono',
]);

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (
    0.2126 * (linear[0] ?? 0) +
    0.7152 * (linear[1] ?? 0) +
    0.0722 * (linear[2] ?? 0)
  );
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export const platformSeoSchema = z.strictObject({
  siteTitle: z.string().trim().min(1).max(60),
  siteDescription: z.string().trim().min(1).max(160),
  openGraphTitle: z.string().trim().min(1).max(60),
  openGraphDescription: z.string().trim().min(1).max(200),
  socialImageUrl: z
    .url()
    .superRefine((value, context) => {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.hash.length > 0
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Expected a credential-free HTTPS URL without a fragment',
        });
      }
    })
    .nullable(),
});

export const platformThemeSchema = z
  .strictObject({
    colors: z.strictObject({
      canvas: hexColorSchema,
      surface: hexColorSchema,
      ink: hexColorSchema,
      mutedInk: hexColorSchema,
      border: hexColorSchema,
      gold: hexColorSchema,
    }),
    fonts: z.strictObject({
      display: platformFontSchema,
      body: platformFontSchema,
      metadata: platformFontSchema,
    }),
  })
  .superRefine(({ colors }, context) => {
    const pairs = [
      ['ink', colors.ink, 'canvas', colors.canvas],
      ['mutedInk', colors.mutedInk, 'canvas', colors.canvas],
      ['ink', colors.ink, 'surface', colors.surface],
      ['gold', colors.gold, 'canvas', colors.canvas],
    ] as const;
    for (const [
      foregroundName,
      foreground,
      backgroundName,
      background,
    ] of pairs) {
      if (contrastRatio(foreground, background) < 4.5) {
        context.addIssue({
          code: 'custom',
          message: `${foregroundName}/${backgroundName} contrast must be at least 4.5:1`,
          path: ['colors', foregroundName],
        });
      }
    }
  });

export const platformSettingsContentSchema = z.strictObject({
  seo: platformSeoSchema,
  theme: platformThemeSchema,
});

export const platformSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^(?:0|[1-9]\d*)$/u),
  updatedAt: isoDateTimeSchema,
  seo: platformSeoSchema,
  theme: platformThemeSchema,
});

export const updatePlatformSettingsRequestSchema = z.strictObject({
  expectedRevision: z.string().regex(/^(?:0|[1-9]\d*)$/u),
  seo: platformSeoSchema,
  theme: platformThemeSchema,
});

export const reasonRequestSchema = z.strictObject({ reason: reasonSchema });

export const adminUserSchema = z.strictObject({
  id: opaqueIdSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(120).nullable(),
  status: z.enum(['active', 'banned']),
  createdAt: isoDateTimeSchema,
  lastLoginAt: isoDateTimeSchema.nullable(),
  bannedAt: isoDateTimeSchema.nullable(),
  banReason: z.string().max(500).nullable(),
});

export const entitlementSchema = z.strictObject({
  id: opaqueIdSchema,
  userId: opaqueIdSchema,
  userEmail: emailSchema,
  code: z.string().min(3).max(128),
  status: z.enum(['active', 'revoked', 'expired']),
  source: z.enum(['stripe', 'admin', 'migration']),
  grantedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  revokeReason: z.string().max(500).nullable(),
});

export const auditEventSchema = z.strictObject({
  id: opaqueIdSchema,
  actorUserId: opaqueIdSchema,
  action: z.string().min(3).max(100),
  targetType: z.string().min(3).max(50),
  targetId: z.string().min(1).max(128),
  reason: z.string().max(500).nullable(),
  createdAt: isoDateTimeSchema,
});

export const adminOverviewSchema = z.strictObject({
  users: z.strictObject({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    banned: z.number().int().nonnegative(),
  }),
  entitlements: z.strictObject({
    active: z.number().int().nonnegative(),
    revoked: z.number().int().nonnegative(),
  }),
  pendingStripeEvents: z.number().int().nonnegative(),
});

export const cursorPageQuerySchema = z.strictObject({
  query: z.string().trim().max(120).optional(),
  cursor: opaqueIdSchema.optional(),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type Entitlement = z.infer<typeof entitlementSchema>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type PlatformSettingsContent = z.infer<
  typeof platformSettingsContentSchema
>;
