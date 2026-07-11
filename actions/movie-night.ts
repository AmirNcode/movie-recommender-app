/**
 * Server Actions for Movie Night (S6) — the two-user match mode.
 *
 * A host creates a night (unique join code) and shares the code; a guest joins,
 * at which point a shared 30-card deck is dealt from movies_cache excluding
 * either user's swipe history. Both swipe a binary yes/no; the first movie both
 * mark "yes" resolves the night to `matched` via a security-definer,
 * advisory-locked RPC (first mutual like wins). Realtime on `movie_nights`
 * flips both clients to the match screen.
 *
 * Auth is enforced with the user-scoped client (RLS restricts every read/write
 * to participants); privileged steps — claiming the guest slot, dealing cards,
 * resolving a match, writing both watchlists — run through the admin client /
 * service-role RPCs.
 */
'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/request-ip';
import {
  generateMovieNightCode,
  normalizeMovieNightCode,
  MOVIE_NIGHT_DECK_SIZE,
} from '@/lib/movie-night';
import type { ActionResult } from '@/types/actions';
import type { Database } from '@/types/supabase';
import type {
  MovieNightCard,
  MovieNightHandle,
  MovieNightSnapshot,
  MovieNightStatus,
  MovieNightVoteResult,
} from '@/types/movie-night';

type CacheRow = Database['public']['Tables']['movies_cache']['Row'];

// Free tier: one night per host per rolling 7 days. S14 (Stripe) will add an
// isPro() bypass; until it lands every user is treated as free tier (mirrors
// the S13 quota approach).
const FREE_TIER_NIGHTS_PER_WEEK = 1;
const CODE_INSERT_ATTEMPTS = 6;

function mapCardRow(cache: CacheRow, rank: number): MovieNightCard {
  return {
    tmdbId: cache.tmdb_movie_id,
    title: cache.title,
    year: cache.year ?? 0,
    director: cache.director ?? 'Unknown Director',
    genre: cache.genre ?? 'Unknown Genre',
    synopsis: cache.synopsis ?? '',
    posterUrl: cache.poster_url ?? undefined,
    rank,
  };
}

/**
 * Creates a movie night owned by the caller and returns its join code.
 * Enforces the free-tier weekly cap. The night starts in `waiting`; cards are
 * dealt lazily when a guest joins (both users must be known first).
 */
export async function createMovieNight(): Promise<ActionResult<MovieNightHandle>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'createMovieNight', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    // Free-tier weekly cap (Pro bypass lands with S14).
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('movie_nights')
      .select('id', { count: 'exact', head: true })
      .eq('host_id', user.id)
      .gte('created_at', weekAgo);

    if (countError) {
      logger.warn('MOVIE_NIGHT_COUNT_FAILED', { error: countError.message });
      return { ok: false, code: 'load_failed', message: 'Could not start a movie night. Please try again.' };
    }

    if ((count ?? 0) >= FREE_TIER_NIGHTS_PER_WEEK) {
      return {
        ok: false,
        code: 'quota_exceeded',
        message: 'Free tier is limited to one Movie Night per week — upgrade for unlimited nights.',
      };
    }

    // Insert with a fresh code, retrying on the (rare) unique-code collision.
    for (let attempt = 0; attempt < CODE_INSERT_ATTEMPTS; attempt += 1) {
      const code = generateMovieNightCode();
      const { data, error } = await supabase
        .from('movie_nights')
        .insert({ code, host_id: user.id })
        .select('id, code')
        .single();

      if (!error && data) {
        return { ok: true, data: { nightId: data.id, code: data.code, isHost: true } };
      }

      // 23505 = unique_violation on the code; retry with a new code.
      if (error?.code === '23505') continue;

      logger.warn('MOVIE_NIGHT_INSERT_FAILED', { error: error?.message });
      return { ok: false, code: 'save_failed', message: 'Could not start a movie night. Please try again.' };
    }

    logger.error('MOVIE_NIGHT_CODE_EXHAUSTED');
    return { ok: false, code: 'save_failed', message: 'Could not start a movie night. Please try again.' };
  } catch (error) {
    logger.error('MOVIE_NIGHT_CREATE_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Could not start a movie night. Please try again.' };
  }
}

/**
 * Joins the night for the given code as the guest, atomically claiming the
 * (single) guest slot and dealing the shared deck. Idempotent for a guest who
 * re-joins their own night. Uses the admin client because the join is precisely
 * the act that makes the caller a participant, so the participant-only RLS can't
 * gate it.
 */
export async function joinMovieNight(codeInput: string): Promise<ActionResult<MovieNightHandle>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'joinMovieNight', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  const code = normalizeMovieNightCode(codeInput);
  if (!code) {
    return { ok: false, code: 'validation', message: 'Enter the 6-character code your host shared.' };
  }

  const admin = createAdminClient();
  if (!admin) {
    logger.error('MOVIE_NIGHT_JOIN_UNCONFIGURED');
    return { ok: false, code: 'load_failed', message: 'Could not join right now. Please try again.' };
  }

  try {
    const { data: night, error: readError } = await admin
      .from('movie_nights')
      .select('id, host_id, guest_id, status')
      .eq('code', code)
      .maybeSingle();

    if (readError) {
      logger.warn('MOVIE_NIGHT_JOIN_READ_FAILED', { error: readError.message });
      return { ok: false, code: 'load_failed', message: 'Could not join right now. Please try again.' };
    }
    if (!night) {
      return { ok: false, code: 'validation', message: 'No movie night found for that code.' };
    }
    if (night.host_id === user.id) {
      return { ok: false, code: 'validation', message: "You can't join your own movie night — share the code instead." };
    }
    if (night.guest_id && night.guest_id !== user.id) {
      return { ok: false, code: 'validation', message: 'This movie night is already full.' };
    }
    if (night.status === 'expired' || night.status === 'matched') {
      return { ok: false, code: 'validation', message: 'This movie night is no longer available.' };
    }

    // Claim the guest slot only if still open — a conditional update makes two
    // simultaneous joiners safe (the loser sees 0 rows updated).
    if (night.guest_id !== user.id) {
      const { data: claimed, error: claimError } = await admin
        .from('movie_nights')
        .update({ guest_id: user.id, status: 'active' })
        .eq('id', night.id)
        .is('guest_id', null)
        .eq('status', 'waiting')
        .select('id');

      if (claimError) {
        logger.warn('MOVIE_NIGHT_CLAIM_FAILED', { error: claimError.message });
        return { ok: false, code: 'save_failed', message: 'Could not join right now. Please try again.' };
      }
      if (!claimed || claimed.length === 0) {
        return { ok: false, code: 'validation', message: 'This movie night is already full.' };
      }
    }

    // Deal the shared deck (idempotent — a re-join finds cards already dealt).
    const { data: dealt, error: dealError } = await admin.rpc('fill_movie_night_cards', {
      p_night_id: night.id,
      p_host: night.host_id,
      p_guest: user.id,
      p_count: MOVIE_NIGHT_DECK_SIZE,
    });

    if (dealError) {
      logger.error('MOVIE_NIGHT_DEAL_FAILED', { error: dealError.message });
      return { ok: false, code: 'save_failed', message: 'Could not set up the deck. Please try again.' };
    }

    logger.info('MOVIE_NIGHT_JOINED', { nightId: night.id, dealt });
    return { ok: true, data: { nightId: night.id, code, isHost: false } };
  } catch (error) {
    logger.error('MOVIE_NIGHT_JOIN_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Could not join right now. Please try again.' };
  }
}

/**
 * Returns the night's current status + shared deck for a participant. RLS on the
 * night, cards, and cache tables restricts every row to the two participants.
 */
export async function getMovieNight(nightId: string): Promise<ActionResult<MovieNightSnapshot>> {
  if (typeof nightId !== 'string' || nightId.length === 0) {
    return { ok: false, code: 'validation', message: 'Invalid movie night.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'getMovieNight', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    // RLS returns the row only if the caller is a participant.
    const { data: night, error: nightError } = await supabase
      .from('movie_nights')
      .select('host_id, status, matched_tmdb_id')
      .eq('id', nightId)
      .maybeSingle();

    if (nightError) {
      logger.warn('MOVIE_NIGHT_GET_FAILED', { error: nightError.message });
      return { ok: false, code: 'load_failed', message: 'Could not load the movie night.' };
    }
    if (!night) {
      return { ok: false, code: 'unauthorized', message: 'This movie night is not available.' };
    }

    const { data: cardRows, error: cardsError } = await supabase
      .from('movie_night_cards')
      .select('rank, tmdb_movie_id, movies_cache(*)')
      .eq('night_id', nightId)
      .order('rank', { ascending: true });

    if (cardsError) {
      logger.warn('MOVIE_NIGHT_CARDS_FAILED', { error: cardsError.message });
      return { ok: false, code: 'load_failed', message: 'Could not load the deck.' };
    }

    const cards: MovieNightCard[] = (cardRows ?? [])
      .map((row) => {
        const cache = row.movies_cache as CacheRow | null;
        return cache ? mapCardRow(cache, row.rank) : null;
      })
      .filter((card): card is MovieNightCard => card !== null);

    return {
      ok: true,
      data: {
        status: night.status as MovieNightStatus,
        isHost: night.host_id === user.id,
        matchedTmdbId: night.matched_tmdb_id ?? null,
        cards,
      },
    };
  } catch (error) {
    logger.error('MOVIE_NIGHT_GET_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Could not load the movie night.' };
  }
}

/**
 * Records the caller's yes/no vote for a movie in the night, then (on a "yes")
 * asks the resolver RPC whether both participants now like it. Returns whether a
 * match resolved so the voting client can flip immediately; the other client is
 * flipped by the Realtime status change.
 */
export async function voteMovieNight(
  nightId: string,
  tmdbId: number,
  liked: boolean
): Promise<ActionResult<MovieNightVoteResult>> {
  if (typeof nightId !== 'string' || nightId.length === 0) {
    return { ok: false, code: 'validation', message: 'Invalid movie night.' };
  }
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { ok: false, code: 'validation', message: 'Invalid movie.' };
  }
  if (typeof liked !== 'boolean') {
    return { ok: false, code: 'validation', message: 'Invalid vote.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'voteMovieNight', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    // Reject votes for movies that aren't part of this night's deck (RLS also
    // confirms the caller is a participant — a non-participant sees no cards).
    const { data: card, error: cardError } = await supabase
      .from('movie_night_cards')
      .select('tmdb_movie_id')
      .eq('night_id', nightId)
      .eq('tmdb_movie_id', tmdbId)
      .maybeSingle();

    if (cardError) {
      logger.warn('MOVIE_NIGHT_VOTE_CARD_CHECK_FAILED', { error: cardError.message });
      return { ok: false, code: 'save_failed', message: 'Could not record your vote. Please try again.' };
    }
    if (!card) {
      return { ok: false, code: 'validation', message: "That movie isn't part of this night." };
    }

    const { error: voteError } = await supabase
      .from('movie_night_votes')
      .upsert(
        { night_id: nightId, user_id: user.id, tmdb_movie_id: tmdbId, liked },
        { onConflict: 'night_id,user_id,tmdb_movie_id' }
      );

    if (voteError) {
      logger.warn('MOVIE_NIGHT_VOTE_FAILED', { error: voteError.message });
      return { ok: false, code: 'save_failed', message: 'Could not record your vote. Please try again.' };
    }

    // Only a "yes" can create a match; skip the resolver round-trip otherwise.
    if (!liked) {
      return { ok: true, data: { matched: false, matchedTmdbId: null } };
    }

    const admin = createAdminClient();
    if (!admin) {
      logger.error('MOVIE_NIGHT_RESOLVE_UNCONFIGURED');
      return { ok: true, data: { matched: false, matchedTmdbId: null } };
    }

    const { data: matchedId, error: resolveError } = await admin.rpc('resolve_movie_night', {
      p_night_id: nightId,
      p_tmdb_id: tmdbId,
    });

    if (resolveError) {
      logger.warn('MOVIE_NIGHT_RESOLVE_FAILED', { error: resolveError.message });
      return { ok: true, data: { matched: false, matchedTmdbId: null } };
    }

    const matched = typeof matchedId === 'number' && matchedId > 0;
    return { ok: true, data: { matched, matchedTmdbId: matched ? matchedId : null } };
  } catch (error) {
    logger.error('MOVIE_NIGHT_VOTE_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Could not record your vote. Please try again.' };
  }
}

/**
 * Adds the matched movie to BOTH participants' watchlists. Requires the caller
 * to be a participant of a night that has actually matched. Writes run through
 * the admin client since one user can't write the other's watchlist under RLS;
 * existing watchlist rows are preserved (insert-if-absent).
 */
export async function addMovieNightToWatchlists(nightId: string): Promise<ActionResult<null>> {
  if (typeof nightId !== 'string' || nightId.length === 0) {
    return { ok: false, code: 'validation', message: 'Invalid movie night.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'addMovieNightToWatchlists', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    logger.error('MOVIE_NIGHT_WATCHLIST_UNCONFIGURED');
    return { ok: false, code: 'save_failed', message: 'Could not update watchlists. Please try again.' };
  }

  try {
    const { data: night, error: nightError } = await admin
      .from('movie_nights')
      .select('host_id, guest_id, status, matched_tmdb_id')
      .eq('id', nightId)
      .maybeSingle();

    if (nightError || !night) {
      logger.warn('MOVIE_NIGHT_WATCHLIST_READ_FAILED', { error: nightError?.message });
      return { ok: false, code: 'load_failed', message: 'Could not update watchlists. Please try again.' };
    }
    // Authorise against the true participants — don't trust the client's nightId
    // alone.
    if (user.id !== night.host_id && user.id !== night.guest_id) {
      return { ok: false, code: 'unauthorized', message: 'This movie night is not available.' };
    }
    if (night.status !== 'matched' || !night.matched_tmdb_id || !night.guest_id) {
      return { ok: false, code: 'validation', message: 'No match to add yet.' };
    }

    const { data: movie, error: movieError } = await admin
      .from('movies_cache')
      .select('tmdb_movie_id, title, year, director, genre, synopsis, poster_url')
      .eq('tmdb_movie_id', night.matched_tmdb_id)
      .maybeSingle();

    if (movieError || !movie) {
      logger.warn('MOVIE_NIGHT_WATCHLIST_MOVIE_FAILED', { error: movieError?.message });
      return { ok: false, code: 'load_failed', message: 'Could not update watchlists. Please try again.' };
    }

    const base = {
      tmdb_movie_id: movie.tmdb_movie_id,
      movie_title: movie.title,
      movie_year: movie.year ?? null,
      movie_director: movie.director ?? null,
      movie_genre: movie.genre ?? null,
      movie_synopsis: movie.synopsis ?? null,
      poster_url: movie.poster_url ?? null,
      source: 'movie_night',
    };

    const { error: upsertError } = await admin.from('watchlists').upsert(
      [
        { ...base, user_id: night.host_id },
        { ...base, user_id: night.guest_id },
      ],
      { onConflict: 'user_id,tmdb_movie_id', ignoreDuplicates: true }
    );

    if (upsertError) {
      logger.warn('MOVIE_NIGHT_WATCHLIST_UPSERT_FAILED', { error: upsertError.message });
      return { ok: false, code: 'save_failed', message: 'Could not update watchlists. Please try again.' };
    }

    return { ok: true, data: null };
  } catch (error) {
    logger.error('MOVIE_NIGHT_WATCHLIST_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Could not update watchlists. Please try again.' };
  }
}
