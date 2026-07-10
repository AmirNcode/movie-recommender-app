/**
 * Server Actions for fetching movie data from TMDB and generating
 * recommendations via Gemini AI.
 */
'use server';

import { GoogleGenAI, Type } from '@google/genai';
import { headers } from 'next/headers';
import type { SwipeAction, Recommendation, WatchProvider, WatchProviderCountryData, WatchProviderData } from '@/types/movie';
import type { MovieDetail } from '@/types/library';
import type { ActionResult } from '@/types/actions';
import type { Json } from '@/types/supabase';
import { isValidRecommendation } from '@/types/movie';
import { checkRateLimit } from '@/lib/rate-limit';
import { sanitiseForPrompt } from '@/lib/sanitise';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedMoviesByIds } from '@/lib/movie-queue';
import { validateMovie } from '@/lib/validate-movie';
import { assertServerEnv } from '@/lib/env';
import { buildPosterUrl, fetchTrailerKey, fetchWatchProviders, pickBestTmdbMatch } from '@/lib/tmdb';
import { getClientIp } from '@/lib/request-ip';

// Throws on first server-side import at runtime if required env is missing.
assertServerEnv();

/** Minimal movie metadata used to describe the user's taste to the model. */
type TasteEntry = { title: string; year: number; director: string; genre: string };

/** Server-built taste profile, partitioned by the user's latest action. */
type TasteProfile = {
  loved: TasteEntry[];
  watched: TasteEntry[];
  disliked: TasteEntry[];
  unwatched: TasteEntry[];
  /** Titles to exclude from the recommendation (most-recent 60 seen). */
  seenTitles: string[];
};

const WATCH_PROVIDER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseCountryFromAcceptLanguage(value: string | null): string {
  const fallback = 'US';
  if (!value) return fallback;

  for (const part of value.split(',')) {
    const tag = part.trim().split(';')[0];
    const region = tag?.split('-')[1];
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  }

  return fallback;
}

function isWatchProvider(value: unknown): value is WatchProvider {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.provider_id === 'number' &&
    typeof item.provider_name === 'string' &&
    (typeof item.logo_path === 'string' || item.logo_path === null)
  );
}

function providerList(value: unknown): WatchProvider[] {
  return Array.isArray(value) ? value.filter(isWatchProvider) : [];
}

function countryDataFromResults(results: Json | null, country: string): WatchProviderData | null {
  if (typeof results !== 'object' || results === null || Array.isArray(results)) return null;
  const countryEntry = (results as Record<string, unknown>)[country];
  if (typeof countryEntry !== 'object' || countryEntry === null || Array.isArray(countryEntry)) {
    return {
      country,
      stream: [],
      rent: [],
      buy: [],
    };
  }

  const data = countryEntry as WatchProviderCountryData;
  return {
    country,
    link: typeof data.link === 'string' ? data.link : undefined,
    stream: providerList(data.flatrate),
    rent: providerList(data.rent),
    buy: providerList(data.buy),
  };
}


/**
 * Builds a rich metadata string for a taste entry to give Gemini context
 * beyond just the title (genre, director, year). Every DB-sourced string is
 * run through sanitiseForPrompt (titles/synopses originated from client/TMDB).
 */
function tasteLabel(entry: TasteEntry): string {
  const parts = [sanitiseForPrompt(entry.title)];
  if (entry.year) parts.push(`(${entry.year})`);
  if (entry.director && entry.director !== 'Unknown Director') {
    parts.push(`dir. ${sanitiseForPrompt(entry.director)}`);
  }
  if (entry.genre) parts.push(`[${sanitiseForPrompt(entry.genre)}]`);
  return parts.join(' ');
}

/**
 * Builds the user's taste profile server-side from persisted swipe state,
 * so recommendations survive a page reload and the client can't inject
 * arbitrary/unbounded content into the paid Gemini prompt.
 *
 * Metadata for each rated movie is hydrated from movies_cache first, then
 * falls back to the most-recent swipe_events row (covers recommendation-
 * sourced swipes that never entered the discovery cache). Reads use the
 * user-scoped client so RLS restricts rows to the caller.
 */
async function buildTasteProfile(userId: string): Promise<TasteProfile> {
  const supabase = await createClient();

  const { data: states } = await supabase
    .from('swipe_states')
    .select('tmdb_movie_id, latest_action, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(300);

  const stateRows = states ?? [];
  const ids = stateRows.map((s) => s.tmdb_movie_id);

  const metadata = new Map<number, TasteEntry>();

  if (ids.length > 0) {
    const cachedMap = await getCachedMoviesByIds(ids);
    for (const id of ids) {
      const cached = cachedMap.get(id);
      if (cached) {
        metadata.set(id, {
          title: cached.title,
          year: cached.year,
          director: cached.director,
          genre: cached.genre,
        });
      }
    }

    const missingIds = ids.filter((id) => !metadata.has(id));
    if (missingIds.length > 0) {
      const { data: events } = await supabase
        .from('swipe_events')
        .select('tmdb_movie_id, movie_title, movie_year, movie_director, movie_genre, created_at')
        .eq('user_id', userId)
        .in('tmdb_movie_id', missingIds)
        .order('created_at', { ascending: false });

      for (const row of events ?? []) {
        // Rows are newest-first; keep only the most recent per movie.
        if (metadata.has(row.tmdb_movie_id) || !row.movie_title) continue;
        metadata.set(row.tmdb_movie_id, {
          title: row.movie_title,
          year: row.movie_year ?? 0,
          director: row.movie_director ?? 'Unknown Director',
          genre: row.movie_genre ?? 'Unknown Genre',
        });
      }
    }
  }

  const loved: TasteEntry[] = [];
  const watched: TasteEntry[] = [];
  const disliked: TasteEntry[] = [];
  const unwatched: TasteEntry[] = [];
  const seenTitles: string[] = [];

  // stateRows are ordered newest-first, so the partitions and seenTitles
  // are naturally most-recent-first before capping.
  for (const state of stateRows) {
    const entry = metadata.get(state.tmdb_movie_id);
    if (!entry) continue;
    seenTitles.push(sanitiseForPrompt(entry.title));
    switch (state.latest_action) {
      case 'loved':
        loved.push(entry);
        break;
      case 'watched':
        watched.push(entry);
        break;
      case 'disliked':
        disliked.push(entry);
        break;
      case 'unwatched':
        unwatched.push(entry);
        break;
    }
  }

  return {
    loved: loved.slice(0, 60),
    watched: watched.slice(0, 60),
    disliked: disliked.slice(0, 60),
    unwatched: unwatched.slice(0, 60),
    seenTitles: seenTitles.slice(0, 60),
  };
}

/**
 * Stores a swipe action in the database against the authenticated user.
 * Inserts an immutable event row, then updates current state for fast reads.
 */
export async function saveSwipe(
  movie: MovieDetail,
  action: SwipeAction
): Promise<ActionResult<null>> {
  // Invalid id: silently succeed as a no-op (preserves prior fire-and-forget behaviour).
  if (!movie.tmdbId || movie.tmdbId <= 0) return { ok: true, data: null };

  // Normalise/cap the client-supplied payload before it hits the DB.
  const validated = validateMovie(movie);
  if (!validated.ok) return validated;
  const clean = validated.movie;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'saveSwipe', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const { error } = await supabase.rpc('record_swipe_event', {
      p_tmdb_movie_id: clean.tmdbId,
      p_action: action,
      p_movie_title: clean.title || undefined,
      p_movie_year: clean.year || undefined,
      p_movie_director: clean.director || undefined,
      p_movie_genre: clean.genre || undefined,
      p_poster_url: clean.posterUrl || undefined,
      p_movie_synopsis: clean.synopsis || undefined,
      p_recommendation_reason: clean.recommendationReason || undefined,
      p_source: clean.source || undefined,
    });

    if (error) {
      logger.warn('SAVE_SWIPE_RPC_FAILED', { error: error.message });
      return { ok: false, code: 'save_failed', message: 'Failed to save your swipe. Please try again.' };
    }

    return { ok: true, data: null };
  } catch (error) {
    logger.error('SAVE_SWIPE_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Failed to save your swipe. Please try again.' };
  }
}

/** Client-supplied fields for a shareable recommendation snapshot. */
type ShareRecommendationInput = {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  reason?: string;
};

/**
 * Persists a snapshot of a recommendation and returns its public share path.
 *
 * The row is inserted through the user-scoped client so the RLS insert policy
 * ties it to the authenticated owner; the resulting `/r/<id>` page is publicly
 * readable (see the S2 migration for the public-SELECT rationale). All text is
 * validated/truncated and the poster is dropped unless it is a TMDB image URL,
 * reusing the F6 {@link validateMovie} guard.
 */
export async function shareRecommendation(
  rec: ShareRecommendationInput
): Promise<ActionResult<{ url: string }>> {
  const validated = validateMovie({
    tmdbId: rec.tmdbId,
    title: rec.title ?? '',
    year: typeof rec.year === 'number' ? rec.year : 0,
    director: '',
    genre: '',
    synopsis: '',
    recommendationReason: rec.reason ?? null,
    posterUrl: rec.posterUrl,
  });
  if (!validated.ok) return validated;
  const clean = validated.movie;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'shareRecommendation', user.id);
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
      .from('shared_recommendations')
      .insert({
        user_id: user.id,
        tmdb_movie_id: clean.tmdbId,
        movie_title: clean.title || 'Untitled',
        movie_year: clean.year || null,
        poster_url: clean.posterUrl ?? null,
        reason: clean.recommendationReason ?? null,
      })
      .select('id')
      .single();

    if (error || !data) {
      logger.warn('SHARE_REC_INSERT_FAILED', { error: error?.message });
      return { ok: false, code: 'save_failed', message: 'Could not create a share link. Please try again.' };
    }

    return { ok: true, data: { url: `/r/${data.id}` } };
  } catch (error) {
    logger.error('SHARE_REC_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Could not create a share link. Please try again.' };
  }
}

export async function getWatchProviders(tmdbId: number): Promise<ActionResult<WatchProviderData | null>> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { ok: false, code: 'validation', message: 'Invalid movie id.' };
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
  const rateCheck = await checkRateLimit(ip, 'getWatchProviders', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const country = parseCountryFromAcceptLanguage((await headers()).get('accept-language'));
    const admin = createAdminClient();
    const apiKey = process.env.TMDB_API_KEY;

    if (!admin || !apiKey) {
      logger.error('WATCH_PROVIDERS_UNCONFIGURED', { hasAdmin: Boolean(admin), hasApiKey: Boolean(apiKey) });
      return { ok: false, code: 'load_failed', message: 'Failed to load streaming providers.' };
    }

    const { data: cachedRow, error: cacheError } = await admin
      .from('movies_cache')
      .select('watch_providers, watch_providers_fetched_at')
      .eq('tmdb_movie_id', tmdbId)
      .maybeSingle();

    if (cacheError) {
      logger.warn('WATCH_PROVIDERS_CACHE_READ_FAILED', { tmdbId, error: cacheError.message });
    }

    const fetchedAt = cachedRow?.watch_providers_fetched_at
      ? new Date(cachedRow.watch_providers_fetched_at).getTime()
      : 0;
    const isFresh = fetchedAt > 0 && Date.now() - fetchedAt < WATCH_PROVIDER_CACHE_TTL_MS;

    if (cachedRow?.watch_providers && isFresh) {
      logger.warn('WATCH_PROVIDERS_CACHE_HIT', { tmdbId, country });
      return { ok: true, data: countryDataFromResults(cachedRow.watch_providers, country) };
    }

    const fetched = await fetchWatchProviders(apiKey, tmdbId);
    if (fetched) {
      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from('movies_cache')
        .update({
          watch_providers: fetched,
          watch_providers_fetched_at: now,
          updated_at: now,
        })
        .eq('tmdb_movie_id', tmdbId);

      if (updateError) {
        logger.warn('WATCH_PROVIDERS_CACHE_WRITE_FAILED', { tmdbId, error: updateError.message });
      } else {
        logger.warn('WATCH_PROVIDERS_FETCHED', { tmdbId, country });
      }

      return { ok: true, data: countryDataFromResults(fetched, country) };
    }

    if (cachedRow?.watch_providers) {
      logger.warn('WATCH_PROVIDERS_FETCH_FAILED_USING_STALE_CACHE', { tmdbId, country });
      return { ok: true, data: countryDataFromResults(cachedRow.watch_providers, country) };
    }

    logger.warn('WATCH_PROVIDERS_UNAVAILABLE', { tmdbId, country });
    return { ok: true, data: null };
  } catch (error) {
    logger.error('WATCH_PROVIDERS_FAILED', { tmdbId, error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load streaming providers.' };
  }
}

/**
 * Returns the YouTube key for a movie's trailer, if one is known.
 *
 * Cache-first: once a `movies_cache` row exists it is treated as authoritative
 * (the nightly pool cron — S10 — backfills `trailer_key` for older rows), so a
 * `null` there means "checked, no trailer" rather than "never checked". Ids
 * with no cache row (e.g. a fresh Gemini recommendation not yet in the pool)
 * fall back to a live TMDB fetch, best-effort persisted if the row exists.
 */
export async function getTrailer(tmdbId: number): Promise<ActionResult<{ trailerKey: string | null }>> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { ok: false, code: 'validation', message: 'Invalid movie id.' };
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
  const rateCheck = await checkRateLimit(ip, 'getTrailer', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const admin = createAdminClient();
    const apiKey = process.env.TMDB_API_KEY;

    if (!admin || !apiKey) {
      logger.error('TRAILER_UNCONFIGURED', { hasAdmin: Boolean(admin), hasApiKey: Boolean(apiKey) });
      return { ok: false, code: 'load_failed', message: 'Failed to load trailer.' };
    }

    const { data: cachedRow, error: cacheError } = await admin
      .from('movies_cache')
      .select('trailer_key')
      .eq('tmdb_movie_id', tmdbId)
      .maybeSingle();

    if (cacheError) {
      logger.warn('TRAILER_CACHE_READ_FAILED', { tmdbId, error: cacheError.message });
    }

    if (cachedRow) {
      return { ok: true, data: { trailerKey: cachedRow.trailer_key ?? null } };
    }

    const trailerKey = await fetchTrailerKey(apiKey, tmdbId);
    return { ok: true, data: { trailerKey } };
  } catch (error) {
    logger.error('TRAILER_FAILED', { tmdbId, error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to load trailer.' };
  }
}

/**
 * Generates a personalized movie recommendation using Gemini.
 *
 * The taste profile is built server-side from persisted swipe state, so it
 * survives page reloads and cannot be spoofed by the client.
 */
export async function getMovieRecommendation(): Promise<ActionResult<Recommendation | null>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'getMovieRecommendation', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const { loved, watched, disliked, unwatched, seenTitles } = await buildTasteProfile(user.id);

    if (loved.length + watched.length + disliked.length === 0) {
      return { ok: false, code: 'no_taste_profile', message: 'Rate at least one movie first.' };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
You are a cinephile recommendation engine. Analyse the user's taste profile
below, then recommend ONE film they are very likely to love.

## User taste profile

LOVED (highly rated by user):
${loved.length ? loved.map(tasteLabel).join('\n') : 'None yet'}

WATCHED AND LIKED (neutral positive):
${watched.length ? watched.map(tasteLabel).join('\n') : 'None yet'}

DISLIKED:
${disliked.length ? disliked.map(tasteLabel).join('\n') : 'None yet'}

HAVEN'T WATCHED (swiped past):
${unwatched.length ? unwatched.map(tasteLabel).join('\n') : 'None yet'}

## Instructions

1. First, silently identify 2-3 patterns in the loved list (genres, directors,
   themes, tone, era). Use these patterns to drive your pick.
2. Recommend ONE film that is NOT in any of the lists above. Do not recommend:
   ${seenTitles.join(', ')}
3. Avoid defaulting to the single most famous film in a genre.
4. The "reason" field should explain specifically *why* this matches their
   taste (reference their loved films by name).

Return ONLY valid JSON — no markdown, no preamble.
`.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            year: { type: Type.INTEGER },
            director: { type: Type.STRING },
            genre: { type: Type.STRING },
            synopsis: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ['title', 'year', 'director', 'genre', 'synopsis', 'reason'],
        },
      },
    });

    const text = response.text;
    if (!text) {
      logger.error('GEMINI_EMPTY_RESPONSE');
      return { ok: true, data: null };
    }

    const parsed: unknown = JSON.parse(text);
    if (!isValidRecommendation(parsed)) {
      logger.error('GEMINI_INVALID_SHAPE', {
        preview: String(JSON.stringify(parsed)).slice(0, 200),
      });
      return { ok: true, data: null };
    }

    const recommendation: Recommendation = { ...parsed, source: 'recommendation' };

    const apiKey = process.env.TMDB_API_KEY;
    if (apiKey && recommendation.title) {
      try {
        const searchRes = await fetch(
          `https://api.themoviedb.org/3/search/movie` +
            `?api_key=${apiKey}` +
            `&query=${encodeURIComponent(recommendation.title)}` +
            `&year=${recommendation.year}` +
            `&language=en-US`
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const bestMatch = pickBestTmdbMatch(searchData.results, recommendation);
          if (bestMatch?.poster_path) {
            recommendation.posterUrl = buildPosterUrl(bestMatch.poster_path);
          }
          if (bestMatch?.id) {
            recommendation.tmdbId = Number(bestMatch.id);
          }
        }
      } catch (err) {
        logger.warn('POSTER_FETCH_FAILED', { error: String(err) });
      }
    }

    return { ok: true, data: recommendation };
  } catch (error) {
    logger.error('RECOMMENDATION_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to get recommendation. Please try again.' };
  }
}
