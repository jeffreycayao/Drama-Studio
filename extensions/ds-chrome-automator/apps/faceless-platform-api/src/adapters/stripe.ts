import { randomBytes } from 'node:crypto';

import Stripe from 'stripe';

import { parseStripeConfig } from '../config/env.js';
import type { StripePort } from '../ports/providers.js';

function createIntegrationIdentifier(): string {
  return `faceless_automations_${randomBytes(6).toString('base64url').toLowerCase().slice(0, 8)}`;
}

export function createStripeAdapter(
  environment: NodeJS.ProcessEnv,
): StripePort {
  const config = parseStripeConfig(environment);
  const stripe = new Stripe(config.restrictedKey, {
    apiVersion: '2026-07-29.dahlia',
    maxNetworkRetries: 2,
    timeout: 10_000,
  });

  return {
    async createCheckout(input) {
      const metadata = {
        entitlement_code: input.catalogItem.entitlementCode,
        product_slug: input.productSlug,
        user_id: input.userId,
      };
      const base: Stripe.Checkout.SessionCreateParams = {
        cancel_url: `${input.appOrigin}/pricing?checkout=cancelled`,
        client_reference_id: input.userId,
        customer_email: input.userEmail,
        integration_identifier: createIntegrationIdentifier(),
        line_items: [{ price: input.catalogItem.priceId, quantity: 1 }],
        metadata,
        mode: input.catalogItem.mode,
        success_url: `${input.appOrigin}/dashboard/billing?checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
      };
      if (input.catalogItem.mode === 'subscription') {
        base.subscription_data = { metadata };
      } else {
        base.payment_intent_data = { metadata };
      }
      const session = await stripe.checkout.sessions.create(base, {
        idempotencyKey: input.idempotencyKey,
      });
      if (!session.url?.startsWith('https://')) {
        throw new Error('Stripe did not return a hosted Checkout URL');
      }
      return session.url;
    },

    async verifyWebhook(payload, signature) {
      return stripe.webhooks.constructEventAsync(
        payload,
        signature,
        config.webhookSecret,
      );
    },
  };
}
