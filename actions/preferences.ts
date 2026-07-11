'use server';

import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/request-ip';
import { isValidGenreId } from '@/lib/tmdb-genres';
import type { ActionResult } from '@/types/actions';
import type { UserPreferences } from '@/types/preferences';

const DEFAULT_PREFERENCES: UserPreferences = { genres: [], yearFrom: null, yearTo: null, minVote: null };

export async function getPreferences(): Promise<ActionResult<UserPreferences>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'getPreferences', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('genres, year_from, year_to, min_vote')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      logger.warn('GET_PREFERENCES_FAILED', { error: error.message });
      return { ok: false, code: 'load_failed', message: 'Failed to load your filters.' };
    }

    if (!data) return { ok: true, data: DEFAULT_PREFERENCES };

    return {
      ok: true,
      data: {
        genres: data.genres ?? [],
        yearFrom: data.year_from,
        yearTo: data.year_to,
        minVote: data.min_vote,
      },
    };
  } catch (error) {
    logger.error('GET_PREFERENCES_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load your filters.' };
  }
}

/**
 * Saves the free-tier genre filter and discards the user's active (unswiped)
 * queue so the next fetch rebuilds it against the new preference (S8).
 *
 * Decade and minimum-rating filters are Pro-gated per the roadmap and aren't
 * accepted here yet — `user_preferences.year_from/year_to/min_vote` stay null
 * until S14 (billing) ships a Pro-aware variant of this action.
 */
export async function setPreferences(genres: number[]): Promise<ActionResult<UserPreferences>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'setPreferences', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  if (!Array.isArray(genres)) {
    return { ok: false, code: 'validation', message: 'Invalid genre selection.' };
  }

  const cleanGenres = Array.from(new Set(genres.filter((id) => Number.isInteger(id) && isValidGenreId(id))));

  try {
    const { error: upsertError } = await supabase
      .from('user_preferences')
      .upsert(
        { user_id: user.id, genres: cleanGenres, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (upsertError) {
      logger.warn('SET_PREFERENCES_FAILED', { error: upsertError.message });
      return { ok: false, code: 'save_failed', message: 'Failed to save your filters. Please try again.' };
    }

    // Discard the active (unswiped) queue so the next getQueuedMovies rebuilds
    // it against the new filter instead of serving stale, unfiltered cards.
    const { error: discardError } = await supabase
      .from('user_movie_queue')
      .update({ discarded_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('consumed_at', null)
      .is('discarded_at', null);

    if (discardError) {
      logger.warn('PREFERENCES_QUEUE_DISCARD_FAILED', { error: discardError.message });
    }

    return { ok: true, data: { genres: cleanGenres, yearFrom: null, yearTo: null, minVote: null } };
  } catch (error) {
    logger.error('SET_PREFERENCES_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Failed to save your filters. Please try again.' };
  }
}
