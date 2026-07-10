/**
 * Filmmoo — Main swipe interface page.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Film } from 'lucide-react';
import { getMovieRecommendation, saveSwipe } from '@/actions/movies';
import { getQueuedMovies, refillQueuedMovies } from '@/actions/queue';
import { getCurrentUserProfile, getSwipeHistory } from '@/actions/library';
import { getWatchlistItems, isMovieInWatchlist, setWatchlistItem } from '@/actions/watchlist';
import { AppHeader } from '@/components/app-header';
import { ErrorBanner } from '@/components/error-banner';
import { HistoryPanel } from '@/components/history-panel';
import { MovieDetailCard } from '@/components/movie-detail-card';
import { ProfilePanel } from '@/components/profile-panel';
import { SwipeCard } from '@/components/swipe-card';
import { SwipeControls } from '@/components/swipe-controls';
import { WatchlistPanel } from '@/components/watchlist-panel';
import type { HistoryItem, MovieDetail, ProfileDetails, WatchlistItem } from '@/types/library';
import type { Movie, SwipeAction, SwipedMovie, Recommendation } from '@/types/movie';
import type { ActionFailure } from '@/types/actions';

const LOADING_MESSAGES = [
  'Popping the popcorn...',
  'Waking up the projectionist...',
  'Splicing film reels...',
  'Dimming the lights...',
  'Finding the perfect seat...',
  'Rolling the credits...',
  'Shushing the people in the back row...',
  'Sweeping up the virtual spilled popcorn...',
  'Silencing all cell phones...',
  'Checking the floor for sticky spots...',
  'Buying a $14 small soda...',
  'Scrolling past the 20 minutes of trailers...',
  'Developing the negatives...',
  'Color grading the highlights...',
  'Syncing the foley tracks...',
  'Waiting for the Director’s Cut...',
  'Rendering the CGI explosions...',
  'Casting the lead roles...',
  'Consulting the Rotten Tomatoes...',
  'Polishing the Academy Awards...',
  'Bribing the critics for a 5-star review...',
  'Analyzing your cinematic DNA...',
  'Debating the ending of Inception...',
  'Practicing our Oscar acceptance speech...',
  'Cueing the jump scare...',
  'Fueling up the getaway car...',
  'Enhancing the security footage...',
  'Loading the dramatic plot twist...',
  'Training the montage sequence...',
  'Locking the basement door...',
  'Waiting for the rain to start for the big kiss...',
  'Coming up with cheesy dialogue...',
  'Doing reshoots...',
  'Editing the trailer...',
  'Adding the final credits...',
  'Adding post credit scenes...',
  'Deciding when to launch on streaming...',
  'Spending too much on marketing...',
];

type View = 'swipe' | 'recommendation' | 'watchlist' | 'history' | 'profile';
type DetailContext = 'watchlist' | 'history';

type SelectedDetail = {
  movie: MovieDetail;
  context: DetailContext;
};

function getRandomGradient() {
  const colors = [
    ['#141E30', '#243B55'],
    ['#0F2027', '#203A43', '#2C5364'],
    ['#2C3E50', '#3498DB'],
    ['#4B79A1', '#283E51'],
    ['#1D2B64', '#F8CDDA'],
    ['#1A2980', '#26D0CE'],
    ['#3A1C71', '#D76D77', '#FFAF7B'],
    ['#000000', '#434343'],
    ['#333333', '#dd1818'],
    ['#0f0c29', '#302b63', '#24243e'],
  ];

  const selected = colors[Math.floor(Math.random() * colors.length)];
  if (selected.length === 2) return `linear-gradient(to bottom right, ${selected[0]}, ${selected[1]})`;
  return `linear-gradient(to bottom right, ${selected[0]}, ${selected[1]}, ${selected[2]})`;
}

function recommendationToDetail(recommendation: Recommendation): MovieDetail {
  return {
    tmdbId: recommendation.tmdbId ?? 0,
    title: recommendation.title,
    year: recommendation.year,
    director: recommendation.director,
    genre: recommendation.genre,
    synopsis: recommendation.synopsis,
    posterUrl: recommendation.posterUrl,
    recommendationReason: recommendation.reason,
    source: 'recommendation',
  };
}

function detailToMovie(detail: MovieDetail): Movie {
  return {
    cardId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
    tmdbId: detail.tmdbId,
    title: detail.title,
    year: detail.year,
    director: detail.director,
    genre: detail.genre,
    synopsis: detail.synopsis,
    posterUrl: detail.posterUrl,
    gradient: getRandomGradient(),
  };
}

export default function Filmmoo() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<View>('swipe');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipedMovies, setSwipedMovies] = useState<SwipedMovie[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<ProfileDetails | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState<string | null>(null);
  const [isLoadingLibraryView, setIsLoadingLibraryView] = useState(false);

  const watchlistTimerRef = useRef<NodeJS.Timeout | null>(null);
  const errorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isAnimating = useRef(false);
  const lastPrefetchAtRef = useRef(0);
  const exhaustedDeckRef = useRef(false);

  const showError = useCallback((message: string) => {
    setErrorMessage(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  /**
   * Central handler for a failed ActionResult: bounce to /login on an auth
   * failure, otherwise surface the server-provided (safe) message. The
   * rate_limited message already embeds retryAfter.
   */
  const reportFailure = useCallback((failure: ActionFailure) => {
    if (failure.code === 'unauthorized') {
      router.push('/login');
      return;
    }
    showError(failure.message);
  }, [router, showError]);

  const refreshWatchlist = useCallback(async () => {
    const result = await getWatchlistItems();
    if (result.ok) setWatchlistItems(result.data);
    else reportFailure(result);
  }, [reportFailure]);

  const refreshHistory = useCallback(async () => {
    const result = await getSwipeHistory();
    if (result.ok) setHistoryItems(result.data);
    else reportFailure(result);
  }, [reportFailure]);

  const refreshProfile = useCallback(async () => {
    const result = await getCurrentUserProfile();
    if (result.ok) setProfile(result.data);
    else reportFailure(result);
  }, [reportFailure]);

  const refreshLibraryData = useCallback(async () => {
    await Promise.all([refreshWatchlist(), refreshHistory(), refreshProfile()]);
  }, [refreshWatchlist, refreshHistory, refreshProfile]);

  const fetchMoreMovies = useCallback(async (forceRefill = false) => {
    setIsFetching(true);
    try {
      const result = forceRefill ? await refillQueuedMovies() : await getQueuedMovies();
      if (!result.ok) {
        // Stop the prefetch loop when rate-limited so we don't hammer a
        // limited endpoint every cooldown window indefinitely.
        if (result.code === 'rate_limited') {
          exhaustedDeckRef.current = true;
        }
        reportFailure(result);
        return;
      }
      const rawMovies = result.data;
      exhaustedDeckRef.current = rawMovies.length === 0;
      const existingIds = new Set(movies.slice(currentIndex).map((movie) => movie.tmdbId));
      const deduped = rawMovies.filter((movie) => !existingIds.has(movie.tmdbId));
      const newMovies: Movie[] = deduped.map((movie) => ({
        ...movie,
        cardId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        gradient: getRandomGradient(),
      }));
      if (newMovies.length === 0) {
        exhaustedDeckRef.current = true;
      }
      setMovies((prev) => [...prev, ...newMovies]);
    } catch {
      showError('Failed to load movies. Please try again.');
    } finally {
      setIsFetching(false);
    }
  }, [currentIndex, movies, reportFailure, showError]);

  useEffect(() => {
    exhaustedDeckRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates happen after an await inside these async functions, not synchronously in the effect body
    void fetchMoreMovies();
    void refreshLibraryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const remainingCards = movies.length - currentIndex;
    const shouldPrefetch = movies.length > 0 && remainingCards <= 5;
    const now = Date.now();
    const cooldownMs = 15_000;

    if (!shouldPrefetch || isFetching || exhaustedDeckRef.current) {
      return;
    }

    if (now - lastPrefetchAtRef.current < cooldownMs) {
      return;
    }

    lastPrefetchAtRef.current = now;
    void fetchMoreMovies();
  }, [currentIndex, movies, isFetching, fetchMoreMovies]);

  useEffect(() => {
    isAnimating.current = false;
  }, [currentIndex]);

  useEffect(() => () => {
    if (watchlistTimerRef.current) clearTimeout(watchlistTimerRef.current);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, []);

  const syncWatchlistStateForMovie = useCallback(async (tmdbId: number | undefined) => {
    if (!tmdbId || tmdbId <= 0) {
      setIsInWatchlist(false);
      return;
    }

    try {
      const result = await isMovieInWatchlist(tmdbId);
      setIsInWatchlist(result.ok ? result.data : false);
    } catch {
      setIsInWatchlist(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'recommendation' && recommendation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates happen after an await inside syncWatchlistStateForMovie, not synchronously in the effect body
      void syncWatchlistStateForMovie(recommendation.tmdbId);
    }
  }, [activeView, recommendation, syncWatchlistStateForMovie]);

  useEffect(() => {
    if (selectedDetail) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates happen after an await inside syncWatchlistStateForMovie, not synchronously in the effect body
      void syncWatchlistStateForMovie(selectedDetail.movie.tmdbId);
    }
  }, [selectedDetail, syncWatchlistStateForMovie]);

  const persistSwipe = useCallback((movie: MovieDetail, action: SwipeAction) => {
    void saveSwipe(movie, action)
      .then((result) => {
        if (!result.ok) reportFailure(result);
      })
      .catch(() => {
        showError('Failed to save your swipe.');
      });
  }, [reportFailure, showError]);

  const handleSwipe = useCallback((action: SwipeAction, movie: Movie) => {
    persistSwipe({
      tmdbId: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      director: movie.director,
      genre: movie.genre,
      synopsis: movie.synopsis,
      posterUrl: movie.posterUrl,
      source: 'swipe',
    }, action);
    setSwipedMovies((prev) => [...prev, { ...movie, action }]);
    setCurrentIndex((prev) => prev + 1);
  }, [persistSwipe]);

  const handleUndo = useCallback(() => {
    if (currentIndex <= 0) return;
    setCurrentIndex((prev) => prev - 1);
    setSwipedMovies((prev) => prev.slice(0, -1));
  }, [currentIndex]);

  const requestRecommendation = useCallback(async () => {
    // Local pre-check is only a UX shortcut; the authoritative taste profile is
    // built server-side from persisted swipe state. Allow the request when the
    // user has rated something this session OR has persisted history.
    const hasRatedThisSession = swipedMovies.some((movie) => movie.action !== 'unwatched');
    if (!hasRatedThisSession && historyItems.length === 0) {
      showError('Please rate at least one movie (Watched, Loved, or Disliked) to get a recommendation.');
      return;
    }

    setIsRecommending(true);
    setLoadingMessageIndex(Math.floor(Math.random() * LOADING_MESSAGES.length));

    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => {
        let next = Math.floor(Math.random() * LOADING_MESSAGES.length);
        while (next === prev) next = Math.floor(Math.random() * LOADING_MESSAGES.length);
        return next;
      });
    }, 2000);

    try {
      const result = await getMovieRecommendation();
      if (!result.ok) {
        reportFailure(result);
      } else if (result.data) {
        setRecommendation(result.data);
        setActiveView('recommendation');
      } else {
        showError('No recommendation available right now. Please try again.');
      }
    } catch {
      showError('Failed to get recommendation. Please try again.');
    } finally {
      clearInterval(interval);
      setIsRecommending(false);
    }
  }, [historyItems, reportFailure, showError, swipedMovies]);

  const handleRecommendationRating = useCallback(async (action: Exclude<SwipeAction, 'unwatched'>) => {
    if (!recommendation) return;

    const detail = recommendationToDetail(recommendation);
    persistSwipe(detail, action);

    const movie = detailToMovie(detail);
    setSwipedMovies((prev) => [...prev, { ...movie, action }]);
    setRecommendation(null);
    setIsInWatchlist(false);
    setWatchlistMessage(null);
    setSelectedDetail(null);
    setIsRecommending(true);
    try {
      await Promise.all([refreshWatchlist(), refreshHistory()]);
    } catch {
      // Non-blocking refresh; recommendation flow should still continue.
    }
    await requestRecommendation();
  }, [persistSwipe, recommendation, refreshHistory, refreshWatchlist, requestRecommendation]);

  const toggleWatchlistForMovie = useCallback(async (movie: MovieDetail) => {
    if (!movie.tmdbId || movie.tmdbId <= 0) {
      showError('Could not save this movie because TMDB metadata is missing.');
      return false;
    }

    const adding = !isInWatchlist;
    setIsInWatchlist(adding);
    setWatchlistMessage(adding ? `${movie.title} added to your watchlist` : 'Removed from watchlist');

    if (watchlistTimerRef.current) clearTimeout(watchlistTimerRef.current);
    watchlistTimerRef.current = setTimeout(() => setWatchlistMessage(null), 2000);

    try {
      const result = await setWatchlistItem(movie, adding);
      if (!result.ok) {
        setIsInWatchlist(!adding);
        reportFailure(result);
        return !adding;
      }
      setIsInWatchlist(result.data.inWatchlist);
      await refreshWatchlist();
      return result.data.inWatchlist;
    } catch {
      setIsInWatchlist(!adding);
      showError('Failed to update watchlist.');
      return !adding;
    }
  }, [isInWatchlist, refreshWatchlist, reportFailure, showError]);

  const handleWatchlistRate = useCallback(async (action: Exclude<SwipeAction, 'unwatched'>) => {
    if (!selectedDetail || selectedDetail.context !== 'watchlist') return;
    const movie = selectedDetail.movie;
    persistSwipe({ ...movie, source: movie.source ?? 'watchlist' }, action);
    const removeResult = await setWatchlistItem(movie, false);
    if (!removeResult.ok) reportFailure(removeResult);
    try {
      await Promise.all([refreshWatchlist(), refreshHistory()]);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to refresh your library.');
    }
    setSelectedDetail(null);
    setActiveView('history');
  }, [persistSwipe, refreshHistory, refreshWatchlist, reportFailure, selectedDetail, showError]);

  const loadViewData = useCallback((view: View) => {
    if (view === 'watchlist') {
      setIsLoadingLibraryView(true);
      void refreshWatchlist()
        .catch((error) => {
          showError(error instanceof Error ? error.message : 'Failed to load your watchlist.');
        })
        .finally(() => setIsLoadingLibraryView(false));
      return;
    }

    if (view === 'history') {
      setIsLoadingLibraryView(true);
      void refreshHistory()
        .catch((error) => {
          showError(error instanceof Error ? error.message : 'Failed to load your history.');
        })
        .finally(() => setIsLoadingLibraryView(false));
      return;
    }

    if (view === 'profile') {
      setIsLoadingLibraryView(true);
      void refreshProfile()
        .catch((error) => {
          showError(error instanceof Error ? error.message : 'Failed to load your profile.');
        })
        .finally(() => setIsLoadingLibraryView(false));
    }
  }, [refreshHistory, refreshProfile, refreshWatchlist, showError]);

  const handleChangeView = useCallback((view: View) => {
    setSelectedDetail(null);
    setActiveView(view);
    loadViewData(view);
  }, [loadViewData]);

  const visibleMovies = movies.slice(currentIndex, currentIndex + 3);
  const reversedVisible = [...visibleMovies].reverse();
  const recommendationDetail = recommendation ? recommendationToDetail(recommendation) : null;

  if (isRecommending && !recommendation) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white p-6 flex flex-col items-center justify-center">
        <ErrorBanner message={errorMessage} />
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center p-8 text-center">
          <div className="relative mb-8">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="text-pink-500">
              <Film size={64} />
            </motion.div>
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="w-2 h-2 rounded-full bg-white/50" />
            </div>
          </div>
          <h2 className="text-2xl font-serif font-bold tracking-wide mb-2">Director&apos;s Cut</h2>
          <AnimatePresence mode="wait">
            <motion.p key={loadingMessageIndex} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="text-white/60 font-mono text-sm">
              {LOADING_MESSAGES[loadingMessageIndex]}
            </motion.p>
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col overflow-hidden font-sans">
      <ErrorBanner message={errorMessage} />
      <AppHeader
        activeView={activeView}
        onChangeView={(view) => void handleChangeView(view)}
        onRecommend={() => void requestRecommendation()}
        isRecommending={isRecommending}
        canRecommend={swipedMovies.length > 0 || historyItems.length > 0}
      />

      {selectedDetail ? (
        <MovieDetailCard
          movie={selectedDetail.movie}
          title={undefined}
          subtitle={selectedDetail.context === 'watchlist' ? 'Saved from your recommendations' : undefined}
          isInWatchlist={isInWatchlist}
          watchlistMessage={watchlistMessage}
          onToggleWatchlist={selectedDetail.context === 'watchlist' ? () => void toggleWatchlistForMovie(selectedDetail.movie) : undefined}
          onRate={selectedDetail.context === 'watchlist' ? (action) => void handleWatchlistRate(action) : undefined}
          showRatingActions={selectedDetail.context === 'watchlist'}
          onBack={() => {
            setSelectedDetail(null);
            setActiveView(selectedDetail.context);
          }}
          backLabel={selectedDetail.context === 'watchlist' ? 'Back to watchlist' : 'Back to history'}
        />
      ) : activeView === 'recommendation' && recommendationDetail ? (
        <MovieDetailCard
          movie={recommendationDetail}
          title={undefined}
          subtitle={undefined}
          isInWatchlist={isInWatchlist}
          watchlistMessage={watchlistMessage}
          onToggleWatchlist={() => void toggleWatchlistForMovie(recommendationDetail)}
          onRate={(action) => void handleRecommendationRating(action)}
          onBack={() => {
            setActiveView('swipe');
            setRecommendation(null);
          }}
          backLabel="Keep Swiping"
        />
      ) : activeView === 'watchlist' ? (
        <main className="flex-1 relative flex flex-col items-center justify-center px-6 pb-6 pt-0">
          {isLoadingLibraryView && watchlistItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-white/50">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p className="font-mono text-sm">Loading watchlist...</p>
            </div>
          ) : (
            <WatchlistPanel items={watchlistItems} onOpen={(item) => setSelectedDetail({ movie: item, context: 'watchlist' })} />
          )}
        </main>
      ) : activeView === 'history' ? (
        <main className="flex-1 relative flex flex-col items-center justify-center px-6 pb-6 pt-0">
          {isLoadingLibraryView && historyItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-white/50">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p className="font-mono text-sm">Loading history...</p>
            </div>
          ) : (
            <HistoryPanel items={historyItems} onOpen={(item) => setSelectedDetail({ movie: item, context: 'history' })} />
          )}
        </main>
      ) : activeView === 'profile' ? (
        <main className="flex-1 relative flex flex-col items-center justify-center px-6 pb-6 pt-0">
          {isLoadingLibraryView && !profile ? (
            <div className="flex flex-col items-center justify-center text-white/50">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p className="font-mono text-sm">Loading profile...</p>
            </div>
          ) : (
            <ProfilePanel key={`${profile?.email ?? ''}:${profile?.name ?? ''}`} profile={profile} />
          )}
        </main>
      ) : (
        <>
          <main className="flex-1 relative flex flex-col items-center justify-center px-6 pb-6 pt-0">
            <div className="relative w-full max-w-sm aspect-[2/3]">
              {movies.length === 0 && isFetching ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                  <Loader2 className="animate-spin mb-4" size={32} />
                  <p className="font-mono text-sm">Finding movies...</p>
                </div>
              ) : reversedVisible.length > 0 ? (
                <AnimatePresence>
                  {reversedVisible.map((movie) => {
                    const isTop = movie.cardId === visibleMovies[0].cardId;
                    const index = visibleMovies.findIndex((candidate) => candidate.cardId === movie.cardId);
                    return (
                      <SwipeCard
                        key={movie.cardId}
                        movie={movie}
                        index={index}
                        isTop={isTop}
                        onSwipeStart={() => {
                          isAnimating.current = true;
                        }}
                        onSwipe={handleSwipe}
                        onUndo={handleUndo}
                        canUndo={currentIndex > 0}
                      />
                    );
                  })}
                </AnimatePresence>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 text-center px-6">
                  <p className="font-mono text-sm mb-3">No movies loaded.</p>
                  <button
                    onClick={() => void fetchMoreMovies(true)}
                    className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-sm border border-white/10"
                  >
                    Reload movies
                  </button>
                </div>
              )}
            </div>

            <SwipeControls
              onAction={(action) => {
                if (isAnimating.current) return;
                if (visibleMovies.length === 0) return;
                isAnimating.current = true;
                handleSwipe(action, visibleMovies[0]);
              }}
            />
          </main>

          <div className="p-6 text-center text-white/30 text-xs font-mono z-10 flex flex-col gap-2">
            <div className="flex justify-center gap-4">
              <span>← Unwatched</span>
              <span>→ Watched</span>
            </div>
            <div className="flex justify-center gap-4">
              <span>↑ Loved</span>
              <span>↓ Disliked</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
