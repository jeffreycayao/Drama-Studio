import { idempotencyKeySchema } from '@faceless-automations/platform-contracts';
import { z } from 'zod';

export const createCheckoutRequestSchema = z.strictObject({
  productSlug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
});

export const checkoutIdempotencyHeaderSchema = idempotencyKeySchema;

export const createCheckoutResponseSchema = z.strictObject({
  checkoutUrl: z.url().refine((value) => new URL(value).protocol === 'https:'),
});

export const stripeWebhookReceiptSchema = z.strictObject({
  duplicate: z.boolean(),
  received: z.literal(true),
});
