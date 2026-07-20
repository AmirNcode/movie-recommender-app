import type { MovieCandidate } from '@/types/movie';

export type SourceTier = 'mainstream' | 'broader-mainstream' | 'niche';

export type CachedMovie = MovieCandidate & {
  topActors: string[];
  releaseDate?: string;
  popularity?: number;
  voteAverage?: number;
  voteCount?: number;
  originalLanguage?: string;
  sourceTier?: SourceTier;
  trailerKey?: string;
};

export type QueuedMovie = MovieCandidate & {
  queueId: string;
  queueRank: number;
  sourceTier?: SourceTier;
};
