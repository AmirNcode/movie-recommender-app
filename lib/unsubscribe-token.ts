import { createHmac, timingSafeEqual } from 'crypto';
import { getSiteUrl } from '@/lib/site-url';

/** Signs/verifies one-click digest-unsubscribe links (S9) with an HMAC keyed
 * on CRON_SECRET — no separate secret to provision, and it's already
 * server-only. Not a general-purpose auth token: scope is "can flip this
 * user's digest_opt_in to false", nothing else. */
function getSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not configured');
  return secret;
}

export function buildUnsubscribeToken(userId: string): string {
  return createHmac('sha256', getSecret()).update(userId).digest('hex');
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = Buffer.from(buildUnsubscribeToken(userId), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(token, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export function buildUnsubscribeUrl(userId: string): string {
  const url = getSiteUrl();
  url.pathname = '/api/unsubscribe';
  url.searchParams.set('uid', userId);
  url.searchParams.set('token', buildUnsubscribeToken(userId));
  return url.toString();
}
