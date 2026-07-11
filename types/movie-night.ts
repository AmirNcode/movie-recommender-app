/**
 * Shared types for Movie Night (S6) — the two-user match mode.
 */
import type { MovieCandidate } from '@/types/movie';

/** Lifecycle of a movie night. */
export type MovieNightStatus = 'waiting' | 'active' | 'matched' | 'expired';

/** One card in the shared deck: movie metadata plus its shared rank. */
export type MovieNightCard = MovieCandidate & { rank: number };

/** A newly created or joined night's identifiers. */
export type MovieNightHandle = {
  nightId: string;
  code: string;
  isHost: boolean;
};

/** Full client-facing snapshot of a night: state + the shared deck. */
export type MovieNightSnapshot = {
  status: MovieNightStatus;
  isHost: boolean;
  matchedTmdbId: number | null;
  cards: MovieNightCard[];
};

/** Result of casting a single vote. */
export type MovieNightVoteResult = {
  matched: boolean;
  matchedTmdbId: number | null;
};
