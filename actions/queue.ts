'use server';

import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { getActiveQueueForUser, getCachedMoviesByIds, getQueueConfig, getQueueState, upsertMoviesCache } from '@/lib/movie-queue';
import { checkRateLimit } from '@/lib/rate-limit';
import { assertServerEnv } from '@/lib/env';
import { getClientIp } from '@/lib/request-ip';
import type { MovieCandidate } from '@/types/movie';
import type { ActionFailure, ActionResult } from '@/types/actions';
import type { CachedMovie, QueuedMovie, SourceTier } from '@/types/queue';

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

const TMDB_BASE = 'https://api.themoviedb.org/3';

type TmdbDiscoverResult = { id: number };

type DiscoverTierConfig = {
  tier: SourceTier;
  params: Record<string, string | number | boolean>;
  pages: number[];
};

function buildUrl(path: string, params: Record<string, string | number | boolean>) {
  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
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

function getDiscoveryPlan(): DiscoverTierConfig[] {
  return [
    {
      tier: 'mainstream',
      params: {
        include_adult: false,
        include_video: false,
        language: 'en-US',
        sort_by: 'popularity.desc',
        'vote_count.gte': '1000',
        'vote_average.gte': '6.0',
        'with_original_language': 'en',
        'primary_release_date.gte': '2005-01-01',
      },
      pages: [1, 2, 3, 4, 5],
    },
    {
      tier: 'broader-mainstream',
      params: {
        include_adult: false,
        include_video: false,
        language: 'en-US',
        sort_by: 'popularity.desc',
        'vote_count.gte': '300',
        'vote_average.gte': '5.8',
        'with_original_language': 'en',
        'primary_release_date.gte': '1990-01-01',
      },
      pages: [1, 2, 3, 4, 5, 6, 7, 8],
    },
    {
      tier: 'niche',
      params: {
        include_adult: false,
        include_video: false,
        language: 'en-US',
        sort_by: 'vote_average.desc',
        'vote_count.gte': '50',
        'vote_average.gte': '6.0',
        'primary_release_date.gte': '1970-01-01',
      },
      pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
  ];
}

async function discoverCandidateIds(apiKey: string, excluded: Set<number>, targetCount: number): Promise<Array<{ tmdbId: number; tier: SourceTier }>> {
  const plan = getDiscoveryPlan();
  const collected: Array<{ tmdbId: number; tier: SourceTier }> = [];

  for (const tierPlan of plan) {
    for (const page of tierPlan.pages) {
      if (collected.length >= targetCount) return collected;

      const res = await fetch(
        buildUrl('/discover/movie', {
          api_key: apiKey,
          ...tierPlan.params,
          page,
        }),
        { cache: 'no-store' }
      );

      if (!res.ok) continue;
      const data = await res.json();
      const results: TmdbDiscoverResult[] = data.results ?? [];

      for (const result of results) {
        if (!result?.id || excluded.has(result.id)) continue;
        excluded.add(result.id);
        collected.push({ tmdbId: result.id, tier: tierPlan.tier });
        if (collected.length >= targetCount) return collected;
      }
    }
  }

  return collected;
}

async function hydrateMovie(apiKey: string, tmdbId: number, tier: SourceTier): Promise<CachedMovie | null> {
  const res = await fetch(
    buildUrl(`/movie/${tmdbId}`, {
      api_key: apiKey,
      append_to_response: 'credits',
      language: 'en-US',
    }),
    { cache: 'no-store' }
  );

  if (!res.ok) return null;
  const detail = await res.json();

  const director =
    (detail.credits?.crew ?? []).find((c: { job: string; name: string }) => c.job === 'Director')?.name ?? 'Unknown Director';

  const genre =
    (detail.genres ?? []).map((g: { name: string }) => g.name).join(', ') || 'Unknown Genre';

  const year = detail.release_date ? parseInt(String(detail.release_date).split('-')[0], 10) : 0;
  const posterUrl = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : undefined;
  const topActors = (detail.credits?.cast ?? [])
    .filter((actor: { name?: string }) => typeof actor.name === 'string' && actor.name.trim().length > 0)
    .slice(0, 3)
    .map((actor: { name: string }) => actor.name);

  return {
    tmdbId: Number(detail.id),
    title: detail.title as string,
    year,
    director,
    genre,
    synopsis: (detail.overview as string) ?? '',
    posterUrl,
    topActors,
    releaseDate: detail.release_date ?? undefined,
    popularity: typeof detail.popularity === 'number' ? detail.popularity : undefined,
    voteAverage: typeof detail.vote_average === 'number' ? detail.vote_average : undefined,
    voteCount: typeof detail.vote_count === 'number' ? detail.vote_count : undefined,
    originalLanguage: detail.original_language ?? undefined,
    sourceTier: tier,
  };
}

/** Hydrates TMDB details in bounded-concurrency slices to avoid a request storm. */
async function hydrateMoviesInChunks(
  apiKey: string,
  items: Array<{ tmdbId: number; tier: SourceTier }>,
  chunkSize = 8
): Promise<CachedMovie[]> {
  const hydrated: CachedMovie[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    const results = await Promise.all(
      slice.map((item) => hydrateMovie(apiKey, item.tmdbId, item.tier))
    );
    for (const movie of results) {
      if (movie) hydrated.push(movie);
    }
  }
  return hydrated;
}

async function fillQueueForUser(userId: string, minimumToAdd: number): Promise<void> {
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
      // the TMDB fan-out never blocks a user-facing request.
      if (queueState.activeCount < queueConfig.lowWatermark) {
        after(() => fillQueueForUser(userId, queueConfig.targetSize - queueState.activeCount));
      }
      return { ok: true, data: queued.map(toMovieCandidate) };
    }

    // Empty queue (first load): fetch a small batch synchronously for a fast
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
