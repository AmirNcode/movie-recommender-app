import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripeClient } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Stripe webhook — the single source of truth for Pro entitlement (S14).
 *
 * The client-side success redirect is never trusted: only events verified here
 * write `public.subscriptions`. The signature is verified against
 * `STRIPE_WEBHOOK_SECRET`; a bad/missing signature returns 400. Handled events:
 * `checkout.session.completed` (initial grant, carries `client_reference_id`)
 * and `customer.subscription.updated|deleted` (renewals, cancellations,
 * lapses). Everything else is logged and acknowledged with 200.
 *
 * Runs on the Node runtime and reads the raw body via `req.text()` — Stripe
 * signature verification requires the exact unparsed payload.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Maps a Stripe subscription status onto our `subscriptions.status` domain. */
function mapStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
      return status;
    case 'unpaid':
      return 'past_due';
    default:
      // incomplete, incomplete_expired, paused → no entitlement
      return 'inactive';
  }
}

/** Current-period end lives on the subscription item, not the subscription root. */
function periodEndIso(sub: Stripe.Subscription): string | null {
  const end = sub.items.data[0]?.current_period_end;
  return typeof end === 'number' ? new Date(end * 1000).toISOString() : null;
}

async function writeSubscription(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  params: { userId: string | null; customerId: string; sub: Stripe.Subscription }
): Promise<void> {
  const { userId, customerId, sub } = params;
  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: mapStatus(sub.status),
    current_period_end: periodEndIso(sub),
    updated_at: new Date().toISOString(),
  };

  if (userId) {
    // Authoritative row keyed by the app user (from checkout.session.completed).
    const { error } = await admin
      .from('subscriptions')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
    if (error) logger.error('STRIPE_WEBHOOK_UPSERT_FAILED', { error: error.message });
    return;
  }

  // Renewal/cancel events don't carry the app user; the row was created at
  // checkout, so resolve it by customer id.
  const { data, error } = await admin
    .from('subscriptions')
    .update(patch)
    .eq('stripe_customer_id', customerId)
    .select('user_id');
  if (error) {
    logger.error('STRIPE_WEBHOOK_UPDATE_FAILED', { error: error.message });
  } else if (!data || data.length === 0) {
    logger.warn('STRIPE_WEBHOOK_NO_ROW_FOR_CUSTOMER', { customerId });
  }
}

export async function POST(req: NextRequest) {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    logger.error('STRIPE_WEBHOOK_UNCONFIGURED', { hasStripe: Boolean(stripe), hasSecret: Boolean(secret) });
    return NextResponse.json({ error: 'unconfigured' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch (error) {
    logger.warn('STRIPE_WEBHOOK_BAD_SIGNATURE', { error: String(error) });
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    logger.error('STRIPE_WEBHOOK_NO_ADMIN');
    // Ack so Stripe doesn't hammer retries on our misconfiguration; alert fires via the log.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null;

        if (customerId && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await writeSubscription(admin, { userId: userId ?? null, customerId, sub });
        } else {
          logger.warn('STRIPE_WEBHOOK_CHECKOUT_INCOMPLETE', { hasCustomer: Boolean(customerId), hasSub: Boolean(subscriptionId) });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        await writeSubscription(admin, { userId: null, customerId, sub });
        break;
      }
      default:
        logger.warn('STRIPE_WEBHOOK_UNHANDLED', { type: event.type });
    }
  } catch (error) {
    // Signal failure so Stripe retries; the event was authentic, our write failed.
    logger.error('STRIPE_WEBHOOK_HANDLER_FAILED', { type: event.type, error: String(error) });
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
