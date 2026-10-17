import type {
  AdminOverview,
  AdminUser,
  AuditEvent,
  Entitlement,
  PlatformSettings,
  PlatformSettingsContent,
} from '../schemas/admin.js';
import type { UsageReservationResponse } from '@faceless-automations/platform-contracts';
import type {
  GuideAdminDocument,
  GuideAdminSummary,
  GuideContent,
  GuidePublicDocument,
} from '@faceless-automations/platform-contracts';

export interface AuthenticatedSession {
  readonly displayName: string | null;
  readonly email: string;
  readonly expiresAt: string;
  readonly googleSubject: string;
  readonly sessionId: string;
  readonly status: 'active' | 'banned';
  readonly userId: string;
}

export interface GoogleOauthFlow {
  readonly allocationKey: string;
  readonly client: 'dashboard' | 'extension';
  readonly encryptedCodeVerifier: string;
  readonly expiresAt: string;
  readonly extensionFlowId: string | null;
  readonly nonceHash: string;
  readonly stateHash: string;
}

export interface ExtensionAuthFlow {
  readonly allocationKey: string;
  readonly appId: string;
  readonly codeChallenge: string;
  readonly expiresAt: string;
  readonly extensionOrigin: string;
  readonly flowId: string;
  readonly initiatorVerifiedAt: string | null;
  readonly protocolVersion: 1 | 2;
  readonly status: 'pending' | 'authorized' | 'denied' | 'consumed';
  readonly userId: string | null;
  readonly userCodeHash: string;
  readonly verificationAttempts: number;
}

export type ExtensionGoogleCallbackOutcome =
  | {
      readonly protocolVersion: 1 | 2;
      readonly status: 'bound';
    }
  | {
      readonly protocolVersion: 1 | 2;
      readonly status: 'already_bound';
    }
  | {
      readonly status: 'unavailable';
    };

export interface ExtensionSessionGrant {
  readonly displayName: string | null;
  readonly email: string;
  readonly planCode: 'all-apps' | 'free-plan' | 'single-license';
  readonly userId: string;
}

export interface AppSessionRecord {
  readonly appId: string;
  readonly expiresAt: string;
  readonly extensionOrigin: string;
  readonly sessionId: string;
  readonly status: 'active' | 'banned';
  readonly userId: string;
}

export interface GoogleIdentity {
  readonly displayName: string | null;
  readonly email: string;
  readonly issuer: string;
  readonly subject: string;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AuditCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface AuditCursorPage {
  readonly items: readonly AuditEvent[];
  readonly nextCursor: AuditCursor | null;
}

export interface RateLimitBucket {
  readonly expiresAt: string;
  readonly key: string;
  readonly limit: number;
  readonly windowStartedAt: string;
}

export interface UsageReservationTransition {
  readonly acceptanceId: string | null;
  readonly appId: string;
  readonly authorizationId: string;
  readonly finalizedAt: string | null;
  readonly finalizeBy: string | null;
  readonly operation: string;
  readonly status:
    'accepted' | 'consumed' | 'cancelled' | 'rolled_back' | 'expired';
}

export type UsageReservationAuthorizationResult =
  | {
      readonly kind: 'decision';
      readonly reservation: UsageReservationResponse;
    }
  | { readonly kind: 'idempotency_conflict' };

export interface DatabasePort {
  ping(): Promise<void>;
  getCurrentMigrationVersion(): Promise<string | null>;
  consumeRateLimits(buckets: readonly RateLimitBucket[]): Promise<boolean>;
  createGoogleOauthFlow(
    flow: GoogleOauthFlow,
    maximumConcurrentFlows: number,
  ): Promise<boolean>;
  takeGoogleOauthFlow(
    stateHash: string,
    now: string,
  ): Promise<GoogleOauthFlow | null>;
  createGoogleSession(input: {
    identity: GoogleIdentity;
    newUserId: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<AuthenticatedSession>;
  getSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<AuthenticatedSession | null>;
  revokeSession(sessionId: string, now: string): Promise<void>;
  claimAdminIdentity(input: {
    auditId: string;
    auditTargetId: string;
    email: string;
    issuer: string;
    now: string;
    subject: string;
    userId: string;
  }): Promise<boolean>;
  isAdminIdentity(input: { subject: string; userId: string }): Promise<boolean>;
  createExtensionAuthFlow(
    flow: ExtensionAuthFlow,
    maximumConcurrentFlows: number,
  ): Promise<boolean>;
  getExtensionAuthFlow(
    flowId: string,
    now: string,
  ): Promise<ExtensionAuthFlow | null>;
  completeExtensionGoogleCallback(input: {
    flowId: string;
    now: string;
    userId: string;
  }): Promise<ExtensionGoogleCallbackOutcome>;
  verifyExtensionAuthFlow(input: {
    flowId: string;
    maximumAttempts: number;
    now: string;
    userId: string;
    userCodeHash: string;
  }): Promise<{
    attempts: number;
    status: 'verified' | 'invalid' | 'unavailable';
  }>;
  denyExtensionAuthFlow(flowId: string, now: string): Promise<void>;
  consumeExtensionAuthFlow(input: {
    appSessionId: string;
    appTokenHash: string;
    codeChallenge: string;
    expiresAt: string;
    extensionOrigin: string;
    flowId: string;
    now: string;
  }): Promise<ExtensionSessionGrant | null>;
  getAppSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<AppSessionRecord | null>;
  authorizeUsage(input: {
    appSessionId: string;
    appId: string;
    authorizationId: string;
    authorizationExpiresAt: string;
    dailyUnitLimit: number;
    idempotencyKey: string;
    now: string;
    operation: string;
    protocolVersion: 1 | 2;
    resetsAt: string;
    units: number;
    userId: string;
  }): Promise<UsageReservationAuthorizationResult | null>;
  acceptUsageReservation(input: {
    acceptanceId: string;
    acceptanceExpiresAt: string;
    appId: string;
    authorizationId: string;
    eventId: string;
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<UsageReservationTransition | null>;
  finalizeUsageReservation(input: {
    acceptanceId: string;
    appId: string;
    authorizationId: string;
    eventId: string;
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<UsageReservationTransition | null>;
  rollbackUsageReservation(input: {
    acceptanceId: string;
    appId: string;
    authorizationId: string;
    eventId: string;
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<UsageReservationTransition | null>;
  consumeLegacyUsageReservation(input: {
    acceptanceId: string;
    appId: string;
    authorizationId: string;
    eventId: string;
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<UsageReservationTransition | null>;
  cancelUsageReservation(input: {
    appId: string;
    authorizationId: string;
    eventId: string;
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<UsageReservationTransition | null>;
  getPlatformSettings(): Promise<PlatformSettings>;
  getPublishedGuide(slug: string): Promise<GuidePublicDocument | null>;
  listGuides(): Promise<readonly GuideAdminSummary[]>;
  getGuide(slug: string): Promise<GuideAdminDocument | null>;
  createGuide(input: {
    actorUserId: string;
    appId: string;
    auditId: string;
    content: GuideContent;
    now: string;
    slug: string;
    status: 'draft' | 'published';
    summary: string;
    title: string;
  }): Promise<GuideAdminDocument | null>;
  updateGuide(input: {
    actorUserId: string;
    appId: string;
    auditId: string;
    content: GuideContent;
    expectedRevision: string;
    now: string;
    slug: string;
    status: 'draft' | 'published';
    summary: string;
    title: string;
  }): Promise<GuideAdminDocument | null>;
  updatePlatformSettings(input: {
    actorUserId: string;
    expectedRevision: string;
    value: PlatformSettingsContent;
    now: string;
    auditId: string;
  }): Promise<PlatformSettings | null>;
  getAdminOverview(): Promise<AdminOverview>;
  listUsers(input: {
    query?: string;
    cursor?: string;
    limit: number;
  }): Promise<CursorPage<AdminUser>>;
  setUserBan(input: {
    actorUserId: string;
    auditId: string;
    ban: boolean;
    now: string;
    reason: string;
    userId: string;
  }): Promise<boolean>;
  listEntitlements(input: {
    query?: string;
    cursor?: string;
    limit: number;
  }): Promise<CursorPage<Entitlement>>;
  revokeEntitlement(input: {
    actorUserId: string;
    auditId: string;
    entitlementId: string;
    now: string;
    reason: string;
  }): Promise<boolean>;
  listAuditEvents(input: {
    cursor?: AuditCursor;
    limit: number;
  }): Promise<AuditCursorPage>;
  enqueueStripeEvent(input: {
    eventId: string;
    eventType: string;
    livemode: boolean;
    payload: string;
    receivedAt: string;
  }): Promise<boolean>;
}
