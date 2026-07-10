'use server';

import { createClient } from '@/lib/supabase/server';
import type { MovieDetail, WatchlistItem } from '@/types/library';
import type { ActionResult } from '@/types/actions';
import type { Database } from '@/types/supabase';
import { validateMovie } from '@/lib/validate-movie';
import { logger } from '@/lib/logger';

function mapWatchlistRow(row: Database['public']['Tables']['watchlists']['Row']): WatchlistItem {
  return {
    id: row.id,
    tmdbId: row.tmdb_movie_id,
    title: row.movie_title ?? 'Unknown Title',
    year: row.movie_year ?? 0,
    director: row.movie_director ?? 'Unknown Director',
    genre: row.movie_genre ?? 'Unknown Genre',
    synopsis: row.movie_synopsis ?? '',
    posterUrl: row.poster_url ?? undefined,
    recommendationReason: row.recommendation_reason ?? null,
    source: row.source as WatchlistItem['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Server action to set watchlist state idempotently.
 * Returns the resulting state.
 */
export async function setWatchlistItem(
  movie: MovieDetail,
  shouldBeInWatchlist: boolean
): Promise<ActionResult<{ inWatchlist: boolean }>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  if (!movie.tmdbId || movie.tmdbId <= 0) {
    return { ok: false, code: 'validation', message: 'Could not save this movie because TMDB metadata is missing.' };
  }

  // Normalise/cap the client-supplied payload before it hits the DB.
  const validated = validateMovie(movie);
  if (!validated.ok) return validated;
  movie = validated.movie;

  try {
    if (shouldBeInWatchlist) {
      // Preserve any recommendation context already stored on the row when the
      // caller re-adds with a sparse MovieDetail (e.g. toggled from a view that
      // doesn't carry the original reason / source).
      const { data: existing } = await supabase
        .from('watchlists')
        .select('recommendation_reason, source, recommended_at')
        .eq('user_id', user.id)
        .eq('tmdb_movie_id', movie.tmdbId)
        .maybeSingle();

      const recommendationReason =
        movie.recommendationReason ?? existing?.recommendation_reason ?? null;
      const source = movie.source ?? existing?.source ?? 'manual';
      const recommendedAt =
        existing?.recommended_at ??
        (movie.recommendationReason ? new Date().toISOString() : null);

      const { error } = await supabase.from('watchlists').upsert(
        {
          user_id: user.id,
          tmdb_movie_id: movie.tmdbId,
          movie_title: movie.title,
          movie_year: movie.year ?? null,
          movie_director: movie.director ?? null,
          movie_genre: movie.genre ?? null,
          movie_synopsis: movie.synopsis ?? null,
          poster_url: movie.posterUrl ?? null,
          recommendation_reason: recommendationReason,
          source,
          recommended_at: recommendedAt,
        },
        { onConflict: 'user_id,tmdb_movie_id' }
      );

      if (error) {
        logger.warn('WATCHLIST_UPSERT_FAILED', { error: error.message });
        return { ok: false, code: 'save_failed', message: 'Failed to update watchlist.' };
      }
      return { ok: true, data: { inWatchlist: true } };
    }

    const { error } = await supabase
      .from('watchlists')
      .delete()
      .eq('user_id', user.id)
      .eq('tmdb_movie_id', movie.tmdbId);

    if (error) {
      logger.warn('WATCHLIST_DELETE_FAILED', { error: error.message });
      return { ok: false, code: 'save_failed', message: 'Failed to update watchlist.' };
    }
    return { ok: true, data: { inWatchlist: false } };
  } catch (error) {
    logger.error('SET_WATCHLIST_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Failed to update watchlist.' };
  }
}

export async function isMovieInWatchlist(tmdbId: number): Promise<ActionResult<boolean>> {
  if (!tmdbId || tmdbId <= 0) return { ok: true, data: false };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return { ok: false, code: 'load_failed', message: 'Failed to check watchlist.' };
  }
  if (!user) return { ok: true, data: false };

  try {
    const { data, error } = await supabase
      .from('watchlists')
      .select('id')
      .eq('user_id', user.id)
      .eq('tmdb_movie_id', tmdbId)
      .maybeSingle();

    if (error) {
      logger.warn('IS_IN_WATCHLIST_FAILED', { error: error.message });
      return { ok: false, code: 'load_failed', message: 'Failed to check watchlist.' };
    }

    return { ok: true, data: Boolean(data) };
  } catch (error) {
    logger.error('IS_IN_WATCHLIST_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to check watchlist.' };
  }
}

export async function getWatchlistItems(): Promise<ActionResult<WatchlistItem[]>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  try {
    const { data, error } = await supabase
      .from('watchlists')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      logger.warn('GET_WATCHLIST_FAILED', { error: error.message });
      return { ok: false, code: 'load_failed', message: 'Failed to load your watchlist.' };
    }

    return { ok: true, data: (data ?? []).map(mapWatchlistRow) };
  } catch (error) {
    logger.error('GET_WATCHLIST_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load your watchlist.' };
  }
}
