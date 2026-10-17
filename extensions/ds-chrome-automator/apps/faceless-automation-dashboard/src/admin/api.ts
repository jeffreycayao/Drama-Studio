import {
  createGuideRequestSchema,
  guideAdminDocumentSchema,
  guideAdminListResponseSchema,
  guideAdminSummarySchema,
  guideBlockSchema,
  guideContentSchema,
  guidePublicDocumentSchema,
  guideSlugSchema,
  updateGuideRequestSchema,
  type CreateGuideRequest,
  type GuideAdminDocument as SharedGuideAdminDocument,
  type GuideAdminSummary as SharedGuideAdminSummary,
  type GuideContent as SharedGuideContent,
  type GuidePublicDocument as SharedGuidePublicDocument,
  type UpdateGuideRequest,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod';

import { platformApiOrigin } from '../config/public-env';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const opaqueIdSchema = z.string().min(8).max(128);
const auditCursorSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/u);
const emailSchema = z.string().email().max(320);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);
const extensionUserCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u,
  );
const localFontFamilySchema = z.enum([
  'Instrument Serif',
  'Manrope',
  'IBM Plex Mono',
]);

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(left: string, right: string): number {
  const bright = Math.max(relativeLuminance(left), relativeLuminance(right));
  const dark = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (bright + 0.05) / (dark + 0.05);
}

const httpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Expected a public HTTPS URL without credentials.',
      });
    }
  });

const platformThemeSchema = z
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
      display: localFontFamilySchema,
      body: localFontFamilySchema,
      metadata: localFontFamilySchema,
    }),
  })
  .superRefine(({ colors }, context) => {
    for (const [path, left, right] of [
      ['ink', colors.ink, colors.canvas],
      ['mutedInk', colors.mutedInk, colors.canvas],
      ['surfaceInk', colors.ink, colors.surface],
      ['goldAction', colors.gold, colors.canvas],
    ] as const) {
      if (contrastRatio(left, right) < 4.5) {
        context.addIssue({
          code: 'custom',
          message: 'Platform colors must retain at least 4.5:1 contrast.',
          path: ['colors', path],
        });
      }
    }
  });

const apiErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(256),
    requestId: z.string().min(8).max(128),
  }),
});

export const adminSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  account: z.strictObject({
    userId: opaqueIdSchema,
    provider: z.literal('google'),
    email: emailSchema,
    displayName: z.string().min(1).max(120).nullable(),
    role: z.literal('admin'),
  }),
  csrfToken: z.string().min(32).max(512),
  expiresAt: isoDateTimeSchema,
});

const extensionAuthFlowV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  flowId: opaqueIdSchema,
  appId: z.literal('grok-automator'),
  appDisplayName: z.literal('Grok Automator™'),
  status: z.enum(['pending', 'authorized', 'denied', 'expired', 'consumed']),
  expiresAt: isoDateTimeSchema,
});

const extensionAuthFlowV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  flowId: opaqueIdSchema,
  appId: z.literal('grok-automator'),
  appDisplayName: z.literal('Grok Automator™'),
  status: z.enum([
    'verification_required',
    'pending',
    'authorized',
    'denied',
    'expired',
    'consumed',
  ]),
  verificationAttemptsRemaining: z.number().int().min(0).max(5),
  csrfToken: z.string().min(32).max(128).nullable(),
  expiresAt: isoDateTimeSchema,
});

export const extensionAuthFlowSchema = z.union([
  extensionAuthFlowV2Schema,
  extensionAuthFlowV1Schema,
]);

export const extensionAuthVerificationSchema = z.strictObject({
  schemaVersion: z.literal(2),
  flowId: opaqueIdSchema,
  status: z.literal('verified'),
  attemptsRemaining: z.number().int().min(0).max(5),
});

export const platformSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(128),
  updatedAt: isoDateTimeSchema,
  seo: z.strictObject({
    siteTitle: z.string().trim().min(1).max(60),
    siteDescription: z.string().trim().min(1).max(160),
    openGraphTitle: z.string().trim().min(1).max(60),
    openGraphDescription: z.string().trim().min(1).max(200),
    socialImageUrl: httpsUrlSchema.nullable(),
  }),
  theme: platformThemeSchema,
});

export const guideAdminListSchema = guideAdminListResponseSchema;
export const guideUpdateInputSchema = updateGuideRequestSchema;
export const guideCreateInputSchema = createGuideRequestSchema;

export {
  guideAdminDocumentSchema,
  guideAdminSummarySchema,
  guideBlockSchema,
  guideContentSchema,
  guidePublicDocumentSchema,
};

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

export const adminUserSchema = z.strictObject({
  id: opaqueIdSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(120).nullable(),
  status: z.enum(['active', 'banned']),
  createdAt: isoDateTimeSchema,
  lastLoginAt: isoDateTimeSchema.nullable(),
  bannedAt: isoDateTimeSchema.nullable(),
  banReason: z.string().min(1).max(300).nullable(),
});

export const adminUserListSchema = z.strictObject({
  items: z.array(adminUserSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable(),
});

export const adminEntitlementSchema = z.strictObject({
  id: opaqueIdSchema,
  userId: opaqueIdSchema,
  userEmail: emailSchema,
  code: z.string().min(1).max(128),
  status: z.enum(['active', 'revoked', 'expired']),
  source: z.enum(['stripe', 'admin', 'migration']),
  grantedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  revokeReason: z.string().min(1).max(300).nullable(),
});

export const adminEntitlementListSchema = z.strictObject({
  items: z.array(adminEntitlementSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable(),
});

export const adminAuditEventSchema = z.strictObject({
  id: opaqueIdSchema,
  actorUserId: opaqueIdSchema,
  action: z.string().min(1).max(120),
  targetType: z.string().min(1).max(120),
  targetId: z.string().min(1).max(256),
  reason: z.string().min(1).max(300).nullable(),
  createdAt: isoDateTimeSchema,
});

export const adminAuditEventListSchema = z.strictObject({
  items: z.array(adminAuditEventSchema).max(100),
  nextCursor: auditCursorSchema.nullable(),
});

const mutationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: isoDateTimeSchema,
});

export type AdminSession = z.infer<typeof adminSessionSchema>;
export type ExtensionAuthFlow = z.infer<typeof extensionAuthFlowSchema>;
export type ExtensionAuthVerification = z.infer<
  typeof extensionAuthVerificationSchema
>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type GuideContent = SharedGuideContent;
export type GuideBlock = GuideContent['sections'][number]['blocks'][number];
export type GuidePublicDocument = SharedGuidePublicDocument;
export type GuideAdminDocument = SharedGuideAdminDocument;
export type GuideAdminSummary = SharedGuideAdminSummary;
export type GuideAdminList = z.infer<typeof guideAdminListSchema>;
export type GuideUpdateInput = UpdateGuideRequest;
export type GuideCreateInput = CreateGuideRequest;
export type AdminOverview = z.infer<typeof adminOverviewSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserList = z.infer<typeof adminUserListSchema>;
export type AdminEntitlement = z.infer<typeof adminEntitlementSchema>;
export type AdminEntitlementList = z.infer<typeof adminEntitlementListSchema>;
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;
export type AdminAuditEventList = z.infer<typeof adminAuditEventListSchema>;
export type LocalFontFamily = z.infer<typeof localFontFamilySchema>;

export type ApiFailureKind =
  | 'not-configured'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'unavailable'
  | 'invalid-response'
  | 'request-failed';

export class ApiFailure extends Error {
  readonly kind: ApiFailureKind;
  readonly requestId: string | null;

  constructor(
    kind: ApiFailureKind,
    message: string,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.kind = kind;
    this.requestId = requestId;
  }
}

export interface PlatformApi {
  getPublicPlatformSettings(signal?: AbortSignal): Promise<PlatformSettings>;
  getPublicGuide(
    slug: string,
    signal?: AbortSignal,
  ): Promise<GuidePublicDocument>;
  getExtensionAuthFlow(
    flowId: string,
    signal?: AbortSignal,
  ): Promise<ExtensionAuthFlow>;
  verifyExtensionAuthFlow(
    flowId: string,
    userCode: string,
    csrfToken: string,
    signal?: AbortSignal,
  ): Promise<ExtensionAuthVerification>;
  getAdminSession(signal?: AbortSignal): Promise<AdminSession>;
  getAdminOverview(signal?: AbortSignal): Promise<AdminOverview>;
  listGuides(signal?: AbortSignal): Promise<GuideAdminList>;
  createGuide(input: GuideCreateInput): Promise<GuideAdminDocument>;
  getGuide(slug: string, signal?: AbortSignal): Promise<GuideAdminDocument>;
  updateGuide(
    slug: string,
    input: GuideUpdateInput,
  ): Promise<GuideAdminDocument>;
  getPlatformSettings(signal?: AbortSignal): Promise<PlatformSettings>;
  updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings>;
  listUsers(query: string, signal?: AbortSignal): Promise<AdminUserList>;
  setUserBan(userId: string, banned: boolean, reason: string): Promise<void>;
  listEntitlements(
    query: string,
    signal?: AbortSignal,
  ): Promise<AdminEntitlementList>;
  revokeEntitlement(entitlementId: string, reason: string): Promise<void>;
  listAuditEvents(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<AdminAuditEventList>;
  logout(): Promise<void>;
}

interface ApiClientOptions {
  origin?: string | null;
  fetchImplementation?: typeof fetch;
  csrfToken?: string | null;
}

interface RequestPolicy {
  csrf: 'required' | 'not-required';
}

function toFailureKind(status: number): ApiFailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 429 || status >= 500) return 'unavailable';
  return 'request-failed';
}

function buildSearch(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return '';
  const search = new URLSearchParams({ query: trimmed });
  return `?${search.toString()}`;
}

export function createPlatformApi(options: ApiClientOptions = {}): PlatformApi {
  const origin =
    options.origin === undefined ? platformApiOrigin : options.origin;
  const requestFetch = options.fetchImplementation ?? fetch;
  const csrfToken = options.csrfToken ?? null;

  async function request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    init: RequestInit = {},
    policy: RequestPolicy = { csrf: 'required' },
  ): Promise<z.infer<TSchema>> {
    if (origin === null) {
      throw new ApiFailure(
        'not-configured',
        'The platform API origin is not configured.',
      );
    }

    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined && init.body !== null) {
      headers.set('Content-Type', 'application/json');
      if (policy.csrf === 'required') {
        if (csrfToken === null) {
          throw new ApiFailure(
            'forbidden',
            'A verified administrator session is required.',
          );
        }
        headers.set('X-Faceless-CSRF', csrfToken);
      }
    }

    let response: Response;
    try {
      response = await requestFetch(new URL(path, origin), {
        ...init,
        headers,
        credentials: 'include',
        redirect: 'error',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new ApiFailure('network', 'The platform API could not be reached.');
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const parsedError = apiErrorEnvelopeSchema.safeParse(body);
      throw new ApiFailure(
        toFailureKind(response.status),
        parsedError.success
          ? parsedError.data.error.message
          : 'The platform API rejected the request.',
        parsedError.success ? parsedError.data.error.requestId : null,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new ApiFailure(
        'invalid-response',
        'The platform API returned an unexpected response.',
      );
    }

    const body: unknown = await response.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure(
        'invalid-response',
        'The platform API returned invalid data.',
      );
    }
    return parsed.data;
  }

  async function mutate(
    path: string,
    method: 'POST' | 'PUT',
    body: unknown,
  ): Promise<void> {
    await request(path, mutationResultSchema, {
      method,
      body: JSON.stringify(body),
    });
  }

  function signalInit(signal: AbortSignal | undefined): RequestInit {
    return signal === undefined ? {} : { signal };
  }

  return {
    getPublicPlatformSettings: (signal) =>
      request(
        '/v1/platform-settings',
        platformSettingsSchema,
        signalInit(signal),
      ),
    getPublicGuide: async (slug, signal) => {
      const requestedSlug = guideSlugSchema.safeParse(slug);
      if (!requestedSlug.success) {
        throw new ApiFailure('not-found', 'The requested guide was not found.');
      }
      const guide = await request(
        `/v1/guides/${encodeURIComponent(requestedSlug.data)}`,
        guidePublicDocumentSchema,
        signalInit(signal),
      );
      if (guide.slug !== requestedSlug.data) {
        throw new ApiFailure(
          'invalid-response',
          'The platform API returned an unexpected guide.',
        );
      }
      return guide;
    },
    getExtensionAuthFlow: async (flowId, signal) => {
      const requestedFlowId = opaqueIdSchema.safeParse(flowId);
      if (!requestedFlowId.success) {
        throw new ApiFailure(
          'request-failed',
          'The extension sign-in link is invalid.',
        );
      }
      const flow = await request(
        `/v1/auth/extension-flows/${encodeURIComponent(requestedFlowId.data)}`,
        extensionAuthFlowSchema,
        signalInit(signal),
      );
      if (flow.flowId !== requestedFlowId.data) {
        throw new ApiFailure(
          'invalid-response',
          'The platform API returned an unexpected sign-in flow.',
        );
      }
      return flow;
    },
    verifyExtensionAuthFlow: async (flowId, userCode, csrfToken, signal) => {
      const requestedFlowId = opaqueIdSchema.safeParse(flowId);
      const requestedUserCode = extensionUserCodeSchema.safeParse(userCode);
      const requestedCsrfToken = z
        .string()
        .min(32)
        .max(128)
        .safeParse(csrfToken);
      if (
        !requestedFlowId.success ||
        !requestedUserCode.success ||
        !requestedCsrfToken.success
      ) {
        throw new ApiFailure(
          'request-failed',
          'The extension verification request is invalid.',
        );
      }
      const result = await request(
        `/v1/auth/extension-flows/${encodeURIComponent(requestedFlowId.data)}/verify`,
        extensionAuthVerificationSchema,
        {
          ...signalInit(signal),
          method: 'POST',
          headers: {
            'X-Faceless-CSRF': requestedCsrfToken.data,
          },
          body: JSON.stringify({
            schemaVersion: 2,
            userCode: requestedUserCode.data,
          }),
        },
        { csrf: 'not-required' },
      );
      if (result.flowId !== requestedFlowId.data) {
        throw new ApiFailure(
          'invalid-response',
          'The platform API returned an unexpected verification flow.',
        );
      }
      return result;
    },
    getAdminSession: (signal) =>
      request('/v1/admin/session', adminSessionSchema, signalInit(signal)),
    getAdminOverview: (signal) =>
      request('/v1/admin/overview', adminOverviewSchema, signalInit(signal)),
    listGuides: (signal) =>
      request('/v1/admin/guides', guideAdminListSchema, signalInit(signal)),
    createGuide: async (input) => {
      const requestedInput = guideCreateInputSchema.safeParse(input);
      if (!requestedInput.success) {
        throw new ApiFailure(
          'request-failed',
          'Review the guide fields and structured content before creating it.',
        );
      }
      const guide = await request(
        '/v1/admin/guides',
        guideAdminDocumentSchema,
        {
          method: 'POST',
          body: JSON.stringify(requestedInput.data),
        },
      );
      if (guide.slug !== requestedInput.data.slug) {
        throw new ApiFailure(
          'invalid-response',
          'The platform API returned an unexpected guide.',
        );
      }
      return guide;
    },
    getGuide: async (slug, signal) => {
      const requestedSlug = guideSlugSchema.safeParse(slug);
      if (!requestedSlug.success) {
        throw new ApiFailure('not-found', 'The requested guide was not found.');
      }
      const guide = await request(
        `/v1/admin/guides/${encodeURIComponent(requestedSlug.data)}`,
        guideAdminDocumentSchema,
        signalInit(signal),
      );
      if (guide.slug !== requestedSlug.data) {
        throw new ApiFailure(
          'invalid-response',
          'The platform API returned an unexpected guide.',
        );
      }
      return guide;
    },
    updateGuide: async (slug, input) => {
      const requestedSlug = guideSlugSchema.safeParse(slug);
      const requestedInput = guideUpdateInputSchema.safeParse(input);
      if (!requestedSlug.success || !requestedInput.success) {
        throw new ApiFailure(
          'request-failed',
          'Review the guide fields and structured content before saving.',
        );
      }
      const guide = await request(
        `/v1/admin/guides/${encodeURIComponent(requestedSlug.data)}`,
        guideAdminDocumentSchema,
        {
          method: 'PUT',
          body: JSON.stringify(requestedInput.data),
        },
      );
      if (guide.slug !== requestedSlug.data) {
        throw new ApiFailure(
          'invalid-response',
          'The platform API returned an unexpected guide.',
        );
      }
      return guide;
    },
    getPlatformSettings: (signal) =>
      request(
        '/v1/admin/platform-settings',
        platformSettingsSchema,
        signalInit(signal),
      ),
    updatePlatformSettings: (settings) =>
      request('/v1/admin/platform-settings', platformSettingsSchema, {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: settings.revision,
          seo: settings.seo,
          theme: settings.theme,
        }),
      }),
    listUsers: (query, signal) =>
      request(
        `/v1/admin/users${buildSearch(query)}`,
        adminUserListSchema,
        signalInit(signal),
      ),
    setUserBan: (userId, banned, reason) =>
      mutate(
        `/v1/admin/users/${encodeURIComponent(userId)}/${banned ? 'ban' : 'unban'}`,
        'POST',
        { reason },
      ),
    listEntitlements: (query, signal) =>
      request(
        `/v1/admin/entitlements${buildSearch(query)}`,
        adminEntitlementListSchema,
        signalInit(signal),
      ),
    revokeEntitlement: (entitlementId, reason) =>
      mutate(
        `/v1/admin/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
        'POST',
        { reason },
      ),
    listAuditEvents: (cursor, signal) => {
      const parsedCursor = auditCursorSchema.optional().safeParse(cursor);
      if (!parsedCursor.success) {
        return Promise.reject(
          new ApiFailure('request-failed', 'The audit cursor is invalid.'),
        );
      }
      const search =
        parsedCursor.data === undefined
          ? ''
          : `?${new URLSearchParams({ cursor: parsedCursor.data }).toString()}`;
      return request(
        `/v1/admin/audit-events${search}`,
        adminAuditEventListSchema,
        signalInit(signal),
      );
    },
    logout: () => mutate('/v1/auth/logout', 'POST', {}),
  };
}

export function createAuthorizedPlatformApi(
  session: AdminSession,
  options: Omit<ApiClientOptions, 'csrfToken'> = {},
): PlatformApi {
  return createPlatformApi({ ...options, csrfToken: session.csrfToken });
}

export function isApiFailure(error: unknown): error is ApiFailure {
  return error instanceof ApiFailure;
}
