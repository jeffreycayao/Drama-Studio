import type {
  GuideAdminDocument,
  GuidePublicDocument,
  UsageReservationResponse,
} from '@faceless-automations/platform-contracts';

import type {
  AppSessionRecord,
  AuthenticatedSession,
  DatabasePort,
  ExtensionAuthFlow,
  ExtensionSessionGrant,
  GoogleOauthFlow,
  RateLimitBucket,
  UsageReservationTransition,
} from '../src/ports/database.js';
import type {
  AdminOverview,
  AdminUser,
  AuditEvent,
  Entitlement,
  PlatformSettings,
} from '../src/schemas/admin.js';

export const timestamp = '2026-08-16T00:00:00.000Z';

export const platformSettings: PlatformSettings = {
  revision: '0',
  schemaVersion: 1,
  seo: {
    openGraphDescription: 'Automation products for creator workflows.',
    openGraphTitle: 'Paks Tools Faceless automations',
    siteDescription: 'Automation products for creator workflows.',
    siteTitle: 'Paks Tools Faceless automations',
    socialImageUrl: null,
  },
  theme: {
    colors: {
      border: '#333333',
      canvas: '#0A0A0A',
      gold: '#D4AF37',
      ink: '#FFFFFF',
      mutedInk: '#B8B8B8',
      surface: '#1C1C1C',
    },
    fonts: {
      body: 'Manrope',
      display: 'Instrument Serif',
      metadata: 'IBM Plex Mono',
    },
  },
  updatedAt: timestamp,
};

export const guideContent = {
  schemaVersion: 1 as const,
  sections: [
    {
      id: 'start',
      title: 'Start',
      blocks: [{ type: 'paragraph' as const, text: 'Open the extension.' }],
    },
  ],
};

export const adminGuide: GuideAdminDocument = {
  appId: 'grok-automator',
  content: guideContent,
  createdAt: timestamp,
  publishedAt: timestamp,
  revision: '0',
  schemaVersion: 1,
  slug: 'grok-automator',
  status: 'published',
  summary: 'A safe operating guide.',
  title: 'Grok Automator guide',
  updatedAt: timestamp,
  updatedBy: null,
};

export const publicGuide: GuidePublicDocument = {
  appId: adminGuide.appId,
  content: adminGuide.content,
  createdAt: adminGuide.createdAt,
  publishedAt: adminGuide.publishedAt ?? timestamp,
  revision: adminGuide.revision,
  schemaVersion: 1,
  slug: adminGuide.slug,
  summary: adminGuide.summary,
  title: adminGuide.title,
  updatedAt: adminGuide.updatedAt,
};

export const adminSession: AuthenticatedSession = {
  displayName: 'Owner',
  email: 'owner@example.com',
  expiresAt: '2026-08-16T08:00:00.000Z',
  googleSubject: 'google-owner-subject',
  sessionId: 'session_identifier_0001',
  status: 'active',
  userId: 'user_identifier_000001',
};

export class FakeDatabase implements DatabasePort {
  public session: AuthenticatedSession | null = adminSession;
  public stripeEventInserted = true;
  public banCalled = false;
  public entitlementRevoked = false;
  public oauthFlow: GoogleOauthFlow | null = null;
  public googleSession: AuthenticatedSession = adminSession;
  public readonly revokedSessionIds: string[] = [];
  public adminIdentityAuthorized = false;
  public adminIdentityClaimed = false;
  public adminIdentityClaimResult = true;
  public adminIdentityClaimInput:
    Parameters<DatabasePort['claimAdminIdentity']>[0] | null = null;
  public guide: GuideAdminDocument | null = adminGuide;
  public extensionFlow: ExtensionAuthFlow | null = null;
  public extensionFlowCreationAllowed = true;
  public extensionFlowUserId: string | null = null;
  public extensionSessionGrant: ExtensionSessionGrant | null = {
    displayName: 'Extension User',
    email: 'extension-user@example.com',
    planCode: 'single-license',
    userId: 'extension_user_identifier_0001',
  };
  public appSession: AppSessionRecord | null = null;
  public appSessionTokenHash: string | null = null;
  public rateLimitsAllowed = true;
  public readonly rateLimitCalls: (readonly RateLimitBucket[])[] = [];
  public currentMigrationVersion: string | null = '0005_guide_cms';
  public usageAuthorization: UsageReservationResponse | null = {
    allowed: false,
    appId: 'grok-automator',
    operation: 'automation.run',
    reason: 'entitlement_required',
    remainingUnits: 0,
    resetsAt: '2026-08-17T00:00:00.000Z',
    schemaVersion: 2,
    status: 'denied',
  };
  public usageAuthorizationInput:
    Parameters<DatabasePort['authorizeUsage']>[0] | null = null;
  public usageIdempotencyConflict = false;

  public async ping(): Promise<void> {}

  public async getCurrentMigrationVersion(): Promise<string | null> {
    return this.currentMigrationVersion;
  }

  public async consumeRateLimits(
    buckets: readonly RateLimitBucket[],
  ): Promise<boolean> {
    this.rateLimitCalls.push(buckets);
    return this.rateLimitsAllowed;
  }

  public async createGoogleOauthFlow(flow: GoogleOauthFlow): Promise<boolean> {
    this.oauthFlow = flow;
    return true;
  }

  public async takeGoogleOauthFlow(
    stateHash: string,
    now: string,
  ): Promise<GoogleOauthFlow | null> {
    const flow = this.oauthFlow;
    if (flow === null) return null;
    if (
      flow.stateHash !== stateHash ||
      Date.parse(flow.expiresAt) <= Date.parse(now)
    ) {
      return null;
    }
    this.oauthFlow = null;
    return flow;
  }

  public async createGoogleSession(): Promise<AuthenticatedSession> {
    return this.googleSession;
  }

  public async getSessionByTokenHash(): Promise<AuthenticatedSession | null> {
    return this.session;
  }

  public async revokeSession(sessionId: string): Promise<void> {
    this.revokedSessionIds.push(sessionId);
  }

  public async claimAdminIdentity(
    input: Parameters<DatabasePort['claimAdminIdentity']>[0],
  ): Promise<boolean> {
    this.adminIdentityClaimed = true;
    this.adminIdentityClaimInput = input;
    if (this.adminIdentityClaimResult) this.adminIdentityAuthorized = true;
    return this.adminIdentityClaimResult;
  }

  public async isAdminIdentity(): Promise<boolean> {
    return this.adminIdentityAuthorized;
  }

  public async createExtensionAuthFlow(
    flow: ExtensionAuthFlow,
  ): Promise<boolean> {
    if (!this.extensionFlowCreationAllowed) return false;
    this.extensionFlow = flow;
    this.extensionFlowUserId = null;
    return true;
  }

  public async getExtensionAuthFlow(
    flowId: string,
  ): Promise<ExtensionAuthFlow | null> {
    return this.extensionFlow?.flowId === flowId ? this.extensionFlow : null;
  }

  public async completeExtensionGoogleCallback(input: {
    flowId: string;
    now: string;
    userId: string;
  }): ReturnType<DatabasePort['completeExtensionGoogleCallback']> {
    const flow = this.extensionFlow;
    if (flow?.flowId !== input.flowId) {
      return { status: 'unavailable' };
    }
    if (flow.userId !== null) {
      return {
        protocolVersion: flow.protocolVersion,
        status: 'already_bound',
      };
    }
    if (
      flow.status !== 'pending' ||
      Date.parse(flow.expiresAt) <= Date.parse(input.now)
    ) {
      return { status: 'unavailable' };
    }
    this.extensionFlow = {
      ...flow,
      status: flow.protocolVersion === 1 ? 'authorized' : 'pending',
      userId: input.userId,
    };
    this.extensionFlowUserId = input.userId;
    return { protocolVersion: flow.protocolVersion, status: 'bound' };
  }

  public async verifyExtensionAuthFlow(input: {
    flowId: string;
    maximumAttempts: number;
    now: string;
    userId: string;
    userCodeHash: string;
  }): Promise<{
    attempts: number;
    status: 'verified' | 'invalid' | 'unavailable';
  }> {
    const flow = this.extensionFlow;
    if (
      flow?.flowId !== input.flowId ||
      flow.status !== 'pending' ||
      flow.protocolVersion !== 2 ||
      flow.userId !== input.userId ||
      Date.parse(flow.expiresAt) <= Date.parse(input.now) ||
      flow.verificationAttempts >= input.maximumAttempts
    ) {
      return { attempts: input.maximumAttempts, status: 'unavailable' };
    }
    if (flow.initiatorVerifiedAt !== null) {
      return { attempts: flow.verificationAttempts, status: 'verified' };
    }
    const attempts = flow.verificationAttempts + 1;
    if (flow.userCodeHash === input.userCodeHash) {
      this.extensionFlow = {
        ...flow,
        initiatorVerifiedAt: input.now,
        status: 'authorized',
        verificationAttempts: attempts,
      };
      return { attempts, status: 'verified' };
    }
    this.extensionFlow = {
      ...flow,
      status: attempts >= input.maximumAttempts ? 'denied' : flow.status,
      verificationAttempts: attempts,
    };
    return { attempts, status: 'invalid' };
  }

  public async denyExtensionAuthFlow(flowId: string): Promise<void> {
    if (
      this.extensionFlow?.flowId === flowId &&
      this.extensionFlow.status === 'pending' &&
      (this.extensionFlow.protocolVersion === 1 ||
        this.extensionFlow.userId === null)
    ) {
      this.extensionFlow = { ...this.extensionFlow, status: 'denied' };
    }
  }

  public async consumeExtensionAuthFlow(input: {
    appSessionId: string;
    appTokenHash: string;
    codeChallenge: string;
    expiresAt: string;
    extensionOrigin: string;
    flowId: string;
    now: string;
  }): Promise<ExtensionSessionGrant | null> {
    const flow = this.extensionFlow;
    const grant = this.extensionSessionGrant;
    if (flow === null || grant === null) return null;
    if (
      flow.userId !== grant.userId ||
      flow.flowId !== input.flowId ||
      flow.status !== 'authorized' ||
      flow.codeChallenge !== input.codeChallenge ||
      flow.extensionOrigin !== input.extensionOrigin ||
      Date.parse(flow.expiresAt) <= Date.parse(input.now)
    ) {
      return null;
    }
    this.extensionFlow = { ...flow, status: 'consumed' };
    this.appSessionTokenHash = input.appTokenHash;
    this.appSession = {
      appId: flow.appId,
      expiresAt: input.expiresAt,
      extensionOrigin: flow.extensionOrigin,
      sessionId: input.appSessionId,
      status: 'active',
      userId: grant.userId,
    };
    return grant;
  }

  public async getAppSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<AppSessionRecord | null> {
    const appSession = this.appSession;
    if (appSession === null) return null;
    if (
      this.appSessionTokenHash !== tokenHash ||
      Date.parse(appSession.expiresAt) <= Date.parse(now)
    ) {
      return null;
    }
    return appSession;
  }

  public async authorizeUsage(
    input: Parameters<DatabasePort['authorizeUsage']>[0],
  ): ReturnType<DatabasePort['authorizeUsage']> {
    this.usageAuthorizationInput = input;
    if (this.usageIdempotencyConflict) return { kind: 'idempotency_conflict' };
    return this.usageAuthorization === null
      ? null
      : { kind: 'decision', reservation: this.usageAuthorization };
  }

  public async acceptUsageReservation(input: {
    acceptanceId: string;
    acceptanceExpiresAt: string;
    appId: string;
    authorizationId: string;
    now: string;
  }): Promise<UsageReservationTransition | null> {
    return {
      acceptanceId: input.acceptanceId,
      appId: input.appId,
      authorizationId: input.authorizationId,
      finalizedAt: null,
      finalizeBy: input.acceptanceExpiresAt,
      operation: 'automation.run',
      status: 'accepted',
    };
  }

  public async finalizeUsageReservation(input: {
    acceptanceId: string;
    appId: string;
    authorizationId: string;
    now: string;
  }): Promise<UsageReservationTransition | null> {
    return {
      acceptanceId: input.acceptanceId,
      appId: input.appId,
      authorizationId: input.authorizationId,
      finalizedAt: input.now,
      finalizeBy: null,
      operation: 'automation.run',
      status: 'consumed',
    };
  }

  public async rollbackUsageReservation(input: {
    acceptanceId: string;
    appId: string;
    authorizationId: string;
    now: string;
  }): Promise<UsageReservationTransition | null> {
    return {
      acceptanceId: input.acceptanceId,
      appId: input.appId,
      authorizationId: input.authorizationId,
      finalizedAt: input.now,
      finalizeBy: null,
      operation: 'automation.run',
      status: 'rolled_back',
    };
  }

  public async consumeLegacyUsageReservation(input: {
    acceptanceId: string;
    appId: string;
    authorizationId: string;
    now: string;
  }): Promise<UsageReservationTransition | null> {
    const current = this.usageAuthorization;
    if (current?.allowed === true) {
      this.usageAuthorization = {
        ...current,
        finalizedAt: input.now,
        status: 'consumed',
      };
    }
    return {
      acceptanceId: input.acceptanceId,
      appId: input.appId,
      authorizationId: input.authorizationId,
      finalizedAt: input.now,
      finalizeBy: null,
      operation: 'automation.run',
      status: 'consumed',
    };
  }

  public async cancelUsageReservation(input: {
    appId: string;
    authorizationId: string;
    now: string;
  }): Promise<UsageReservationTransition | null> {
    return {
      acceptanceId: null,
      appId: input.appId,
      authorizationId: input.authorizationId,
      finalizedAt: input.now,
      finalizeBy: null,
      operation: 'automation.run',
      status: 'cancelled',
    };
  }

  public async getPlatformSettings(): Promise<PlatformSettings> {
    return platformSettings;
  }

  public async getPublishedGuide(
    slug: string,
  ): Promise<GuidePublicDocument | null> {
    const guide = this.guide;
    if (
      guide?.slug !== slug ||
      guide.status !== 'published' ||
      guide.publishedAt === null
    ) {
      return null;
    }
    return {
      appId: guide.appId,
      content: guide.content,
      createdAt: guide.createdAt,
      publishedAt: guide.publishedAt,
      revision: guide.revision,
      schemaVersion: 1,
      slug: guide.slug,
      summary: guide.summary,
      title: guide.title,
      updatedAt: guide.updatedAt,
    };
  }

  public async listGuides() {
    const guide = this.guide;
    return guide === null
      ? []
      : [
          {
            appId: guide.appId,
            publishedAt: guide.publishedAt,
            revision: guide.revision,
            schemaVersion: 1 as const,
            slug: guide.slug,
            status: guide.status,
            summary: guide.summary,
            title: guide.title,
            updatedAt: guide.updatedAt,
          },
        ];
  }

  public async getGuide(slug: string): Promise<GuideAdminDocument | null> {
    return this.guide?.slug === slug ? this.guide : null;
  }

  public async createGuide(
    input: Parameters<DatabasePort['createGuide']>[0],
  ): Promise<GuideAdminDocument | null> {
    if (this.guide?.slug === input.slug) return null;
    this.guide = {
      appId: input.appId,
      content: input.content,
      createdAt: input.now,
      publishedAt: input.status === 'published' ? input.now : null,
      revision: '0',
      schemaVersion: 1,
      slug: input.slug,
      status: input.status,
      summary: input.summary,
      title: input.title,
      updatedAt: input.now,
      updatedBy: {
        displayName: adminSession.displayName,
        userId: input.actorUserId,
      },
    };
    return this.guide;
  }

  public async updateGuide(
    input: Parameters<DatabasePort['updateGuide']>[0],
  ): Promise<GuideAdminDocument | null> {
    const guide = this.guide;
    if (
      guide?.slug !== input.slug ||
      guide.revision !== input.expectedRevision
    ) {
      return null;
    }
    this.guide = {
      ...guide,
      appId: input.appId,
      content: input.content,
      publishedAt:
        input.status === 'published' ? (guide.publishedAt ?? input.now) : null,
      revision: String(Number(guide.revision) + 1),
      status: input.status,
      summary: input.summary,
      title: input.title,
      updatedAt: input.now,
      updatedBy: {
        displayName: adminSession.displayName,
        userId: input.actorUserId,
      },
    };
    return this.guide;
  }

  public async updatePlatformSettings(): Promise<PlatformSettings | null> {
    return { ...platformSettings, revision: '1' };
  }

  public async getAdminOverview(): Promise<AdminOverview> {
    return {
      entitlements: { active: 2, revoked: 1 },
      pendingStripeEvents: 0,
      users: { active: 4, banned: 1, total: 5 },
    };
  }

  public async listUsers(): Promise<{
    items: readonly AdminUser[];
    nextCursor: string | null;
  }> {
    return { items: [], nextCursor: null };
  }

  public async setUserBan(): Promise<boolean> {
    this.banCalled = true;
    return true;
  }

  public async listEntitlements(): Promise<{
    items: readonly Entitlement[];
    nextCursor: string | null;
  }> {
    return { items: [], nextCursor: null };
  }

  public async revokeEntitlement(): Promise<boolean> {
    this.entitlementRevoked = true;
    return true;
  }

  public async listAuditEvents(): Promise<{
    items: readonly AuditEvent[];
    nextCursor: { createdAt: string; id: string } | null;
  }> {
    return { items: [], nextCursor: null };
  }

  public async enqueueStripeEvent(): Promise<boolean> {
    return this.stripeEventInserted;
  }
}

export function testEnvironment(): NodeJS.ProcessEnv {
  return {
    ADMIN_GOOGLE_SUBJECTS: adminSession.googleSubject,
    ALLOW_LOCAL_DEVELOPMENT_ORIGINS: 'true',
    CRON_SECRET: 'c'.repeat(48),
    PUBLIC_API_ORIGIN: 'https://api.example.com',
    PUBLIC_APP_ORIGIN: 'https://app.example.com',
    PUBLIC_DEV_ORIGINS:
      'http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.9:5173',
    PUBLIC_EXTENSION_REGISTRATIONS_JSON:
      '[{"appId":"grok-automator","origin":"chrome-extension://abcdefghijklmnopabcdefghijklmnop","environment":"development"}]',
    PUBLIC_WEB_ORIGINS: 'https://app.example.com',
    SESSION_TOKEN_PEPPER: 's'.repeat(48),
    USAGE_AUTHORIZATION_TTL_SECONDS: '60',
    USAGE_DAILY_UNIT_LIMIT: '10',
  };
}
