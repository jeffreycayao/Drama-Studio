import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { createStripeAdapter } from '../src/adapters/stripe.js';

describe('Stripe adapter', () => {
  it('verifies signed webhook bytes and rejects tampering', async () => {
    const secret = 'whsec_testSigningSecret';
    const payload = JSON.stringify({
      api_version: '2026-07-29.dahlia',
      created: 1_786_838_400,
      data: { object: { id: 'cs_test_001', object: 'checkout.session' } },
      id: 'evt_test_001',
      livemode: false,
      object: 'event',
      pending_webhooks: 1,
      type: 'checkout.session.completed',
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const adapter = createStripeAdapter({
      STRIPE_PRICE_CATALOG_JSON:
        '{"grok-automator":{"priceId":"price_test001","mode":"payment","entitlementCode":"extension:grok-automator"}}',
      STRIPE_RESTRICTED_KEY: 'rk_test_restrictedkeyvalue',
      STRIPE_WEBHOOK_SECRET: secret,
    });

    await expect(
      adapter.verifyWebhook(payload, signature),
    ).resolves.toMatchObject({
      id: 'evt_test_001',
    });
    await expect(
      adapter.verifyWebhook(`${payload} `, signature),
    ).rejects.toThrow();
  });
});
