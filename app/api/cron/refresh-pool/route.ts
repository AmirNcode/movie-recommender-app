import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedMoviesByIds, upsertMoviesCache } from '@/lib/movie-queue';
import { collectPoolCandidateIds, hydrateMoviesInChunks } from '@/lib/tmdb-discovery';
import { logger } from '@/lib/logger';
import type { SourceTier } from '@/types/queue';

// Nightly shared-candidate-pool refresh (S10). Bearer-gated by CRON_SECRET and
// scheduled via vercel.json. Walks the TMDB discovery plan, hydrates uncached
// ids, upserts them, then rebuilds movies_cache.pool_rank so runtime queue
// refills are pure-DB (zero TMDB calls in the user path). Also backfills
// trailer_key (S7) for rows hydrated before trailer support shipped.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const POOL_TARGET = 800;

// Rows cached before this date were hydrated without an append_to_response
// videos fetch, so trailer_key = null there means "never checked", not
// "checked, no trailer". Re-hydrate a small batch of them per run until the
// backlog clears.
const TRAILER_BACKFILL_CUTOFF = '2026-07-10T18:00:00Z';
const TRAILER_BACKFILL_BATCH = 100;

async function backfillTrailers(
  apiKey: string,
  admin: NonNullable<ReturnType<typeof createAdminClient>>
): Promise<number> {
  const { data, error } = await admin
    .from('movies_cache')
    .select('tmdb_movie_id, source_tier')
    .is('trailer_key', null)
    .lt('cached_at', TRAILER_BACKFILL_CUTOFF)
    .limit(TRAILER_BACKFILL_BATCH);

  if (error) {
    logger.warn('TRAILER_BACKFILL_QUERY_FAILED', { error: error.message });
    return 0;
  }
  if (!data || data.length === 0) return 0;

  const items = data
    .filter((row): row is { tmdb_movie_id: number; source_tier: string } => Boolean(row.source_tier))
    .map((row) => ({ tmdbId: row.tmdb_movie_id, tier: row.source_tier as SourceTier }));

  if (items.length === 0) return 0;

  const hydrated = await hydrateMoviesInChunks(apiKey, items);
  if (hydrated.length > 0) {
    await upsertMoviesCache(hydrated);
  }
  return hydrated.length;
}

// S6: mark movie nights older than 24h as expired (unless already matched), so
// stale waiting/active rows don't linger. Runs in the nightly pool cron.
async function expireStaleMovieNights(
  admin: NonNullable<ReturnType<typeof createAdminClient>>
): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('movie_nights')
    .update({ status: 'expired' })
    .lt('created_at', cutoff)
    .in('status', ['waiting', 'active'])
    .select('id');

  if (error) {
    logger.warn('MOVIE_NIGHT_EXPIRE_FAILED', { error: error.message });
    return 0;
  }
  return data?.length ?? 0;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.TMDB_API_KEY;
  const admin = createAdminClient();
  if (!apiKey || !admin) {
    logger.error('REFRESH_POOL_MISCONFIGURED', { hasApiKey: Boolean(apiKey), hasAdmin: Boolean(admin) });
    return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }

  const startedAt = Date.now();

  try {
    const candidates = await collectPoolCandidateIds(apiKey, POOL_TARGET);
    if (candidates.length === 0) {
      logger.warn('REFRESH_POOL_NO_CANDIDATES', {});
      return NextResponse.json({ ok: false, error: 'No candidates collected' }, { status: 502 });
    }

    const ids = candidates.map((c) => c.tmdbId);
    const cached = await getCachedMoviesByIds(ids);
    const missing = candidates.filter((c) => !cached.has(c.tmdbId));

    const hydrated = await hydrateMoviesInChunks(apiKey, missing);
    if (hydrated.length > 0) {
      await upsertMoviesCache(hydrated);
    }

    const { data: poolSize, error } = await admin.rpc('rebuild_movie_pool', {
      p_tmdb_ids: ids,
    });

    if (error) {
      logger.error('REFRESH_POOL_REBUILD_FAILED', { error: error.message });
      return NextResponse.json({ ok: false, error: 'Pool rebuild failed' }, { status: 500 });
    }

    const trailersBackfilled = await backfillTrailers(apiKey, admin);
    const nightsExpired = await expireStaleMovieNights(admin);

    const durationMs = Date.now() - startedAt;
    logger.info('REFRESH_POOL_DONE', {
      collected: candidates.length,
      hydrated: hydrated.length,
      poolSize,
      trailersBackfilled,
      nightsExpired,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      collected: candidates.length,
      hydrated: hydrated.length,
      poolSize,
      trailersBackfilled,
      nightsExpired,
      durationMs,
    });
  } catch (err) {
    logger.error('REFRESH_POOL_FAILED', { error: String(err) });
    return NextResponse.json({ ok: false, error: 'Pool refresh failed' }, { status: 500 });
  }
}
