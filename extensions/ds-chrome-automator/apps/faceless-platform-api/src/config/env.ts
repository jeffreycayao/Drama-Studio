import { isIP } from 'node:net';

import {
  appIdSchema,
  chromeExtensionOriginSchema,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod';

const productSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

const entitlementCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+$/u);

const exactOriginSchema = z.string().superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid origin' });
    return;
  }

  if (
    url.origin !== value ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !['https:', 'http:'].includes(url.protocol)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Expected an exact HTTP(S) origin without path or credentials',
    });
  }
});

const httpsOriginSchema = exactOriginSchema.refine(
  (value) => new URL(value).protocol === 'https:',
  'Expected an HTTPS origin',
);

const extensionRegistrationSchema = z.strictObject({
  appId: appIdSchema,
  origin: chromeExtensionOriginSchema,
  environment: z.enum(['development', 'preview', 'production']),
});

const priceCatalogItemSchema = z.strictObject({
  priceId: z.string().regex(/^price_[A-Za-z0-9]+$/u),
  mode: z.enum(['payment', 'subscription']),
  entitlementCode: entitlementCodeSchema,
});

const publicEnvironmentSchema = z.strictObject({
  PUBLIC_APP_ORIGIN: httpsOriginSchema,
  PUBLIC_API_ORIGIN: httpsOriginSchema,
  PUBLIC_WEB_ORIGINS: z.string().min(1),
  PUBLIC_EXTENSION_REGISTRATIONS_JSON: z.string().min(2),
  ALLOW_LOCAL_DEVELOPMENT_ORIGINS: z.enum(['true', 'false']).default('false'),
  PUBLIC_DEV_ORIGINS: z.string().default(''),
});

const databaseEnvironmentSchema = z.strictObject({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      'DATABASE_URL must be a Postgres URL',
    ),
});

const googleEnvironmentSchema = z.strictObject({
  GOOGLE_CLIENT_ID: z.string().min(20).max(256),
  GOOGLE_CLIENT_SECRET: z.string().min(20).max(512),
  GOOGLE_OAUTH_REDIRECT_URI: z
    .url()
    .refine((value) => new URL(value).protocol === 'https:'),
  OAUTH_TRANSIENT_KEY: z.string().min(43).max(512),
});

const sessionEnvironmentSchema = z.strictObject({
  SESSION_TOKEN_PEPPER: z.string().min(43).max(512),
});

const adminEnvironmentSchema = z.strictObject({
  ADMIN_GOOGLE_BOOTSTRAP_EMAILS: z.string().min(1).optional(),
  ADMIN_GOOGLE_SUBJECTS: z.string().min(1).optional(),
});

const stripeEnvironmentSchema = z.strictObject({
  STRIPE_RESTRICTED_KEY: z.string().regex(/^rk_(?:test|live)_[A-Za-z0-9]+$/u),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9]+$/u),
  STRIPE_PRICE_CATALOG_JSON: z.string().min(2),
});

const blobEnvironmentSchema = z.strictObject({
  BLOB_READ_WRITE_TOKEN: z.string().min(32).max(1_024),
});

const migrationEnvironmentSchema = z.strictObject({
  CRON_SECRET: z.string().min(43).max(512),
});

const usageEnvironmentSchema = z.strictObject({
  USAGE_AUTHORIZATION_TTL_SECONDS: z.coerce.number().int().min(30).max(300),
  USAGE_DAILY_UNIT_LIMIT: z.coerce.number().int().min(1).max(1_000_000),
});

export interface ExtensionRegistration {
  readonly appId: string;
  readonly environment: 'development' | 'preview' | 'production';
  readonly origin: string;
}

export interface PublicConfig {
  readonly apiOrigin: string;
  readonly appOrigin: string;
  readonly allowedCorsOrigins: ReadonlySet<string>;
  readonly developmentOrigins: ReadonlySet<string>;
  readonly extensionRegistrations: readonly ExtensionRegistration[];
  readonly webOrigins: ReadonlySet<string>;
}

export interface StripeCatalogItem {
  readonly entitlementCode: string;
  readonly mode: 'payment' | 'subscription';
  readonly priceId: string;
}

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
}

function isPrivateDevelopmentOrigin(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== 'http:') return false;

  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (hostname === 'localhost') return true;
  if (isIP(hostname) === 4) {
    const octets = hostname.split('.').map(Number);
    const first = octets[0];
    const second = octets[1];
    return (
      first === 127 ||
      first === 10 ||
      (first === 192 && second === 168) ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31)
    );
  }
  return hostname === '::1';
}

function parseExactOrigins(raw: string, label: string): string[] {
  const values = splitCommaList(raw);
  requireUnique(values, label);
  return z.array(exactOriginSchema).parse(values);
}

export function parsePublicConfig(
  environment: NodeJS.ProcessEnv,
): PublicConfig {
  const parsed = publicEnvironmentSchema.parse({
    ALLOW_LOCAL_DEVELOPMENT_ORIGINS:
      environment.ALLOW_LOCAL_DEVELOPMENT_ORIGINS,
    PUBLIC_API_ORIGIN: environment.PUBLIC_API_ORIGIN,
    PUBLIC_APP_ORIGIN: environment.PUBLIC_APP_ORIGIN,
    PUBLIC_DEV_ORIGINS: environment.PUBLIC_DEV_ORIGINS,
    PUBLIC_EXTENSION_REGISTRATIONS_JSON:
      environment.PUBLIC_EXTENSION_REGISTRATIONS_JSON,
    PUBLIC_WEB_ORIGINS: environment.PUBLIC_WEB_ORIGINS,
  });
  const webOrigins = parseExactOrigins(
    parsed.PUBLIC_WEB_ORIGINS,
    'PUBLIC_WEB_ORIGINS',
  );
  if (
    webOrigins.length === 0 ||
    webOrigins.some((origin) => !origin.startsWith('https://'))
  ) {
    throw new Error('PUBLIC_WEB_ORIGINS must contain exact HTTPS origins');
  }

  const registrations = z
    .array(extensionRegistrationSchema)
    .max(100)
    .parse(JSON.parse(parsed.PUBLIC_EXTENSION_REGISTRATIONS_JSON));
  const registrationOrigins = registrations.map(({ origin }) => origin);
  requireUnique(registrationOrigins, 'PUBLIC_EXTENSION_REGISTRATIONS_JSON');

  const developmentOrigins = parseExactOrigins(
    parsed.PUBLIC_DEV_ORIGINS,
    'PUBLIC_DEV_ORIGINS',
  );
  if (
    (parsed.ALLOW_LOCAL_DEVELOPMENT_ORIGINS === 'false' &&
      developmentOrigins.length > 0) ||
    developmentOrigins.some((origin) => !isPrivateDevelopmentOrigin(origin))
  ) {
    throw new Error(
      'Development origins require the explicit flag and a localhost or private-LAN HTTP origin',
    );
  }

  const allowed = [
    ...webOrigins,
    ...registrationOrigins,
    ...developmentOrigins,
  ];
  requireUnique(allowed, 'combined CORS origins');

  return {
    apiOrigin: parsed.PUBLIC_API_ORIGIN,
    appOrigin: parsed.PUBLIC_APP_ORIGIN,
    allowedCorsOrigins: new Set(allowed),
    developmentOrigins: new Set(developmentOrigins),
    extensionRegistrations: registrations,
    webOrigins: new Set(webOrigins),
  };
}

export function parseDatabaseConfig(environment: NodeJS.ProcessEnv) {
  const parsed = databaseEnvironmentSchema.parse({
    DATABASE_URL: environment.DATABASE_URL,
  });
  return { databaseUrl: parsed.DATABASE_URL } as const;
}

export function parseGoogleConfig(environment: NodeJS.ProcessEnv) {
  const parsed = googleEnvironmentSchema.parse({
    GOOGLE_CLIENT_ID: environment.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: environment.GOOGLE_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: environment.GOOGLE_OAUTH_REDIRECT_URI,
    OAUTH_TRANSIENT_KEY: environment.OAUTH_TRANSIENT_KEY,
  });
  return {
    clientId: parsed.GOOGLE_CLIENT_ID,
    clientSecret: parsed.GOOGLE_CLIENT_SECRET,
    oauthRedirectUri: parsed.GOOGLE_OAUTH_REDIRECT_URI,
    transientKey: parsed.OAUTH_TRANSIENT_KEY,
  } as const;
}

export function parseSessionConfig(environment: NodeJS.ProcessEnv) {
  const parsed = sessionEnvironmentSchema.parse({
    SESSION_TOKEN_PEPPER: environment.SESSION_TOKEN_PEPPER,
  });
  return { tokenPepper: parsed.SESSION_TOKEN_PEPPER } as const;
}

export function parseAdminConfig(environment: NodeJS.ProcessEnv) {
  const parsed = adminEnvironmentSchema.parse({
    ADMIN_GOOGLE_BOOTSTRAP_EMAILS: environment.ADMIN_GOOGLE_BOOTSTRAP_EMAILS,
    ADMIN_GOOGLE_SUBJECTS: environment.ADMIN_GOOGLE_SUBJECTS,
  });
  const googleSubjects = splitCommaList(parsed.ADMIN_GOOGLE_SUBJECTS ?? '');
  requireUnique(googleSubjects, 'ADMIN_GOOGLE_SUBJECTS');
  const bootstrapEmails = z
    .array(z.email().max(320))
    .max(25)
    .parse(
      splitCommaList(parsed.ADMIN_GOOGLE_BOOTSTRAP_EMAILS ?? '').map(
        (email) => {
          if (email !== email.toLowerCase()) {
            throw new Error(
              'ADMIN_GOOGLE_BOOTSTRAP_EMAILS must contain normalized lowercase emails',
            );
          }
          return email;
        },
      ),
    );
  requireUnique(bootstrapEmails, 'ADMIN_GOOGLE_BOOTSTRAP_EMAILS');
  if (googleSubjects.length === 0 && bootstrapEmails.length === 0) {
    throw new Error(
      'At least one stable Google subject or bootstrap email must be configured',
    );
  }
  return {
    bootstrapEmails,
    googleSubjects,
  } as const;
}

export function parseStripeConfig(environment: NodeJS.ProcessEnv) {
  const parsed = stripeEnvironmentSchema.parse({
    STRIPE_PRICE_CATALOG_JSON: environment.STRIPE_PRICE_CATALOG_JSON,
    STRIPE_RESTRICTED_KEY: environment.STRIPE_RESTRICTED_KEY,
    STRIPE_WEBHOOK_SECRET: environment.STRIPE_WEBHOOK_SECRET,
  });
  const catalog = z
    .record(productSlugSchema, priceCatalogItemSchema)
    .parse(JSON.parse(parsed.STRIPE_PRICE_CATALOG_JSON));
  if (Object.keys(catalog).length === 0) {
    throw new Error('STRIPE_PRICE_CATALOG_JSON must not be empty');
  }
  return {
    catalog,
    restrictedKey: parsed.STRIPE_RESTRICTED_KEY,
    webhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
  } as const;
}

export function parseBlobConfig(environment: NodeJS.ProcessEnv) {
  const parsed = blobEnvironmentSchema.parse({
    BLOB_READ_WRITE_TOKEN: environment.BLOB_READ_WRITE_TOKEN,
  });
  return { readWriteToken: parsed.BLOB_READ_WRITE_TOKEN } as const;
}

export function parseMigrationConfig(environment: NodeJS.ProcessEnv) {
  const parsed = migrationEnvironmentSchema.parse({
    CRON_SECRET: environment.CRON_SECRET,
  });
  return { cronSecret: parsed.CRON_SECRET } as const;
}

export function parseUsageConfig(environment: NodeJS.ProcessEnv) {
  const parsed = usageEnvironmentSchema.parse({
    USAGE_AUTHORIZATION_TTL_SECONDS:
      environment.USAGE_AUTHORIZATION_TTL_SECONDS,
    USAGE_DAILY_UNIT_LIMIT: environment.USAGE_DAILY_UNIT_LIMIT,
  });
  return {
    authorizationTtlSeconds: parsed.USAGE_AUTHORIZATION_TTL_SECONDS,
    dailyUnitLimit: parsed.USAGE_DAILY_UNIT_LIMIT,
  } as const;
}
