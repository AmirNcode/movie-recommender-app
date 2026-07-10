/**
 * Shared type definitions for movie data used across the Filmmoo app.
 *
 * These types are used by both the client-side swipe UI (app/page.tsx)
 * and the server-side AI calls (actions/movies.ts). Keeping them in a
 * shared file ensures consistency between what the server returns and
 * what the client expects.
 */

/** A movie card displayed in the swipe stack. */
export type Movie = {
    /** Client-only identifier generated for React rendering keys. */
    cardId: string;
    /** Canonical TMDB movie ID persisted to Supabase. */
    tmdbId: number;
    title: string;
    year: number;
    director: string;
    genre: string;
    synopsis: string;
    /** CSS gradient string used as the card's background. */
    gradient: string;
    /** Optional TMDB movie poster URL to display on the card. */
    posterUrl?: string;
};

/** Movie payload returned by server actions before client UI decoration. */
export type MovieCandidate = Omit<Movie, 'cardId' | 'gradient'>;

/** The four possible user actions when interacting with a movie card. */
export type SwipeAction = 'unwatched' | 'watched' | 'loved' | 'disliked';

/** A movie that the user has already swiped on, tagged with their action. */
export type SwipedMovie = Movie & {
    action: SwipeAction;
};

/** The AI-generated movie recommendation returned by the Gemini model. */
export type Recommendation = {
    title: string;
    year: number;
    director: string;
    genre: string;
    synopsis: string;
    /** A personalized explanation of why the user would enjoy this movie. */
    reason: string;
    /** Optional TMDB movie poster URL to display on the recommendation card. */
    posterUrl?: string;
    /** Optional TMDB movie ID used for watchlist and swipe persistence. */
    tmdbId?: number;
    /** Optional source tag to preserve lineage when reused elsewhere in the UI. */
    source?: 'recommendation';
};

/** A single TMDB/JustWatch watch-provider entry. */
export type WatchProvider = {
    provider_id: number;
    provider_name: string;
    logo_path: string | null;
};

/** Viewer-facing provider groups for one country/region. */
export type WatchProviderCountryData = {
    link?: string;
    flatrate?: WatchProvider[];
    rent?: WatchProvider[];
    buy?: WatchProvider[];
};

/** Normalized watch-provider action payload for the client UI. */
export type WatchProviderData = {
    country: string;
    link?: string;
    stream: WatchProvider[];
    rent: WatchProvider[];
    buy: WatchProvider[];
};

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Runtime type guard for the Recommendation type.
 *
 * TypeScript types are erased at runtime, so JSON.parse provides no safety.
 * This function validates that all required fields exist with the correct types
 * before the data is used by the UI. If it returns false, the caller should
 * treat the response as malformed and return null.
 *
 * @param data - The raw parsed JSON value (unknown at this point).
 * @returns True if the data satisfies the Recommendation interface.
 */
export function isValidRecommendation(data: unknown): data is Recommendation {
    if (typeof data !== 'object' || data === null) return false;

    const obj = data as Record<string, unknown>;

    // All required fields must be present with the correct type
    if (typeof obj.title !== 'string') return false;
    if (typeof obj.year !== 'number') return false;
    if (typeof obj.director !== 'string') return false;
    if (typeof obj.genre !== 'string') return false;
    if (typeof obj.synopsis !== 'string') return false;
    if (typeof obj.reason !== 'string') return false;

    // posterUrl is optional — must be either undefined or a string
    if (obj.posterUrl !== undefined && typeof obj.posterUrl !== 'string') return false;
    // tmdbId is optional — must be either undefined or a positive integer
    if (obj.tmdbId !== undefined) {
        if (typeof obj.tmdbId !== 'number') return false;
        if (!Number.isInteger(obj.tmdbId)) return false;
        if (obj.tmdbId <= 0) return false;
    }

    return true;
}
