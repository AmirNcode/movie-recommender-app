import type { CachedMovie, SourceTier } from '@/types/queue';

// Shared TMDB discovery + hydration helpers.
//
// Extracted from actions/queue.ts so both the user-facing queue path (the
// POOL_EXHAUSTED fallback) and the nightly pool-refresh cron (S10) can reuse
// them. Kept free of the 'use server' directive: these are plain server-side
// functions, not server actions.

export const TMDB_BASE = 'https://api.themoviedb.org/3';

type TmdbDiscoverResult = { id: number };

type DiscoverTierConfig = {
  tier: SourceTier;
  params: Record<string, string | number | boolean>;
  pages: number[];
};

export function buildTmdbUrl(path: string, params: Record<string, string | number | boolean>) {
  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function getDiscoveryPlan(): DiscoverTierConfig[] {
  return [
    {
      tier: 'mainstream',
      params: {
        include_adult: false,
        include_video: false,
        language: 'en-US',
        sort_by: 'popularity.desc',
        'vote_count.gte': '1000',
        'vote_average.gte': '6.0',
        'with_original_language': 'en',
        'primary_release_date.gte': '2005-01-01',
      },
      pages: [1, 2, 3, 4, 5],
    },
    {
      tier: 'broader-mainstream',
      params: {
        include_adult: false,
        include_video: false,
        language: 'en-US',
        sort_by: 'popularity.desc',
        'vote_count.gte': '300',
        'vote_average.gte': '5.8',
        'with_original_language': 'en',
        'primary_release_date.gte': '1990-01-01',
      },
      pages: [1, 2, 3, 4, 5, 6, 7, 8],
    },
    {
      tier: 'niche',
      params: {
        include_adult: false,
        include_video: false,
        language: 'en-US',
        sort_by: 'vote_average.desc',
        'vote_count.gte': '50',
        'vote_average.gte': '6.0',
        'primary_release_date.gte': '1970-01-01',
      },
      pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
  ];
}

export async function discoverCandidateIds(
  apiKey: string,
  excluded: Set<number>,
  targetCount: number
): Promise<Array<{ tmdbId: number; tier: SourceTier }>> {
  const plan = getDiscoveryPlan();
  const collected: Array<{ tmdbId: number; tier: SourceTier }> = [];

  for (const tierPlan of plan) {
    for (const page of tierPlan.pages) {
      if (collected.length >= targetCount) return collected;

      const res = await fetch(
        buildTmdbUrl('/discover/movie', {
          api_key: apiKey,
          ...tierPlan.params,
          page,
        }),
        { cache: 'no-store' }
      );

      if (!res.ok) continue;
      const data = await res.json();
      const results: TmdbDiscoverResult[] = data.results ?? [];

      for (const result of results) {
        if (!result?.id || excluded.has(result.id)) continue;
        excluded.add(result.id);
        collected.push({ tmdbId: result.id, tier: tierPlan.tier });
        if (collected.length >= targetCount) return collected;
      }
    }
  }

  return collected;
}

/**
 * Walks the discovery plan far enough to gather `target` distinct pool
 * candidates for the nightly refresh (S10). Unlike `discoverCandidateIds`,
 * this paginates each tier well beyond the small user-facing page windows and
 * applies no per-user exclusion — it builds the shared catalogue.
 */
export async function collectPoolCandidateIds(
  apiKey: string,
  target: number,
  maxPagesPerTier = 15
): Promise<Array<{ tmdbId: number; tier: SourceTier }>> {
  const plan = getDiscoveryPlan();
  const seen = new Set<number>();
  const collected: Array<{ tmdbId: number; tier: SourceTier }> = [];

  for (const tierPlan of plan) {
    for (let page = 1; page <= maxPagesPerTier; page++) {
      if (collected.length >= target) return collected;

      const res = await fetch(
        buildTmdbUrl('/discover/movie', {
          api_key: apiKey,
          ...tierPlan.params,
          page,
        }),
        { cache: 'no-store' }
      );

      if (!res.ok) break; // give up on this tier, move to the next
      const data = await res.json();
      const results: TmdbDiscoverResult[] = data.results ?? [];
      if (results.length === 0) break;

      for (const result of results) {
        if (!result?.id || seen.has(result.id)) continue;
        seen.add(result.id);
        collected.push({ tmdbId: result.id, tier: tierPlan.tier });
        if (collected.length >= target) return collected;
      }

      const totalPages = typeof data.total_pages === 'number' ? data.total_pages : page;
      if (page >= totalPages) break;
    }
  }

  return collected;
}

export async function hydrateMovie(
  apiKey: string,
  tmdbId: number,
  tier: SourceTier
): Promise<CachedMovie | null> {
  const res = await fetch(
    buildTmdbUrl(`/movie/${tmdbId}`, {
      api_key: apiKey,
      append_to_response: 'credits',
      language: 'en-US',
    }),
    { cache: 'no-store' }
  );

  if (!res.ok) return null;
  const detail = await res.json();

  const director =
    (detail.credits?.crew ?? []).find((c: { job: string; name: string }) => c.job === 'Director')?.name ??
    'Unknown Director';

  const genre =
    (detail.genres ?? []).map((g: { name: string }) => g.name).join(', ') || 'Unknown Genre';

  const year = detail.release_date ? parseInt(String(detail.release_date).split('-')[0], 10) : 0;
  const posterUrl = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : undefined;
  const topActors = (detail.credits?.cast ?? [])
    .filter((actor: { name?: string }) => typeof actor.name === 'string' && actor.name.trim().length > 0)
    .slice(0, 3)
    .map((actor: { name: string }) => actor.name);

  return {
    tmdbId: Number(detail.id),
    title: detail.title as string,
    year,
    director,
    genre,
    synopsis: (detail.overview as string) ?? '',
    posterUrl,
    topActors,
    releaseDate: detail.release_date ?? undefined,
    popularity: typeof detail.popularity === 'number' ? detail.popularity : undefined,
    voteAverage: typeof detail.vote_average === 'number' ? detail.vote_average : undefined,
    voteCount: typeof detail.vote_count === 'number' ? detail.vote_count : undefined,
    originalLanguage: detail.original_language ?? undefined,
    sourceTier: tier,
  };
}

/** Hydrates TMDB details in bounded-concurrency slices to avoid a request storm. */
export async function hydrateMoviesInChunks(
  apiKey: string,
  items: Array<{ tmdbId: number; tier: SourceTier }>,
  chunkSize = 8
): Promise<CachedMovie[]> {
  const hydrated: CachedMovie[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    const results = await Promise.all(slice.map((item) => hydrateMovie(apiKey, item.tmdbId, item.tier)));
    for (const movie of results) {
      if (movie) hydrated.push(movie);
    }
  }
  return hydrated;
}
