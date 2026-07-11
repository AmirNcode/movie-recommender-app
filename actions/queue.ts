'use server';

import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { getActiveQueueForUser, getCachedMoviesByIds, getQueueConfig, getQueueState, upsertMoviesCache } from '@/lib/movie-queue';
import { discoverCandidateIds, hydrateMoviesInChunks } from '@/lib/tmdb-discovery';
import { checkRateLimit } from '@/lib/rate-limit';
import { assertServerEnv } from '@/lib/env';
import { getClientIp } from '@/lib/request-ip';
import { getQueueFilterArgs } from '@/lib/user-preferences';
import type { MovieCandidate } from '@/types/movie';
import type { ActionFailure, ActionResult } from '@/types/actions';
import type { QueuedMovie } from '@/types/queue';

// Throws on first server-side import at runtime if required env is missing.
assertServerEnv();

async function checkActionRateLimit(
  action: 'getQueuedMovies' | 'refillQueuedMovies',
  userId: string
): Promise<ActionFailure | null> {
  const ip = await getClientIp();
  const result = await checkRateLimit(ip, action, userId);
  if (!result.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.`,
      retryAfter: result.retryAfter,
    };
  }
  return null;
}

async function resolveUserId(): Promise<{ ok: true; userId: string } | ActionFailure> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }
  return { ok: true, userId: user.id };
}

async function getExcludedMovieIds(userId: string): Promise<Set<number>> {
  const admin = createAdminClient();
  const excluded = new Set<number>();
  if (!admin) return excluded;

  const [statesRes, queueRes, watchlistRes] = await Promise.all([
    admin.from('swipe_states').select('tmdb_movie_id').eq('user_id', userId),
    admin
      .from('user_movie_queue')
      .select('tmdb_movie_id')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .is('discarded_at', null),
    admin.from('watchlists').select('tmdb_movie_id').eq('user_id', userId),
  ]);

  for (const row of statesRes.data ?? []) excluded.add(row.tmdb_movie_id);
  for (const row of queueRes.data ?? []) excluded.add(row.tmdb_movie_id);
  for (const row of watchlistRes.data ?? []) excluded.add(row.tmdb_movie_id);

  return excluded;
}

/**
 * S10 fast path: fill the queue from the shared candidate pool with a single
 * SQL round-trip (no TMDB calls). Returns how many rows were enqueued.
 */
async function fillQueueFromPool(userId: string, minimumToAdd: number): Promise<number> {
  const admin = createAdminClient();
  if (!admin || minimumToAdd <= 0) return 0;

  // S8: honor the user's saved genre filter (decade/rating are Pro-gated and
  // always come back null pre-S14 — see lib/user-preferences.ts).
  const filters = await getQueueFilterArgs(userId);

  const { data, error } = await admin.rpc('fill_queue_from_pool', {
    p_user_id: userId,
    p_count: minimumToAdd,
    p_year_from: filters.yearFrom ?? undefined,
    p_year_to: filters.yearTo ?? undefined,
    p_min_vote: filters.minVote ?? undefined,
    p_genres: filters.genres ?? undefined,
  });

  if (error) {
    logger.warn('QUEUE_REFILL_FROM_POOL_FAILED', { error: error.message, userId });
    return 0;
  }

  return typeof data === 'number' ? data : 0;
}

/**
 * Legacy runtime TMDB discovery. Superseded by the shared pool (S10); retained
 * only as the POOL_EXHAUSTED fallback when the pool can't satisfy the request.
 */
async function fillQueueFromTmdbDiscovery(userId: string, minimumToAdd: number): Promise<void> {
  const admin = createAdminClient();
  const apiKey = process.env.TMDB_API_KEY;
  if (!admin || !apiKey || minimumToAdd <= 0) return;

  const excluded = await getExcludedMovieIds(userId);
  const discovered = await discoverCandidateIds(apiKey, excluded, Math.ceil(minimumToAdd * 1.5));
  if (discovered.length === 0) return;

  const cachedMap = await getCachedMoviesByIds(discovered.map((item) => item.tmdbId));
  const missing = discovered.filter((item) => !cachedMap.has(item.tmdbId));

  const hydrated = await hydrateMoviesInChunks(apiKey, missing);

  if (hydrated.length > 0) {
    await upsertMoviesCache(hydrated);
    for (const movie of hydrated) {
      cachedMap.set(movie.tmdbId, movie);
    }
  }

  const enqueuePayload = discovered
    .flatMap((item) => {
      const cached = cachedMap.get(item.tmdbId);
      if (!cached) return [];
      return [{ tmdb_movie_id: item.tmdbId, source_tier: item.tier }];
    })
    .slice(0, minimumToAdd);

  if (enqueuePayload.length === 0) return;

  const { error } = await admin.rpc('enqueue_user_movies', {
    p_user_id: userId,
    p_movies: enqueuePayload,
  });

  if (error) {
    logger.warn('QUEUE_REFILL_FAILED', { error: error.message, userId });
  }
}

/**
 * Fills a user's queue with `minimumToAdd` cards. Pool-first (zero TMDB calls);
 * only when the shared pool is short of the request does it fall back to the
 * legacy runtime discovery path, logging POOL_EXHAUSTED so the shortfall is
 * observable and the cron pool size can be tuned.
 */
async function fillQueueForUser(userId: string, minimumToAdd: number): Promise<void> {
  if (minimumToAdd <= 0) return;

  const insertedFromPool = await fillQueueFromPool(userId, minimumToAdd);
  const remaining = minimumToAdd - insertedFromPool;
  if (remaining <= 0) return;

  logger.warn('POOL_EXHAUSTED', {
    userId,
    requested: minimumToAdd,
    filledFromPool: insertedFromPool,
    remaining,
  });

  await fillQueueFromTmdbDiscovery(userId, remaining);
}

function toMovieCandidate(movie: QueuedMovie): MovieCandidate {
  return {
    tmdbId: movie.tmdbId,
    title: movie.title,
    year: movie.year,
    director: movie.director,
    genre: movie.genre,
    synopsis: movie.synopsis,
    posterUrl: movie.posterUrl,
  };
}

export async function getQueuedMovies(
  limit = getQueueConfig().deliverBatchSize
): Promise<ActionResult<MovieCandidate[]>> {
  const auth = await resolveUserId();
  if (!auth.ok) return auth;
  const denied = await checkActionRateLimit('getQueuedMovies', auth.userId);
  if (denied) return denied;

  try {
    const userId = auth.userId;
    const queueConfig = getQueueConfig();
    const queueState = await getQueueState(userId);
    const queued = await getActiveQueueForUser(userId, limit);

    if (queued.length > 0) {
      // Serve immediately; top up below-watermark queues after the response so
      // the refill never blocks a user-facing request.
      if (queueState.activeCount < queueConfig.lowWatermark) {
        after(() => fillQueueForUser(userId, queueConfig.targetSize - queueState.activeCount));
      }
      return { ok: true, data: queued.map(toMovieCandidate) };
    }

    // Empty queue (first load): fill a small batch synchronously for a fast
    // first response, then top up to target size in the background.
    await fillQueueForUser(userId, queueConfig.deliverBatchSize);
    after(() => fillQueueForUser(userId, queueConfig.targetSize - queueConfig.deliverBatchSize));

    const finalQueued = await getActiveQueueForUser(userId, limit);
    return { ok: true, data: finalQueued.map(toMovieCandidate) };
  } catch (error) {
    logger.error('GET_QUEUED_MOVIES_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load movies. Please try again.' };
  }
}

export async function refillQueuedMovies(): Promise<ActionResult<MovieCandidate[]>> {
  const auth = await resolveUserId();
  if (!auth.ok) return auth;
  const denied = await checkActionRateLimit('refillQueuedMovies', auth.userId);
  if (denied) return denied;

  try {
    const userId = auth.userId;
    const queueConfig = getQueueConfig();
    // Fill a deliverable batch synchronously, then top up to target in the
    // background so the "Reload movies" click returns quickly.
    await fillQueueForUser(userId, queueConfig.deliverBatchSize);
    after(() => fillQueueForUser(userId, queueConfig.targetSize - queueConfig.deliverBatchSize));

    const queued = await getActiveQueueForUser(userId, queueConfig.deliverBatchSize);

    return { ok: true, data: queued.map(toMovieCandidate) };
  } catch (error) {
    logger.error('REFILL_QUEUED_MOVIES_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load movies. Please try again.' };
  }
}
