import { z } from 'zod';

const lowerKebabPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const opaqueIdentifierPattern = /^[A-Za-z0-9_-]+$/u;
const capabilityPattern = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/u;
const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export const appIdSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(lowerKebabPattern, 'App IDs must use lowercase kebab-case');

export const chromeExtensionIdSchema = z
  .string()
  .regex(/^[a-p]{32}$/u, 'Invalid Chrome extension ID');

export const chromeExtensionOriginSchema = z
  .string()
  .regex(
    /^chrome-extension:\/\/[a-p]{32}$/u,
    'Invalid Chrome extension origin',
  );

export const opaqueIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(opaqueIdentifierPattern, 'Invalid opaque identifier');

export const requestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(opaqueIdentifierPattern, 'Invalid request identifier');

export const capabilityIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(capabilityPattern, 'Invalid capability identifier');

export const planCodeSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(lowerKebabPattern, 'Plan codes must use lowercase kebab-case');

export const semanticVersionSchema = z
  .string()
  .max(64)
  .regex(semanticVersionPattern, 'Invalid semantic version');

export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 digest');

export const revisionSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, 'Invalid revision identifier');

export const isoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .min(20)
  .max(35);

export const httpsUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Expected a valid URL',
      });
      return;
    }
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Expected an HTTPS URL without credentials or a fragment',
      });
    }
  });

export const emailSchema = z.string().email().max(320);

export const accessTokenSchema = z
  .string()
  .min(32)
  .max(4_096)
  .regex(/^[A-Za-z0-9._~-]+$/u, 'Invalid bearer token encoding');

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/u, 'Invalid idempotency key');

export type AppId = z.infer<typeof appIdSchema>;
export type ChromeExtensionId = z.infer<typeof chromeExtensionIdSchema>;
export type ChromeExtensionOrigin = z.infer<typeof chromeExtensionOriginSchema>;
export type CapabilityId = z.infer<typeof capabilityIdSchema>;
export type PlanCode = z.infer<typeof planCodeSchema>;
