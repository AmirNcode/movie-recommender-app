/**
 * Server-side taste profile shared by the recommendation engines (S5/S11) and
 * Cinema DNA (S16). Built from persisted swipe state so it survives page
 * reloads and cannot be spoofed or bloated by the client.
 */
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCachedMoviesByIds } from '@/lib/movie-queue';
import { sanitiseForPrompt } from '@/lib/sanitise';

/** Minimal movie metadata used to describe the user's taste to the model. */
export type TasteEntry = {
  tmdbId: number;
  title: string;
  year: number;
  director: string;
  genre: string;
};

/** Server-built taste profile, partitioned by the user's latest action. */
export type TasteProfile = {
  loved: TasteEntry[];
  watched: TasteEntry[];
  disliked: TasteEntry[];
  unwatched: TasteEntry[];
  /** Titles to exclude from the recommendation (most-recent 60 seen). */
  seenTitles: string[];
};

/**
 * Builds a rich metadata string for a taste entry to give Gemini context
 * beyond just the title (genre, director, year). Every DB-sourced string is
 * run through sanitiseForPrompt (titles/synopses originated from client/TMDB).
 */
export function tasteLabel(entry: TasteEntry): string {
  const parts = [sanitiseForPrompt(entry.title)];
  if (entry.year) parts.push(`(${entry.year})`);
  if (entry.director && entry.director !== 'Unknown Director') {
    parts.push(`dir. ${sanitiseForPrompt(entry.director)}`);
  }
  if (entry.genre) parts.push(`[${sanitiseForPrompt(entry.genre)}]`);
  return parts.join(' ');
}

/** The four taste-profile list sections shared by prompt builders. */
export function tasteSectionsText(profile: TasteProfile): string {
  return `LOVED (highly rated by user):
${profile.loved.length ? profile.loved.map(tasteLabel).join('\n') : 'None yet'}

WATCHED AND LIKED (neutral positive):
${profile.watched.length ? profile.watched.map(tasteLabel).join('\n') : 'None yet'}

DISLIKED:
${profile.disliked.length ? profile.disliked.map(tasteLabel).join('\n') : 'None yet'}

HAVEN'T WATCHED (swiped past):
${profile.unwatched.length ? profile.unwatched.map(tasteLabel).join('\n') : 'None yet'}`;
}

/**
 * Builds the user's taste profile server-side from persisted swipe state.
 *
 * Metadata for each rated movie is hydrated from movies_cache first, then
 * falls back to the most-recent swipe_events row (covers recommendation-
 * sourced swipes that never entered the discovery cache). Reads use the
 * user-scoped client so RLS restricts rows to the caller.
 */
export async function buildTasteProfile(userId: string): Promise<TasteProfile> {
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
          tmdbId: id,
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
          tmdbId: row.tmdb_movie_id,
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
