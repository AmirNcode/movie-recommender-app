/**
 * Server-side validation and normalisation for client-supplied movie metadata.
 *
 * An authenticated user can persist arbitrary strings (of any length) through
 * `saveSwipe` / `setWatchlistItem`, or directly via PostgREST with the
 * publishable key. This helper is the application-layer guard: it rejects a
 * structurally invalid id, drops untrusted poster URLs, normalises the free-text
 * `source` column to a known set, clamps the release year, and truncates
 * over-long text fields (truncate rather than reject, so a swipe is never lost
 * over a length overrun). A matching CHECK-constraint migration provides
 * defence-in-depth at the DB layer (F6 part 2).
 */
import type { MovieDetail } from '@/types/library';
import type { ActionFailure } from '@/types/actions';

/** Only posters served by TMDB's image CDN are stored; anything else is dropped. */
const TMDB_POSTER_RE = /^https:\/\/image\.tmdb\.org\/t\/p\/[\w/.\-]+$/;

/** Known values for the persisted `source` column. */
const VALID_SOURCES = new Set(['swipe', 'recommendation', 'watchlist', 'manual']);

const MAX_TMDB_ID = 2_000_000_000;
const MIN_YEAR = 1870;

/** Truncates a text field to `max` characters, preserving null/undefined. */
function cap<T extends string | null | undefined>(value: T, max: number): T {
  return (typeof value === 'string' ? value.slice(0, max) : value) as T;
}

/**
 * Validates and normalises a client-supplied movie payload.
 *
 * Returns the normalised movie on success, or an `ActionFailure` with
 * `code: 'validation'` when the TMDB id is structurally invalid (the only
 * hard failure — every other field is coerced into a safe range).
 */
export function validateMovie(
  movie: MovieDetail
): { ok: true; movie: MovieDetail } | ActionFailure {
  if (
    typeof movie.tmdbId !== 'number' ||
    !Number.isInteger(movie.tmdbId) ||
    movie.tmdbId <= 0 ||
    movie.tmdbId > MAX_TMDB_ID
  ) {
    return {
      ok: false,
      code: 'validation',
      message: 'Could not save this movie because its TMDB id is invalid.',
    };
  }

  const currentYear = new Date().getFullYear();
  const year =
    typeof movie.year === 'number' &&
    Number.isInteger(movie.year) &&
    movie.year >= MIN_YEAR &&
    movie.year <= currentYear + 2
      ? movie.year
      : 0; // Out-of-range year → 0 sentinel (persisted as null by callers).

  const posterUrl =
    typeof movie.posterUrl === 'string' && TMDB_POSTER_RE.test(movie.posterUrl)
      ? movie.posterUrl
      : undefined; // Untrusted poster → dropped, not rejected.

  // Coerce a present-but-unknown source to 'manual'; leave null/undefined
  // intact so callers can fall back to an existing row's stored source.
  let source = movie.source;
  if (source != null && !VALID_SOURCES.has(source)) source = 'manual';

  return {
    ok: true,
    movie: {
      ...movie,
      tmdbId: movie.tmdbId,
      title: cap(movie.title ?? '', 300),
      director: cap(movie.director, 300),
      genre: cap(movie.genre, 300),
      synopsis: cap(movie.synopsis, 2000),
      recommendationReason: cap(movie.recommendationReason, 2000),
      year,
      posterUrl,
      source,
    },
  };
}
