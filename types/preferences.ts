/** A user's deck filter preferences (S8). Decade/rating are Pro-gated (S14)
 * and always come back null until billing ships — see actions/preferences.ts. */
export type UserPreferences = {
  genres: number[];
  yearFrom: number | null;
  yearTo: number | null;
  minVote: number | null;
};
