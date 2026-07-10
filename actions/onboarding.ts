'use server';

import { createClient } from '@/lib/supabase/server';
import { getCachedMoviesByIds, upsertMoviesCache } from '@/lib/movie-queue';
import { ONBOARDING_TITLES } from '@/lib/onboarding-titles';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { hydrateMovie } from '@/actions/queue';
import { logger } from '@/lib/logger';
import type { ActionResult } from '@/types/actions';
import type { MovieCandidate } from '@/types/movie';
import type { CachedMovie } from '@/types/queue';

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isCachedMovie(movie: CachedMovie | null | undefined): movie is CachedMovie {
  return Boolean(movie);
}

async function resolveUserId(): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { ok: false, message: 'Please sign in to continue.' };
  return { ok: true, userId: user.id };
}

export async function hasSwipeStates(): Promise<ActionResult<boolean>> {
  const auth = await resolveUserId();
  if (!auth.ok) {
    return { ok: false, code: 'unauthorized', message: auth.message };
  }

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('swipe_states')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .limit(1);

  if (error) {
    logger.warn('ONBOARDING_STATUS_FAILED', { error: error.message });
    return { ok: false, code: 'load_failed', message: 'Failed to load onboarding status.' };
  }

  return { ok: true, data: Boolean(count && count > 0) };
}

export async function getOnboardingMovies(): Promise<ActionResult<MovieCandidate[]>> {
  const auth = await resolveUserId();
  if (!auth.ok) {
    return { ok: false, code: 'unauthorized', message: auth.message };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'getOnboardingMovies', auth.userId);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const supabase = await createClient();
    const { data: states, error: statesError } = await supabase
      .from('swipe_states')
      .select('tmdb_movie_id')
      .eq('user_id', auth.userId);

    if (statesError) {
      logger.warn('ONBOARDING_STATES_FAILED', { error: statesError.message });
      return { ok: false, code: 'load_failed', message: 'Failed to load onboarding movies.' };
    }

    const ratedIds = new Set((states ?? []).map((state) => state.tmdb_movie_id));
    const availableIds = ONBOARDING_TITLES
      .map((movie) => movie.tmdbId)
      .filter((tmdbId) => !ratedIds.has(tmdbId));

    if (availableIds.length === 0) return { ok: true, data: [] };

    const cached = await getCachedMoviesByIds(availableIds);
    const missingIds = availableIds.filter((tmdbId) => !cached.has(tmdbId));
    const apiKey = process.env.TMDB_API_KEY;

    if (missingIds.length > 0 && apiKey) {
      const hydrated = await Promise.all(
        missingIds.map((tmdbId) => hydrateMovie(apiKey, tmdbId, 'mainstream'))
      );
      const moviesToCache = hydrated.filter(isCachedMovie);
      if (moviesToCache.length > 0) {
        await upsertMoviesCache(moviesToCache);
        for (const movie of moviesToCache) {
          cached.set(movie.tmdbId, movie);
        }
      }
    }

    const movies = availableIds
      .map((tmdbId) => cached.get(tmdbId))
      .filter(isCachedMovie)
      .map((movie) => ({
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.year,
        director: movie.director,
        genre: movie.genre,
        synopsis: movie.synopsis,
        posterUrl: movie.posterUrl,
      }));

    return { ok: true, data: shuffle(movies).slice(0, 12) };
  } catch (error) {
    logger.error('ONBOARDING_MOVIES_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load onboarding movies.' };
  }
}
