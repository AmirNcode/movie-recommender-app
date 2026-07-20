import { createAdminClient } from '@/lib/supabase/admin';
import { genreNamesForIds } from '@/lib/tmdb-genres';

export type QueueFilterArgs = {
  yearFrom: number | null;
  yearTo: number | null;
  minVote: number | null;
  genres: string[] | null;
};

const EMPTY_FILTERS: QueueFilterArgs = { yearFrom: null, yearTo: null, minVote: null, genres: null };

/** Reads a user's S8 deck preferences and converts genre ids to the TMDB genre
 * names fill_queue_from_pool matches against movies_cache.genre. Admin-client
 * only — called from the background queue-fill path, not a user request. */
export async function getQueueFilterArgs(userId: string): Promise<QueueFilterArgs> {
  const supabase = createAdminClient();
  if (!supabase) return EMPTY_FILTERS;

  const { data, error } = await supabase
    .from('user_preferences')
    .select('genres, year_from, year_to, min_vote')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return EMPTY_FILTERS;

  const genreNames = genreNamesForIds(data.genres ?? []);

  return {
    yearFrom: data.year_from,
    yearTo: data.year_to,
    minVote: data.min_vote,
    genres: genreNames.length > 0 ? genreNames : null,
  };
}
