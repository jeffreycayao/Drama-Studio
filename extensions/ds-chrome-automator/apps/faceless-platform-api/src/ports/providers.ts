import type Stripe from 'stripe';

import type { StripeCatalogItem } from '../config/env.js';

export interface VerifiedGoogleIdentity {
  readonly displayName: string | null;
  readonly email: string;
  readonly issuer: string;
  readonly subject: string;
}

export interface GoogleIdentityPort {
  createAuthorizationUrl(input: {
    codeChallenge: string;
    nonce: string;
    state: string;
  }): string;
  exchangeAndVerify(input: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
  }): Promise<VerifiedGoogleIdentity>;
}

export interface StripePort {
  createCheckout(input: {
    appOrigin: string;
    catalogItem: StripeCatalogItem;
    idempotencyKey: string;
    productSlug: string;
    userEmail: string;
    userId: string;
  }): Promise<string>;
  verifyWebhook(payload: string, signature: string): Promise<Stripe.Event>;
}

export interface BlobPort {
  ping(): Promise<void>;
}
