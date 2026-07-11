/**
 * Pro entitlement checks (S14).
 *
 * The Stripe webhook is the single source of truth for entitlement: it writes
 * `public.subscriptions` via the service-role client. `isPro` reads that row
 * with the admin client (RLS-exempt) so gates can't be spoofed from the client,
 * and fails closed (treats the user as free) on any error — a DB hiccup must
 * never hand out Pro.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/** Stripe statuses that grant Pro while the paid period is still current. */
const PRO_STATUSES = new Set(['active', 'trialing']);

/**
 * Pure predicate: does a subscription row grant Pro right now?
 *
 * Requires an entitling status AND a `current_period_end` still in the future,
 * so a canceled-at-period-end subscription keeps Pro until it actually lapses,
 * and a stale `active` row with a past period end does not.
 */
export function isProStatus(status: string, currentPeriodEnd: string | null): boolean {
  if (!PRO_STATUSES.has(status)) return false;
  if (!currentPeriodEnd) return false;
  return new Date(currentPeriodEnd).getTime() > Date.now();
}

/**
 * Server-side entitlement check for a user. Reads their subscription row via
 * the admin client. Returns false (free tier) on missing config, read error,
 * or no row.
 */
export async function isPro(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) {
    logger.error('IS_PRO_UNCONFIGURED');
    return false;
  }

  const { data, error } = await admin
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.warn('IS_PRO_READ_FAILED', { error: error.message });
    return false;
  }

  if (!data) return false;
  return isProStatus(data.status, data.current_period_end);
}
