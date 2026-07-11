import type { SwipeAction } from '@/types/movie';

export type RecommendationSource = 'recommendation' | 'swipe' | 'watchlist' | 'history' | 'manual';

export type MovieDetail = {
  tmdbId: number;
  title: string;
  year: number;
  director: string;
  genre: string;
  synopsis: string;
  posterUrl?: string;
  recommendationReason?: string | null;
  source?: RecommendationSource | null;
};

export type WatchlistItem = MovieDetail & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type HistoryItem = MovieDetail & {
  id: string;
  action: Exclude<SwipeAction, 'unwatched'>;
  createdAt: string;
};

export type ProfileDetails = {
  email: string | null;
  name: string | null;
  digestOptIn: boolean;
};
