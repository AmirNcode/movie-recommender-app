/** The 19 official TMDB movie genres (id + name), hardcoded — this list has
 * been stable for years and changing it requires a data migration anyway. */
export const TMDB_GENRES: { id: number; name: string }[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Science Fiction' },
  { id: 10770, name: 'TV Movie' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
];

const TMDB_GENRE_IDS = new Set(TMDB_GENRES.map((g) => g.id));
const TMDB_GENRE_NAMES_BY_ID = new Map(TMDB_GENRES.map((g) => [g.id, g.name]));

export function isValidGenreId(id: number): boolean {
  return TMDB_GENRE_IDS.has(id);
}

/** Maps genre ids to their TMDB names for matching against movies_cache.genre
 * (a comma-joined name string — see fill_queue_from_pool's p_genres filter). */
export function genreNamesForIds(ids: number[]): string[] {
  return ids.map((id) => TMDB_GENRE_NAMES_BY_ID.get(id)).filter((name): name is string => Boolean(name));
}
