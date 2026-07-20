/**
 * Stripe client + billing configuration helpers (S14).
 *
 * The client is created lazily from `STRIPE_SECRET_KEY` and returns `null` when
 * unconfigured (mirrors `createAdminClient`) so imports never throw at build.
 * `isBillingEnabled` gates checkout go-live behind the `BILLING_ENABLED` flag
 * (default false) — D4 requires the TMDB commercial license be confirmed before
 * charging, so billing ships disabled.
 */
import Stripe from 'stripe';

export type BillingPlan = 'monthly' | 'yearly';

let cachedClient: Stripe | null | undefined;

/** Lazily constructs the Stripe client, or `null` if the secret key is unset. */
export function getStripeClient(): Stripe | null {
  if (cachedClient !== undefined) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  // Pin nothing: the installed SDK's default pinned API version is used, which
  // matches the field shapes this codebase reads (period end on subscription
  // items, not the subscription root).
  cachedClient = key ? new Stripe(key) : null;
  return cachedClient;
}

/** Whether new checkouts are allowed (D4 gate). Defaults to false. */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true';
}

/** Resolves the configured Stripe price id for a plan, or `null` if unset. */
export function priceIdForPlan(plan: BillingPlan): string | null {
  const id =
    plan === 'yearly'
      ? process.env.STRIPE_PRICE_ID_YEARLY
      : process.env.STRIPE_PRICE_ID_MONTHLY;
  return id || null;
}
