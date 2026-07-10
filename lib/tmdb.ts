import type { Recommendation } from '@/types/movie';
import type { Json } from '@/types/supabase';

type TmdbSearchResult = {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  popularity?: number;
};

function normaliseTitle(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractYear(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const year = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

function scoreTmdbResult(result: TmdbSearchResult, target: Recommendation): number {
  const targetTitle = normaliseTitle(target.title);
  const resultTitle = normaliseTitle(result.title);
  const resultOriginalTitle = normaliseTitle(result.original_title);
  const resultYear = extractYear(result.release_date);

  let score = 0;

  if (resultTitle === targetTitle) score += 120;
  else if (resultOriginalTitle === targetTitle) score += 110;
  else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) score += 40;

  if (resultYear !== null) {
    const yearDelta = Math.abs(resultYear - target.year);
    if (yearDelta === 0) score += 80;
    else if (yearDelta === 1) score += 35;
    else if (yearDelta === 2) score += 10;
    else score -= Math.min(yearDelta * 5, 40);
  }

  if (result.poster_path) score += 5;
  if (typeof result.popularity === 'number') {
    score += Math.min(result.popularity / 10, 5);
  }

  return score;
}

export function pickBestTmdbMatch(
  results: TmdbSearchResult[] | undefined,
  target: Recommendation
): TmdbSearchResult | null {
  if (!results?.length) return null;

  const ranked = results
    .map((result) => ({ result, score: scoreTmdbResult(result, target) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const exactTitleMatch =
    normaliseTitle(best.result.title) === normaliseTitle(target.title) ||
    normaliseTitle(best.result.original_title) === normaliseTitle(target.title);
  const exactYearMatch = extractYear(best.result.release_date) === target.year;

  if (best.score < 80 && !(exactTitleMatch && exactYearMatch)) {
    return null;
  }

  return best.result;
}

export function buildPosterUrl(posterPath: string | null | undefined): string | undefined {
  return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : undefined;
}

export async function fetchWatchProviders(apiKey: string, tmdbId: number): Promise<Json | null> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;

  const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers`);
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;

  const data = await response.json();
  return (data?.results ?? null) as Json | null;
}

export async function fetchTrailerKey(apiKey: string, tmdbId: number): Promise<string | null> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;

  const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}/videos`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'en-US');

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;

  const data = await response.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  const trailer = results.find(
    (v: { type?: string; site?: string; key?: string }) => v.type === 'Trailer' && v.site === 'YouTube'
  );

  return typeof trailer?.key === 'string' ? trailer.key : null;
}
