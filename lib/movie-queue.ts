import { createAdminClient } from '@/lib/supabase/admin';
import type { CachedMovie, QueuedMovie, SourceTier } from '@/types/queue';
import type { Database } from '@/types/supabase';

const QUEUE_TARGET_SIZE = 60;
const QUEUE_LOW_WATERMARK = 15;
const DELIVER_BATCH_SIZE = 20;

type QueueRow = Database['public']['Tables']['user_movie_queue']['Row'];
type CacheRow = Database['public']['Tables']['movies_cache']['Row'];
type QueueRowWithMovie = Pick<QueueRow, 'id' | 'tmdb_movie_id' | 'queue_rank' | 'source_tier'> & {
  movies_cache?: CacheRow | null;
};

function mapCacheRow(row: CacheRow): CachedMovie {
  return {
    tmdbId: row.tmdb_movie_id,
    title: row.title,
    year: row.year ?? 0,
    director: row.director ?? 'Unknown Director',
    genre: row.genre ?? 'Unknown Genre',
    synopsis: row.synopsis ?? '',
    posterUrl: row.poster_url ?? undefined,
    topActors: row.top_actors ?? [],
    releaseDate: row.release_date ?? undefined,
    popularity: row.popularity ?? undefined,
    voteAverage: row.vote_average ?? undefined,
    voteCount: row.vote_count ?? undefined,
    originalLanguage: row.original_language ?? undefined,
    sourceTier: (row.source_tier as SourceTier | null) ?? undefined,
    trailerKey: row.trailer_key ?? undefined,
  };
}

export function getQueueConfig() {
  return {
    targetSize: QUEUE_TARGET_SIZE,
    lowWatermark: QUEUE_LOW_WATERMARK,
    deliverBatchSize: DELIVER_BATCH_SIZE,
  };
}

export async function getCachedMoviesByIds(tmdbIds: number[]): Promise<Map<number, CachedMovie>> {
  const supabase = createAdminClient();
  const cache = new Map<number, CachedMovie>();
  if (!supabase || tmdbIds.length === 0) return cache;

  const { data, error } = await supabase
    .from('movies_cache')
    .select('*')
    .in('tmdb_movie_id', tmdbIds);

  if (error || !data) return cache;

  for (const row of data) {
    cache.set(row.tmdb_movie_id, mapCacheRow(row));
  }

  return cache;
}

export async function upsertMoviesCache(movies: CachedMovie[]): Promise<void> {
  const supabase = createAdminClient();
  if (!supabase || movies.length === 0) return;

  const payload = movies.map((movie) => ({
    tmdb_movie_id: movie.tmdbId,
    title: movie.title,
    year: movie.year || null,
    director: movie.director || null,
    genre: movie.genre || null,
    synopsis: movie.synopsis || null,
    poster_url: movie.posterUrl || null,
    top_actors: movie.topActors ?? [],
    release_date: movie.releaseDate || null,
    popularity: movie.popularity ?? null,
    vote_average: movie.voteAverage ?? null,
    vote_count: movie.voteCount ?? null,
    original_language: movie.originalLanguage ?? null,
    source_tier: movie.sourceTier ?? null,
    trailer_key: movie.trailerKey ?? null,
    cached_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  await supabase.from('movies_cache').upsert(payload, { onConflict: 'tmdb_movie_id' });
}

export async function getActiveQueueForUser(userId: string, limit = DELIVER_BATCH_SIZE): Promise<QueuedMovie[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('user_movie_queue')
    .select('id, queue_rank, source_tier, tmdb_movie_id, movies_cache(*)')
    .eq('user_id', userId)
    .is('consumed_at', null)
    .is('discarded_at', null)
    .order('queue_rank', { ascending: true })
    .limit(limit);

  if (error || !data) return [];

  return data
    .map((row: QueueRowWithMovie) => {
      if (!row.movies_cache) return null;
      const movie = mapCacheRow(row.movies_cache);
      return {
        ...movie,
        queueId: row.id,
        queueRank: Number(row.queue_rank),
        sourceTier: (row.source_tier as SourceTier | null) ?? movie.sourceTier,
      } satisfies QueuedMovie;
    })
    .filter(Boolean) as QueuedMovie[];
}

export async function getQueueState(userId: string): Promise<{ activeCount: number; highestRank: number }> {
  const supabase = createAdminClient();
  if (!supabase) return { activeCount: 0, highestRank: 0 };

  const [{ count, error: countError }, { data, error: rankError }] = await Promise.all([
    supabase
      .from('user_movie_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('consumed_at', null)
      .is('discarded_at', null),
    supabase
      .from('user_movie_queue')
      .select('queue_rank')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .is('discarded_at', null)
      .order('queue_rank', { ascending: false })
      .limit(1),
  ]);

  if (countError || rankError) return { activeCount: 0, highestRank: 0 };

  return {
    activeCount: count ?? 0,
    highestRank: data?.[0]?.queue_rank ? Number(data[0].queue_rank) : 0,
  };
}
