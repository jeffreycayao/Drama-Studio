import {
  configuredOriginOrDefault,
  DEPLOYED_PLATFORM_API_ORIGIN,
} from '../config/deployment';
import { normalizePlatformWebOrigin } from '../config/platform';
import { readBoundedJson } from '../security/bounded-json';
import {
  clearAppSession,
  GROK_AUTOMATOR_APP_ID,
  loadAppSession,
  type StoredAppSession,
} from './auth-session';
import {
  parseLegacyUsageAuthorizationRequest,
  parseLegacyUsageAuthorizationResponse,
  parseUsageReservationCancelRequest,
  parseUsageReservationConsumeRequest,
  parseUsageReservationRequest,
  parseUsageReservationResponse,
  parseUsageReservationTransitionResponse,
  protocolUnavailableErrorResponseSchema,
} from './usage-contract';

const AUTOMATION_OPERATION = 'automation.run';
const RESPONSE_SIZE_LIMIT = 32 * 1_024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESERVATION_LIFETIME_MS = 5 * 60_000;
const RESERVE_ATTEMPT_LIMIT = 3;
const CONSUME_ATTEMPT_LIMIT = 3;
const LEGACY_AUTHORIZE_ATTEMPT_LIMIT = 3;

class UsageProtocolUnavailableError extends Error {
  constructor() {
    super('The usage reservation protocol is unavailable');
    this.name = 'UsageProtocolUnavailableError';
  }
}

type UsageDenialReason =
  | 'entitlement_required'
  | 'quota_exhausted'
  | 'app_disabled'
  | 'operation_disabled';

type UsageFailure =
  | { status: 'authentication_required'; message: string }
  | { status: 'unavailable'; message: string };

export type RunReservationDecision =
  | {
      status: 'reserved';
      authorizationId: string;
      remainingUnits: number;
      lifecycle: 'reservation';
    }
  | {
      status: 'legacy_protocol';
    }
  | { status: 'denied'; reason: UsageDenialReason; message: string }
  | UsageFailure;

export type ReservationTransitionDecision =
  | { status: 'accepted'; finalizeBy: string }
  | { status: 'consumed' | 'rolled_back' | 'cancelled' }
  | UsageFailure;

export type LegacyRunAuthorizationDecision =
  | {
      status: 'consumed';
      authorizationId: string;
      remainingUnits: number;
      lifecycle: 'legacy-immediate';
    }
  | { status: 'denied'; reason: UsageDenialReason; message: string }
  | UsageFailure;

type UsageFetch = (url: string, init: RequestInit) => Promise<Response>;

interface UsageAuthorizerDependencies {
  fetch: UsageFetch;
  loadSession: () => Promise<StoredAppSession | null>;
  clearSession: () => Promise<void>;
  createAcceptanceId: () => string;
  createSignal: () => AbortSignal;
  now: () => number;
  readConfig: () => {
    apiOrigin: unknown;
    allowInsecurePrivateDevelopment?: boolean;
  };
}

export interface UsageAuthorizer {
  createAcceptanceId: () => string;
  reserveRun: (
    units: number,
    acceptanceId: string,
  ) => Promise<RunReservationDecision>;
  authorizeLegacyRun: (
    units: number,
    acceptanceId: string,
  ) => Promise<LegacyRunAuthorizationDecision>;
  consumeReservation: (
    authorizationId: string,
    acceptanceId: string,
  ) => Promise<ReservationTransitionDecision>;
  cancelReservation: (
    authorizationId: string,
  ) => Promise<ReservationTransitionDecision>;
  finalizeReservation: (
    authorizationId: string,
    acceptanceId: string,
  ) => Promise<ReservationTransitionDecision>;
  rollbackReservation: (
    authorizationId: string,
    acceptanceId: string,
  ) => Promise<ReservationTransitionDecision>;
}

function defaultEnvironment(): {
  apiOrigin: unknown;
  allowInsecurePrivateDevelopment: boolean;
} {
  const environment = import.meta.env as ImportMetaEnv & {
    readonly DEV?: boolean;
  };
  return {
    apiOrigin: configuredOriginOrDefault(
      environment.WXT_PLATFORM_API_ORIGIN,
      DEPLOYED_PLATFORM_API_ORIGIN,
    ),
    allowInsecurePrivateDevelopment: environment.DEV === true,
  };
}

function denialMessage(reason: UsageDenialReason): string {
  switch (reason) {
    case 'entitlement_required':
      return 'A Grok Automator™ or All Extensions license is required before Run can start.';
    case 'quota_exhausted':
      return 'Your licensed automation allowance is exhausted for this period.';
    case 'app_disabled':
      return 'Grok Automator™ access is currently disabled for this account.';
    case 'operation_disabled':
      return 'Prompt automation is currently disabled for this account.';
  }
}

const authenticationRequired = (): UsageFailure => ({
  status: 'authentication_required',
  message: 'Sign in with Google before Run can start.',
});

const unavailable = (): UsageFailure => ({
  status: 'unavailable',
  message: 'The license service could not authorize this Run.',
});

export function createUsageAuthorizer(
  overrides: Partial<UsageAuthorizerDependencies> = {},
): UsageAuthorizer {
  const dependencies: UsageAuthorizerDependencies = {
    fetch: (url, init) => fetch(url, init),
    loadSession: () => loadAppSession(),
    clearSession: clearAppSession,
    createAcceptanceId: () => `run.${crypto.randomUUID()}`,
    createSignal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    now: Date.now,
    readConfig: defaultEnvironment,
    ...overrides,
  };

  async function resolveRequestContext(): Promise<
    { apiOrigin: string; session: StoredAppSession } | UsageFailure
  > {
    const session = await dependencies.loadSession();
    if (!session) return authenticationRequired();

    const rawConfig = dependencies.readConfig();
    const apiOrigin = normalizePlatformWebOrigin(rawConfig.apiOrigin, {
      allowInsecurePrivateDevelopment:
        rawConfig.allowInsecurePrivateDevelopment === true,
    });
    return apiOrigin
      ? { apiOrigin, session }
      : {
          status: 'unavailable',
          message:
            'The Paks Tools Faceless automations license service is not configured.',
        };
  }

  async function postReservationJson(
    url: string,
    session: StoredAppSession,
    body: unknown,
    allowProtocolFallback = false,
  ): Promise<unknown | UsageFailure> {
    const response = await dependencies.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.appAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: dependencies.createSignal(),
    });
    if (response.status === 401) {
      await dependencies.clearSession();
      return {
        status: 'authentication_required',
        message:
          'Your Paks Tools Faceless automations session expired. Sign in again.',
      };
    }
    if (allowProtocolFallback && response.status === 404) {
      throw new UsageProtocolUnavailableError();
    }
    if (allowProtocolFallback && response.status === 426) {
      const rawError = await readBoundedJson(response, {
        maxBytes: RESPONSE_SIZE_LIMIT,
        sizeErrorMessage: 'Usage response exceeded the size limit.',
        invalidJsonMessage: 'Usage response was not valid JSON.',
      });
      if (protocolUnavailableErrorResponseSchema.safeParse(rawError).success) {
        throw new UsageProtocolUnavailableError();
      }
      return unavailable();
    }
    if (!response.ok) return unavailable();
    return readBoundedJson(response, {
      maxBytes: RESPONSE_SIZE_LIMIT,
      sizeErrorMessage: 'Usage response exceeded the size limit.',
      invalidJsonMessage: 'Usage response was not valid JSON.',
    });
  }

  async function reserveRun(
    units: number,
    acceptanceId: string,
  ): Promise<RunReservationDecision> {
    try {
      const context = await resolveRequestContext();
      if ('status' in context) return context;
      const request = parseUsageReservationRequest({
        schemaVersion: 2,
        appId: GROK_AUTOMATOR_APP_ID,
        operation: AUTOMATION_OPERATION,
        units,
        idempotencyKey: acceptanceId,
      });
      for (let attempt = 0; attempt < RESERVE_ATTEMPT_LIMIT; attempt += 1) {
        try {
          const rawDecision = await postReservationJson(
            `${context.apiOrigin}/v1/apps/${GROK_AUTOMATOR_APP_ID}/usage/reservations`,
            context.session,
            request,
            true,
          );
          if (
            typeof rawDecision === 'object' &&
            rawDecision &&
            'status' in rawDecision
          ) {
            const status = (rawDecision as { status?: unknown }).status;
            if (status === 'authentication_required') {
              return rawDecision as UsageFailure;
            }
            if (status === 'unavailable') continue;
          }
          const decision = parseUsageReservationResponse(rawDecision);
          if (
            decision.appId !== GROK_AUTOMATOR_APP_ID ||
            decision.operation !== AUTOMATION_OPERATION
          ) {
            throw new Error(
              'Usage response did not match the requested operation.',
            );
          }
          if (decision.status === 'denied') {
            return {
              status: 'denied',
              reason: decision.reason,
              message: denialMessage(decision.reason),
            };
          }
          if (
            decision.status !== 'reserved' ||
            decision.authorizedUnits !== units
          ) {
            throw new Error(
              'Usage response did not create the requested reservation.',
            );
          }
          const reservationLifetime =
            Date.parse(decision.expiresAt) - dependencies.now();
          if (
            reservationLifetime <= 0 ||
            reservationLifetime > MAX_RESERVATION_LIFETIME_MS
          ) {
            throw new Error('Usage reservation has an invalid expiry.');
          }
          return {
            status: 'reserved',
            authorizationId: decision.authorizationId,
            remainingUnits: decision.remainingUnits,
            lifecycle: 'reservation',
          };
        } catch (error) {
          if (error instanceof UsageProtocolUnavailableError) {
            // Only the first, unambiguous response may negotiate legacy mode.
            // A prior lost response may already have created a v2 hold.
            return attempt === 0
              ? { status: 'legacy_protocol' }
              : unavailable();
          }
        }
      }
      return unavailable();
    } catch {
      return unavailable();
    }
  }

  async function authorizeLegacyRun(
    units: number,
    acceptanceId: string,
  ): Promise<LegacyRunAuthorizationDecision> {
    const request = parseLegacyUsageAuthorizationRequest({
      appId: GROK_AUTOMATOR_APP_ID,
      operation: AUTOMATION_OPERATION,
      units,
      idempotencyKey: acceptanceId,
    });
    for (
      let attempt = 0;
      attempt < LEGACY_AUTHORIZE_ATTEMPT_LIMIT;
      attempt += 1
    ) {
      try {
        const context = await resolveRequestContext();
        if ('status' in context) return context;
        const rawDecision = await postReservationJson(
          `${context.apiOrigin}/v1/apps/${GROK_AUTOMATOR_APP_ID}/usage/authorize`,
          context.session,
          request,
        );
        if (
          typeof rawDecision === 'object' &&
          rawDecision &&
          'status' in rawDecision
        ) {
          const status = (rawDecision as { status?: unknown }).status;
          if (status === 'authentication_required') {
            return rawDecision as UsageFailure;
          }
          if (status === 'unavailable') continue;
        }
        const decision = parseLegacyUsageAuthorizationResponse(rawDecision);
        if (
          decision.appId !== GROK_AUTOMATOR_APP_ID ||
          decision.operation !== AUTOMATION_OPERATION
        ) {
          throw new Error(
            'Legacy usage response did not match the requested operation.',
          );
        }
        if (!decision.allowed) {
          return {
            status: 'denied',
            reason: decision.reason,
            message: denialMessage(decision.reason),
          };
        }
        if (decision.authorizedUnits !== units) {
          throw new Error(
            'Legacy usage response did not authorize the requested units.',
          );
        }
        return {
          status: 'consumed',
          authorizationId: decision.authorizationId,
          remainingUnits: decision.remainingUnits,
          lifecycle: 'legacy-immediate',
        };
      } catch {
        // An exact idempotent replay reconciles a legacy authorization whose
        // terminal response was lost without creating a second usage charge.
      }
    }
    return unavailable();
  }

  async function transitionReservation(
    authorizationId: string,
    action: 'consume' | 'finalize' | 'rollback' | 'cancel',
    acceptanceId?: string,
  ): Promise<ReservationTransitionDecision> {
    const attemptLimit = action === 'cancel' ? 1 : CONSUME_ATTEMPT_LIMIT;
    let lastDecision: ReservationTransitionDecision = unavailable();
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
      try {
        const context = await resolveRequestContext();
        if ('status' in context) return context;
        const request =
          action === 'cancel'
            ? parseUsageReservationCancelRequest({ schemaVersion: 2 })
            : parseUsageReservationConsumeRequest({
                schemaVersion: 2,
                acceptanceId,
              });
        const rawDecision = await postReservationJson(
          `${context.apiOrigin}/v1/apps/${GROK_AUTOMATOR_APP_ID}/usage/reservations/${encodeURIComponent(authorizationId)}/${action}`,
          context.session,
          request,
        );
        if (
          typeof rawDecision === 'object' &&
          rawDecision &&
          'status' in rawDecision
        ) {
          const status = (rawDecision as { status?: unknown }).status;
          if (status === 'authentication_required') {
            return rawDecision as UsageFailure;
          }
          if (status === 'unavailable') {
            lastDecision = rawDecision as UsageFailure;
            continue;
          }
        }
        const decision = parseUsageReservationTransitionResponse(rawDecision);
        if (
          decision.appId !== GROK_AUTOMATOR_APP_ID ||
          decision.operation !== AUTOMATION_OPERATION ||
          decision.authorizationId !== authorizationId
        ) {
          throw new Error('Usage transition did not match the reservation.');
        }
        if (action === 'cancel') {
          if (decision.status !== 'cancelled') {
            throw new Error(
              'Usage cancellation did not match the reservation.',
            );
          }
          return { status: 'cancelled' };
        }
        if (
          !('acceptanceId' in decision) ||
          decision.acceptanceId !== acceptanceId
        ) {
          throw new Error('Usage transition acceptance did not match.');
        }
        if (action === 'consume') {
          if (decision.status === 'accepted') {
            const finalizeLifetime =
              Date.parse(decision.finalizeBy) - dependencies.now();
            if (
              finalizeLifetime <= 0 ||
              finalizeLifetime > MAX_RESERVATION_LIFETIME_MS
            ) {
              throw new Error('Usage acceptance has an invalid expiry.');
            }
            return { status: 'accepted', finalizeBy: decision.finalizeBy };
          }
          if (
            decision.status === 'consumed' ||
            decision.status === 'rolled_back'
          ) {
            return { status: decision.status };
          }
          throw new Error('Usage acceptance did not match the reservation.');
        }
        const expectedStatus =
          action === 'finalize' ? 'consumed' : 'rolled_back';
        if (decision.status !== expectedStatus) {
          throw new Error('Usage finalization did not match the reservation.');
        }
        return { status: expectedStatus };
      } catch {
        lastDecision = unavailable();
      }
    }
    return lastDecision;
  }

  return {
    createAcceptanceId: dependencies.createAcceptanceId,
    reserveRun,
    authorizeLegacyRun,
    consumeReservation: (authorizationId, acceptanceId) =>
      transitionReservation(authorizationId, 'consume', acceptanceId),
    cancelReservation: (authorizationId) =>
      transitionReservation(authorizationId, 'cancel'),
    finalizeReservation: (authorizationId, acceptanceId) =>
      transitionReservation(authorizationId, 'finalize', acceptanceId),
    rollbackReservation: (authorizationId, acceptanceId) =>
      transitionReservation(authorizationId, 'rollback', acceptanceId),
  };
}
