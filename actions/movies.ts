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
import { buildTasteProfile, tasteSectionsText, type TasteProfile } from '@/lib/taste-profile';
import { validateMovie } from '@/lib/validate-movie';
import {
  TASTE_WEIGHTS,
  computeTasteVector,
  fromVectorLiteral,
  toVectorLiteral,
} from '@/lib/embeddings';
import { assertServerEnv } from '@/lib/env';
import { buildPosterUrl, fetchTrailerKey, fetchWatchProviders, pickBestTmdbMatch } from '@/lib/tmdb';
import { getClientIp } from '@/lib/request-ip';
import { withAffiliateParams } from '@/lib/affiliate';
import { isPro } from '@/lib/billing';

// Throws on first server-side import at runtime if required env is missing.
assertServerEnv();


const WATCH_PROVIDER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// D3 default: 3 free recommendations/day. Pro users bypass the quota (S14).
const FREE_TIER_DAILY_RECOMMENDATION_QUOTA = 3;

function startOfUtcDayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

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
    link: typeof data.link === 'string' ? withAffiliateParams(data.link) : undefined,
    stream: providerList(data.flatrate),
    rent: providerList(data.rent),
    buy: providerList(data.buy),
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

const RECOMMENDATION_MODEL = 'gemini-2.5-flash';

/** How many pool candidates the embeddings engine retrieves for re-ranking. */
const CANDIDATE_COUNT = 30;
/** Below this many candidates the embeddings engine defers to freeform. */
const MIN_CANDIDATES = 5;

/** Result of one generation engine run, ready for the ledger + response. */
type GenerationOutcome = {
  recommendation: Recommendation;
  promptTokens: number | null;
  outputTokens: number | null;
  engine: 'freeform' | 'embeddings';
};

/**
 * Legacy free-form engine: Gemini invents any film outside the seen lists,
 * then TMDB search resolves the poster/id. Returns null when the model
 * produced nothing usable (caller responds `data: null`, no ledger row).
 */
async function generateFreeformRecommendation(
  ai: GoogleGenAI,
  profile: TasteProfile
): Promise<GenerationOutcome | null> {
  const prompt = `
You are a cinephile recommendation engine. Analyse the user's taste profile
below, then recommend ONE film they are very likely to love.

## User taste profile

${tasteSectionsText(profile)}

## Instructions

1. First, silently identify 2-3 patterns in the loved list (genres, directors,
   themes, tone, era). Use these patterns to drive your pick.
2. Recommend ONE film that is NOT in any of the lists above. Do not recommend:
   ${profile.seenTitles.join(', ')}
3. Avoid defaulting to the single most famous film in a genre.
4. The "reason" field should explain specifically *why* this matches their
   taste (reference their loved films by name).

Return ONLY valid JSON — no markdown, no preamble.
`.trim();

  const response = await ai.models.generateContent({
    model: RECOMMENDATION_MODEL,
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
    return null;
  }

  const parsed: unknown = JSON.parse(text);
  if (!isValidRecommendation(parsed)) {
    logger.error('GEMINI_INVALID_SHAPE', {
      preview: String(JSON.stringify(parsed)).slice(0, 200),
    });
    return null;
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

  return {
    recommendation,
    promptTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    engine: 'freeform',
  };
}

/**
 * S11 embeddings engine: the user's taste vector (weighted mean of their rated
 * movies' embeddings) retrieves the closest unseen pool candidates via
 * `match_candidates`; Gemini only re-ranks that list and writes the reason.
 * The pick is guaranteed to be a real, in-catalog movie with cached metadata,
 * so no TMDB search round-trip is needed.
 *
 * Returns null whenever this engine can't run (no rated-movie embeddings yet,
 * pool too small, RPC failure) — the caller then falls back to freeform.
 */
async function generateEmbeddingRecommendation(
  ai: GoogleGenAI,
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  userId: string,
  profile: TasteProfile
): Promise<GenerationOutcome | null> {
  const weighted = [
    ...profile.loved.map((e) => ({ id: e.tmdbId, weight: TASTE_WEIGHTS.loved })),
    ...profile.watched.map((e) => ({ id: e.tmdbId, weight: TASTE_WEIGHTS.watched })),
    ...profile.disliked.map((e) => ({ id: e.tmdbId, weight: TASTE_WEIGHTS.disliked })),
  ];
  if (weighted.length === 0) return null;

  const { data: vectorRows, error: vectorError } = await admin
    .from('movies_cache')
    .select('tmdb_movie_id, embedding')
    .in('tmdb_movie_id', weighted.map((w) => w.id))
    .not('embedding', 'is', null);

  if (vectorError || !vectorRows || vectorRows.length === 0) {
    logger.warn('EMBEDDINGS_NO_RATED_VECTORS', {
      rated: weighted.length,
      error: vectorError?.message,
    });
    return null;
  }

  const vectorById = new Map(
    vectorRows.map((row) => [row.tmdb_movie_id, fromVectorLiteral(row.embedding)])
  );
  const entries = weighted.flatMap(({ id, weight }) => {
    const embedding = vectorById.get(id);
    return embedding ? [{ embedding, weight }] : [];
  });

  const tasteVector = computeTasteVector(entries);
  if (!tasteVector) {
    logger.warn('EMBEDDINGS_TASTE_VECTOR_EMPTY', { entries: entries.length });
    return null;
  }

  const { data: candidates, error: matchError } = await admin.rpc('match_candidates', {
    p_user_id: userId,
    p_query: toVectorLiteral(tasteVector),
    p_count: CANDIDATE_COUNT,
  });

  if (matchError || !candidates || candidates.length < MIN_CANDIDATES) {
    logger.warn('EMBEDDINGS_POOL_EXHAUSTED', {
      count: candidates?.length ?? 0,
      error: matchError?.message,
    });
    return null;
  }

  const candidateById = new Map(candidates.map((c) => [c.tmdb_movie_id, c]));
  const candidateLines = candidates.map((c) => {
    const year = c.year ? ` (${c.year})` : '';
    const genre = c.genre ? ` [${sanitiseForPrompt(c.genre)}]` : '';
    const synopsis = c.synopsis ? ` — ${sanitiseForPrompt(c.synopsis)}` : '';
    return `- id ${c.tmdb_movie_id}: ${sanitiseForPrompt(c.title)}${year}${genre}${synopsis}`;
  });

  const basePrompt = `
You are a cinephile recommendation engine. Analyse the user's taste profile,
then pick the ONE candidate film they are most likely to love.

## User taste profile

${tasteSectionsText(profile)}

## Candidate films (you MUST pick exactly one of these, by id)

${candidateLines.join('\n')}

## Instructions

1. Silently identify 2-3 patterns in the loved list (genres, directors, themes,
   tone, era) and use them to rank the candidates.
2. Return the id of the single best-fitting candidate. Do not invent an id.
3. Avoid defaulting to the most famous candidate.
4. The "reason" field should explain specifically *why* this matches their
   taste (reference their loved films by name).

Return ONLY valid JSON — no markdown, no preamble.
`.trim();

  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  const addUsage = (usage?: { promptTokenCount?: number; candidatesTokenCount?: number }) => {
    if (usage?.promptTokenCount != null) promptTokens = (promptTokens ?? 0) + usage.promptTokenCount;
    if (usage?.candidatesTokenCount != null) outputTokens = (outputTokens ?? 0) + usage.candidatesTokenCount;
  };

  let chosen: (typeof candidates)[number] | null = null;
  let reason = '';

  for (let attempt = 0; attempt < 2 && !chosen; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: RECOMMENDATION_MODEL,
        contents:
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANT: Your previous answer was not a valid candidate id. Return the tmdbId of one movie from the candidate list above.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tmdbId: { type: Type.INTEGER },
              reason: { type: Type.STRING },
            },
            required: ['tmdbId', 'reason'],
          },
        },
      });
      addUsage(response.usageMetadata);

      const parsed: unknown = response.text ? JSON.parse(response.text) : null;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as { tmdbId?: unknown; reason?: unknown };
        const candidate =
          typeof obj.tmdbId === 'number' ? candidateById.get(obj.tmdbId) : undefined;
        if (candidate && typeof obj.reason === 'string' && obj.reason.trim()) {
          chosen = candidate;
          reason = obj.reason.trim();
          break;
        }
      }
      logger.warn('EMBEDDINGS_RERANK_INVALID_ID', { attempt });
    } catch (err) {
      logger.warn('EMBEDDINGS_RERANK_ATTEMPT_FAILED', { attempt, error: String(err) });
    }
  }

  if (!chosen) {
    // Spec fallback: highest-similarity candidate with a templated reason.
    chosen = candidates[0];
    const lovedNames = profile.loved
      .slice(0, 2)
      .map((e) => e.title)
      .filter(Boolean);
    reason = lovedNames.length
      ? `A close match to your taste profile — it shares DNA with ${lovedNames.join(' and ')}.`
      : 'The closest match to your taste profile right now.';
    logger.warn('EMBEDDINGS_RERANK_FALLBACK_TOP_CANDIDATE', {});
  }

  return {
    recommendation: {
      title: chosen.title,
      year: chosen.year ?? 0,
      director: chosen.director ?? 'Unknown Director',
      genre: chosen.genre ?? 'Unknown Genre',
      synopsis: chosen.synopsis ?? '',
      reason: reason.slice(0, 2000),
      posterUrl: chosen.poster_url ?? undefined,
      tmdbId: chosen.tmdb_movie_id,
      source: 'recommendation',
    },
    promptTokens,
    outputTokens,
    engine: 'embeddings',
  };
}

/**
 * Generates a personalized movie recommendation using Gemini.
 *
 * The taste profile is built server-side from persisted swipe state, so it
 * survives page reloads and cannot be spoofed by the client. Engine selection
 * (S11): embeddings retrieval + re-rank by default; `RECS_ENGINE=freeform`
 * forces the legacy free-form path for A/B comparison, which is also the
 * automatic fallback when the embeddings engine can't run.
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
    const admin = createAdminClient();
    if (!admin) {
      logger.error('RECOMMENDATION_QUOTA_UNCONFIGURED');
      return { ok: false, code: 'load_failed', message: 'Failed to get recommendation. Please try again.' };
    }

    // S13: free-tier daily quota (D3), bypassed for Pro (S14).
    if (!(await isPro(user.id))) {
      const { count: todaysCount, error: quotaError } = await admin
        .from('recommendations_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startOfUtcDayIso());

      if (quotaError) {
        logger.warn('RECOMMENDATION_QUOTA_CHECK_FAILED', { error: quotaError.message });
        return { ok: false, code: 'load_failed', message: 'Failed to get recommendation. Please try again.' };
      }

      if ((todaysCount ?? 0) >= FREE_TIER_DAILY_RECOMMENDATION_QUOTA) {
        return {
          ok: false,
          code: 'quota_exceeded',
          message: 'Daily limit reached — upgrade for unlimited recommendations.',
        };
      }
    }

    const profile = await buildTasteProfile(user.id);

    if (profile.loved.length + profile.watched.length + profile.disliked.length === 0) {
      return { ok: false, code: 'no_taste_profile', message: 'Rate at least one movie first.' };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    let outcome: GenerationOutcome | null = null;
    if (process.env.RECS_ENGINE !== 'freeform') {
      outcome = await generateEmbeddingRecommendation(ai, admin, user.id, profile);
    }
    if (!outcome) {
      outcome = await generateFreeformRecommendation(ai, profile);
    }
    if (!outcome) {
      return { ok: true, data: null };
    }

    const { recommendation } = outcome;

    // S12: ledger row for quotas (S13), analytics, and the S11 A/B engine
    // comparison. Best-effort — a logging failure must not fail the response
    // the user is already holding.
    const { error: logError } = await admin.from('recommendations_log').insert({
      user_id: user.id,
      tmdb_movie_id: recommendation.tmdbId || null,
      movie_title: recommendation.title || null,
      reason: recommendation.reason || null,
      engine: outcome.engine,
      prompt_tokens: outcome.promptTokens,
      output_tokens: outcome.outputTokens,
    });
    if (logError) {
      logger.warn('RECOMMENDATION_LOG_INSERT_FAILED', { error: logError.message });
    }

    return { ok: true, data: recommendation };
  } catch (error) {
    logger.error('RECOMMENDATION_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Failed to get recommendation. Please try again.' };
  }
}
