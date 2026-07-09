/**
 * Server Actions for fetching movie data from TMDB and generating
 * recommendations via Gemini AI.
 */
'use server';

import { GoogleGenAI, Type } from '@google/genai';
import { headers } from 'next/headers';
import type { SwipeAction, SwipedMovie, Recommendation } from '@/types/movie';
import type { MovieDetail } from '@/types/library';
import type { ActionResult } from '@/types/actions';
import { isValidRecommendation } from '@/types/movie';
import { checkRateLimit } from '@/lib/rate-limit';
import { sanitiseForPrompt } from '@/lib/sanitise';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { buildPosterUrl, pickBestTmdbMatch } from '@/lib/tmdb';

/**
 * Reads the client IP from Next.js request headers.
 * Falls back to localhost for local development.
 */
async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const forwarded = headersList.get('x-vercel-forwarded-for') ?? headersList.get('x-forwarded-for');
  if (!forwarded) return '127.0.0.1';
  return forwarded.split(',')[0]?.trim() || '127.0.0.1';
}

/**
 * Builds a rich metadata string for a swiped movie to give Gemini
 * context beyond just the title (genre, director, year).
 */
function movieLabel(m: SwipedMovie): string {
  const parts = [sanitiseForPrompt(m.title)];
  if (m.year) parts.push(`(${m.year})`);
  if (m.director && m.director !== 'Unknown Director') {
    parts.push(`dir. ${sanitiseForPrompt(m.director)}`);
  }
  if (m.genre) parts.push(`[${sanitiseForPrompt(m.genre)}]`);
  return parts.join(' ');
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  try {
    const { error } = await supabase.rpc('record_swipe_event', {
      p_tmdb_movie_id: movie.tmdbId,
      p_action: action,
      p_movie_title: movie.title || undefined,
      p_movie_year: movie.year || undefined,
      p_movie_director: movie.director || undefined,
      p_movie_genre: movie.genre || undefined,
      p_poster_url: movie.posterUrl || undefined,
      p_movie_synopsis: movie.synopsis || undefined,
      p_recommendation_reason: movie.recommendationReason || undefined,
      p_source: movie.source || undefined,
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

/**
 * Generates a personalized movie recommendation using Gemini.
 */
export async function getMovieRecommendation(
  swipedMovies: SwipedMovie[]
): Promise<ActionResult<Recommendation | null>> {
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
    const loved = swipedMovies.filter((m) => m.action === 'loved');
    const watched = swipedMovies.filter((m) => m.action === 'watched');
    const disliked = swipedMovies.filter((m) => m.action === 'disliked');
    const unwatched = swipedMovies.filter((m) => m.action === 'unwatched');

    const allSeenTitles = swipedMovies.map((m) => sanitiseForPrompt(m.title));
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
You are a cinephile recommendation engine. Analyse the user's taste profile
below, then recommend ONE film they are very likely to love.

## User taste profile

LOVED (highly rated by user):
${loved.length ? loved.map(movieLabel).join('\n') : 'None yet'}

WATCHED AND LIKED (neutral positive):
${watched.length ? watched.map(movieLabel).join('\n') : 'None yet'}

DISLIKED:
${disliked.length ? disliked.map(movieLabel).join('\n') : 'None yet'}

HAVEN'T WATCHED (swiped past):
${unwatched.length ? unwatched.map(movieLabel).join('\n') : 'None yet'}

## Instructions

1. First, silently identify 2-3 patterns in the loved list (genres, directors,
   themes, tone, era). Use these patterns to drive your pick.
2. Recommend ONE film that is NOT in any of the lists above. Do not recommend:
   ${allSeenTitles.slice(-60).join(', ')}
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
