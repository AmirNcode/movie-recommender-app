'use server';

import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/request-ip';
import { isValidGenreId } from '@/lib/tmdb-genres';
import { isPro } from '@/lib/billing';
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

/** Pro-only deck filters (S8), gated on entitlement server-side in setPreferences. */
export type ProFilters = {
  yearFrom?: number | null;
  yearTo?: number | null;
  minVote?: number | null;
};

const MIN_FILTER_YEAR = 1900;

/** Validates/normalizes the Pro filter fields; rejects out-of-range input. */
function cleanProFilters(
  filters: ProFilters
): { ok: true; value: Required<ProFilters> } | { ok: false } {
  const maxYear = new Date().getUTCFullYear() + 1;
  const yearFrom = filters.yearFrom ?? null;
  const yearTo = filters.yearTo ?? null;
  const minVote = filters.minVote ?? null;

  for (const year of [yearFrom, yearTo]) {
    if (year !== null && (!Number.isInteger(year) || year < MIN_FILTER_YEAR || year > maxYear)) {
      return { ok: false };
    }
  }
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) return { ok: false };
  if (minVote !== null && (typeof minVote !== 'number' || Number.isNaN(minVote) || minVote < 0 || minVote > 10)) {
    return { ok: false };
  }

  return { ok: true, value: { yearFrom, yearTo, minVote } };
}

/**
 * Saves deck filters and discards the user's active (unswiped) queue so the next
 * fetch rebuilds it against the new preference (S8).
 *
 * Genre filtering is free-tier. The decade (`yearFrom`/`yearTo`) and minimum-
 * rating (`minVote`) filters are Pro-gated: they are validated and persisted
 * only when the caller is Pro (S14). A free caller passing them silently gets
 * nulls persisted — the entitlement check is authoritative server-side; client
 * hints are cosmetic.
 */
export async function setPreferences(
  genres: number[],
  proFilters: ProFilters = {}
): Promise<ActionResult<UserPreferences>> {
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

  // Pro-gate the decade/rating filters. Non-Pro callers persist nulls regardless
  // of what they send, so the entitlement can't be bypassed from the client.
  let proValues: Required<ProFilters> = { yearFrom: null, yearTo: null, minVote: null };
  const requestsProFilters =
    (proFilters.yearFrom ?? null) !== null ||
    (proFilters.yearTo ?? null) !== null ||
    (proFilters.minVote ?? null) !== null;

  if (requestsProFilters) {
    const cleaned = cleanProFilters(proFilters);
    if (!cleaned.ok) {
      return { ok: false, code: 'validation', message: 'Invalid filter values.' };
    }
    if (await isPro(user.id)) proValues = cleaned.value;
  }

  try {
    const { error: upsertError } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: user.id,
          genres: cleanGenres,
          year_from: proValues.yearFrom,
          year_to: proValues.yearTo,
          min_vote: proValues.minVote,
          updated_at: new Date().toISOString(),
        },
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

    return {
      ok: true,
      data: {
        genres: cleanGenres,
        yearFrom: proValues.yearFrom,
        yearTo: proValues.yearTo,
        minVote: proValues.minVote,
      },
    };
  } catch (error) {
    logger.error('SET_PREFERENCES_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Failed to save your filters. Please try again.' };
  }
}
