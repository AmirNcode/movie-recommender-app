/**
 * Server Actions for Stripe billing (S14).
 *
 * `createCheckoutSession` starts a subscription Checkout; `createPortalSession`
 * opens the customer portal to manage/cancel. Neither grants entitlement — the
 * webhook (`app/api/stripe/webhook/route.ts`) is the sole writer of
 * `subscriptions`. The Stripe customer mapping is stored the moment a customer
 * is created so the webhook can resolve a user by customer id even before the
 * `checkout.session.completed` event carries `client_reference_id`.
 */
'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/request-ip';
import { getSiteUrl } from '@/lib/site-url';
import { getStripeClient, isBillingEnabled, priceIdForPlan, type BillingPlan } from '@/lib/stripe';
import type { ActionResult } from '@/types/actions';

/**
 * Returns the caller's Stripe customer id, creating the customer (and storing
 * the mapping) on first use.
 */
async function findOrCreateCustomer(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  stripe: NonNullable<ReturnType<typeof getStripeClient>>,
  userId: string,
  email: string | null
): Promise<string> {
  const { data: existing } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { user_id: userId },
  });

  // Persist the mapping immediately (before Checkout) so a subscription.* event
  // that arrives without client_reference_id can still resolve the user.
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      { user_id: userId, stripe_customer_id: customer.id, status: 'inactive' },
      { onConflict: 'user_id' }
    );
  if (error) logger.warn('BILLING_CUSTOMER_MAP_FAILED', { error: error.message });

  return customer.id;
}

export async function createCheckoutSession(
  plan: BillingPlan
): Promise<ActionResult<{ url: string }>> {
  // D4 gate: billing ships disabled until the TMDB commercial license is confirmed.
  if (!isBillingEnabled()) {
    return { ok: false, code: 'validation', message: 'Billing not yet available.' };
  }

  if (plan !== 'monthly' && plan !== 'yearly') {
    return { ok: false, code: 'validation', message: 'Invalid plan.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'createCheckoutSession', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  const stripe = getStripeClient();
  const admin = createAdminClient();
  const priceId = priceIdForPlan(plan);
  if (!stripe || !admin || !priceId) {
    logger.error('CHECKOUT_UNCONFIGURED', {
      hasStripe: Boolean(stripe),
      hasAdmin: Boolean(admin),
      hasPrice: Boolean(priceId),
    });
    return { ok: false, code: 'load_failed', message: 'Checkout is unavailable right now.' };
  }

  try {
    const customerId = await findOrCreateCustomer(admin, stripe, user.id, user.email ?? null);
    const origin = getSiteUrl().origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      client_reference_id: user.id,
      success_url: `${origin}/?upgraded=1`,
      cancel_url: `${origin}/`,
      customer_update: { address: 'auto' },
      automatic_tax: { enabled: true },
    });

    if (!session.url) {
      logger.error('CHECKOUT_NO_URL', { sessionId: session.id });
      return { ok: false, code: 'load_failed', message: 'Checkout is unavailable right now.' };
    }

    return { ok: true, data: { url: session.url } };
  } catch (error) {
    logger.error('CHECKOUT_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Checkout is unavailable right now.' };
  }
}

export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'createPortalSession', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  const stripe = getStripeClient();
  const admin = createAdminClient();
  if (!stripe || !admin) {
    logger.error('PORTAL_UNCONFIGURED', { hasStripe: Boolean(stripe), hasAdmin: Boolean(admin) });
    return { ok: false, code: 'load_failed', message: 'Billing management is unavailable right now.' };
  }

  try {
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return { ok: false, code: 'validation', message: 'No subscription to manage.' };
    }

    const origin = getSiteUrl().origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/`,
    });

    return { ok: true, data: { url: session.url } };
  } catch (error) {
    logger.error('PORTAL_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Billing management is unavailable right now.' };
  }
}
