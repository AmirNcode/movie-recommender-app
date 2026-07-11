import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveQueueForUser } from '@/lib/movie-queue';
import { sendDigest } from '@/lib/email';
import { buildUnsubscribeUrl } from '@/lib/unsubscribe-token';
import { getSiteUrl } from '@/lib/site-url';
import { logger } from '@/lib/logger';

// Weekly re-engagement digest (S9). Bearer-gated by CRON_SECRET and scheduled
// via vercel.json (Monday 16:00 UTC). Processes up to BATCH_SIZE opted-in
// users per run — at current scale that's every opted-in user in one run;
// a larger user base would need a pagination cursor across runs.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 50;
const SEND_CONCURRENCY = 5;
const PICKS_PER_USER = 3;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function sendDigestToUser(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  profile: { id: string; name: string | null }
): Promise<'sent' | 'skipped' | 'failed'> {
  const picks = await getActiveQueueForUser(profile.id, PICKS_PER_USER);
  if (picks.length === 0) return 'skipped';

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(profile.id);
  if (authError || !authUser.user.email) {
    logger.warn('DIGEST_NO_EMAIL', { userId: profile.id, error: authError?.message });
    return 'skipped';
  }

  const result = await sendDigest(authUser.user.email, {
    name: profile.name,
    picks: picks.map((p) => ({ tmdbId: p.tmdbId, title: p.title, year: p.year, posterUrl: p.posterUrl })),
    ctaUrl: getSiteUrl().toString(),
    unsubscribeUrl: buildUnsubscribeUrl(profile.id),
  });

  if (!result.ok) {
    logger.warn('DIGEST_SEND_FAILED', { userId: profile.id, error: result.error });
    return 'failed';
  }

  return 'sent';
}

async function processInChunks(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  profiles: { id: string; name: string | null }[]
): Promise<{ sent: number; skipped: number; failed: number }> {
  const counts = { sent: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < profiles.length; i += SEND_CONCURRENCY) {
    const slice = profiles.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(slice.map((profile) => sendDigestToUser(admin, profile)));
    for (const outcome of results) counts[outcome] += 1;
  }

  return counts;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    logger.error('WEEKLY_DIGEST_MISCONFIGURED', {});
    return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }

  const startedAt = Date.now();

  try {
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, name')
      .eq('digest_opt_in', true)
      .order('id')
      .limit(BATCH_SIZE);

    if (error) {
      logger.error('WEEKLY_DIGEST_QUERY_FAILED', { error: error.message });
      return NextResponse.json({ ok: false, error: 'Query failed' }, { status: 500 });
    }

    const counts = await processInChunks(admin, profiles ?? []);
    const durationMs = Date.now() - startedAt;

    logger.info('WEEKLY_DIGEST_DONE', { candidates: (profiles ?? []).length, ...counts, durationMs });

    return NextResponse.json({ ok: true, candidates: (profiles ?? []).length, ...counts, durationMs });
  } catch (err) {
    logger.error('WEEKLY_DIGEST_FAILED', { error: String(err) });
    return NextResponse.json({ ok: false, error: 'Digest run failed' }, { status: 500 });
  }
}
