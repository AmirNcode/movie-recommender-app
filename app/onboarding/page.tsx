'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Check, Eye, Heart, Loader2, ThumbsDown } from 'lucide-react';
import { getOnboardingMovies, hasSwipeStates } from '@/actions/onboarding';
import { saveSwipe } from '@/actions/movies';
import type { MovieCandidate, SwipeAction } from '@/types/movie';

type RatingState = Exclude<SwipeAction, 'unwatched'> | null;

const NEXT_RATING: Record<Exclude<RatingState, null> | 'none', RatingState> = {
  none: 'loved',
  loved: 'watched',
  watched: 'disliked',
  disliked: null,
};

const RATING_META: Record<Exclude<RatingState, null>, { label: string; className: string; icon: ReactNode }> = {
  loved: {
    label: 'Loved',
    className: 'bg-pink-500 text-white',
    icon: <Heart size={14} />,
  },
  watched: {
    label: 'Watched',
    className: 'bg-green-500 text-white',
    icon: <Eye size={14} />,
  },
  disliked: {
    label: 'Disliked',
    className: 'bg-orange-500 text-white',
    icon: <ThumbsDown size={14} />,
  },
};

function isTrustedPosterUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.startsWith('https://image.tmdb.org/');
}

export default function OnboardingPage() {
  const router = useRouter();
  const [movies, setMovies] = useState<MovieCandidate[]>([]);
  const [ratings, setRatings] = useState<Record<number, RatingState>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const status = await hasSwipeStates();
      if (cancelled) return;
      if (!status.ok) {
        setError(status.message);
        setIsLoading(false);
        return;
      }
      if (status.data) {
        router.replace('/');
        return;
      }

      const result = await getOnboardingMovies();
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        setIsLoading(false);
        return;
      }

      setMovies(result.data);
      setIsLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const ratedCount = useMemo(
    () => Object.values(ratings).filter(Boolean).length,
    [ratings]
  );

  const cycleRating = useCallback((tmdbId: number) => {
    setRatings((current) => {
      const existing = current[tmdbId] ?? null;
      const next = NEXT_RATING[existing ?? 'none'];
      return { ...current, [tmdbId]: next };
    });
  }, []);

  const finish = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    const ratedMovies = movies
      .map((movie) => ({ movie, action: ratings[movie.tmdbId] ?? null }))
      .filter((entry): entry is { movie: MovieCandidate; action: Exclude<SwipeAction, 'unwatched'> } => Boolean(entry.action));

    const results = await Promise.all(
      ratedMovies.map(({ movie, action }) => saveSwipe({ ...movie, source: 'swipe' }, action))
    );
    const failure = results.find((result) => !result.ok);
    if (failure && !failure.ok) {
      setError(failure.message);
      setIsSaving(false);
      return;
    }

    window.location.assign('/');
  }, [movies, ratings]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] px-6 py-10 text-white">
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-white/55">
          <Loader2 className="animate-spin" size={32} />
          <p className="font-mono text-sm">Loading movies...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">Filmmoo setup</p>
            <h1 className="font-serif text-3xl font-bold leading-tight sm:text-4xl">Rate a few familiar movies</h1>
          </div>
          <div className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 font-mono text-xs text-white/55">
            {ratedCount}/12
          </div>
        </header>

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {movies.map((movie) => {
            const rating = ratings[movie.tmdbId] ?? null;
            const meta = rating ? RATING_META[rating] : null;
            return (
              <button
                key={movie.tmdbId}
                type="button"
                onClick={() => cycleRating(movie.tmdbId)}
                className="group relative aspect-[2/3] overflow-hidden rounded-lg border border-white/10 bg-white/5 text-left shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition-transform hover:-translate-y-0.5"
              >
                {isTrustedPosterUrl(movie.posterUrl) ? (
                  <Image
                    src={movie.posterUrl}
                    alt={`${movie.title} poster`}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 250px"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/5 text-white/20">
                    <Eye size={32} />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />
                {meta ? (
                  <div className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.className}`}>
                    {meta.icon}
                    {meta.label}
                  </div>
                ) : null}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <div className="line-clamp-2 text-sm font-bold leading-tight">{movie.title}</div>
                  <div className="mt-1 text-xs text-white/55">{movie.year}</div>
                </div>
              </button>
            );
          })}
        </section>

        <footer className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="h-12 flex-1 rounded-2xl border border-white/15 text-sm font-bold uppercase tracking-wide text-white/75 transition-colors hover:bg-white/10"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void finish()}
            disabled={isSaving}
            className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold uppercase tracking-wide text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
            Done
          </button>
        </footer>
      </div>
    </main>
  );
}
