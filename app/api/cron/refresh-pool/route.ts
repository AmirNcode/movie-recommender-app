import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedMoviesByIds, upsertMoviesCache } from '@/lib/movie-queue';
import { collectPoolCandidateIds, hydrateMoviesInChunks } from '@/lib/tmdb-discovery';
import { logger } from '@/lib/logger';

// Nightly shared-candidate-pool refresh (S10). Bearer-gated by CRON_SECRET and
// scheduled via vercel.json. Walks the TMDB discovery plan, hydrates uncached
// ids, upserts them, then rebuilds movies_cache.pool_rank so runtime queue
// refills are pure-DB (zero TMDB calls in the user path).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const POOL_TARGET = 800;

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

    const durationMs = Date.now() - startedAt;
    logger.info('REFRESH_POOL_DONE', {
      collected: candidates.length,
      hydrated: hydrated.length,
      poolSize,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      collected: candidates.length,
      hydrated: hydrated.length,
      poolSize,
      durationMs,
    });
  } catch (err) {
    logger.error('REFRESH_POOL_FAILED', { error: String(err) });
    return NextResponse.json({ ok: false, error: 'Pool refresh failed' }, { status: 500 });
  }
}
