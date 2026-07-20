/**
 * Filmmoo — Movie Night (S6): two users swipe a shared deck; the first movie
 * both mark "yes" flips both screens to a match. Realtime on `movie_nights`
 * drives the cross-device transitions (host waiting → active, either side →
 * matched), with a lightweight poll as a fallback.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Check, Clapperboard, Heart, Loader2, Users, X } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
  addMovieNightToWatchlists,
  createMovieNight,
  getMovieNight,
  joinMovieNight,
  voteMovieNight,
} from '@/actions/movie-night';
import { getWatchProviders } from '@/actions/movies';
import { SwipeCard } from '@/components/swipe-card';
import { WatchProvidersRow } from '@/components/watch-providers-row';
import { MOVIE_NIGHT_CODE_LENGTH } from '@/lib/movie-night';
import type { Movie, SwipeAction, WatchProviderData } from '@/types/movie';
import type { MovieNightCard, MovieNightStatus } from '@/types/movie-night';

type Phase = 'lobby' | 'waiting' | 'swiping' | 'done' | 'matched' | 'expired';

function getRandomGradient() {
  const colors = [
    ['#141E30', '#243B55'],
    ['#0F2027', '#203A43', '#2C5364'],
    ['#2C3E50', '#3498DB'],
    ['#1D2B64', '#F8CDDA'],
    ['#1A2980', '#26D0CE'],
    ['#3A1C71', '#D76D77', '#FFAF7B'],
    ['#0f0c29', '#302b63', '#24243e'],
  ];
  const selected = colors[Math.floor(Math.random() * colors.length)];
  return selected.length === 2
    ? `linear-gradient(to bottom right, ${selected[0]}, ${selected[1]})`
    : `linear-gradient(to bottom right, ${selected[0]}, ${selected[1]}, ${selected[2]})`;
}

function cardToMovie(card: MovieNightCard): Movie {
  return {
    cardId: `${card.tmdbId}`,
    tmdbId: card.tmdbId,
    title: card.title,
    year: card.year,
    director: card.director,
    genre: card.genre,
    synopsis: card.synopsis,
    posterUrl: card.posterUrl,
    gradient: getRandomGradient(),
  };
}

/** watched/loved → yes; unwatched/disliked → no (spec S6.4 binary mapping). */
function actionToLiked(action: SwipeAction): boolean {
  return action === 'watched' || action === 'loved';
}

export default function MovieNightPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [phase, setPhase] = useState<Phase>('lobby');
  const [nightId, setNightId] = useState<string | null>(null);
  const [code, setCode] = useState<string>('');
  const [joinInput, setJoinInput] = useState<string>('');
  const [cards, setCards] = useState<MovieNightCard[]>([]);
  const [index, setIndex] = useState<number>(0);
  const [matched, setMatched] = useState<MovieNightCard | null>(null);
  const [providers, setProviders] = useState<WatchProviderData | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [addedToWatchlists, setAddedToWatchlists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const phaseRef = useRef<Phase>('lobby');
  const cardsRef = useRef<MovieNightCard[]>([]);
  const nightIdRef = useRef<string | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => { nightIdRef.current = nightId; }, [nightId]);

  const goToMatch = useCallback(
    async (matchedTmdbId: number | null) => {
      const id = nightIdRef.current;
      let movie = cardsRef.current.find((c) => c.tmdbId === matchedTmdbId) ?? null;
      if (!movie && id) {
        const snapshot = await getMovieNight(id);
        if (snapshot.ok) {
          setCards(snapshot.data.cards);
          movie =
            snapshot.data.cards.find(
              (c) => c.tmdbId === (matchedTmdbId ?? snapshot.data.matchedTmdbId)
            ) ?? null;
        }
      }
      setMatched(movie);
      setPhase('matched');
    },
    []
  );

  const loadDeck = useCallback(async (id: string) => {
    const snapshot = await getMovieNight(id);
    if (!snapshot.ok) {
      setError(snapshot.message);
      return null;
    }
    setCards(snapshot.data.cards);
    return snapshot.data;
  }, []);

  const subscribe = useCallback(
    (id: string) => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      void supabase.auth.getSession().then(({ data }) => {
        if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);

        const channel = supabase
          .channel(`movie_night:${id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'movie_nights', filter: `id=eq.${id}` },
            (payload) => {
              const next = payload.new as { status: MovieNightStatus; matched_tmdb_id: number | null };
              if (next.status === 'matched') {
                void goToMatch(next.matched_tmdb_id);
              } else if (next.status === 'active' && phaseRef.current === 'waiting') {
                void loadDeck(id).then((snap) => {
                  if (snap) setPhase('swiping');
                });
              } else if (next.status === 'expired') {
                setPhase('expired');
              }
            }
          )
          .subscribe();

        channelRef.current = channel;
      });
    },
    [supabase, goToMatch, loadDeck]
  );

  // Fallback poll for the cross-device transitions while waiting on the partner,
  // in case a Realtime event is missed.
  useEffect(() => {
    if ((phase !== 'waiting' && phase !== 'done') || !nightId) return;
    const timer = setInterval(async () => {
      const snapshot = await getMovieNight(nightId);
      if (!snapshot.ok) return;
      if (snapshot.data.status === 'matched') {
        void goToMatch(snapshot.data.matchedTmdbId);
      } else if (snapshot.data.status === 'active' && phaseRef.current === 'waiting') {
        setCards(snapshot.data.cards);
        setPhase('swiping');
      } else if (snapshot.data.status === 'expired') {
        setPhase('expired');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [phase, nightId, goToMatch]);

  // Load providers for the matched movie (reuses the S1 "Where to watch" row).
  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      // Deferring the first setState past an await keeps it out of the effect's
      // synchronous body (matches movie-detail-card's provider loader).
      await Promise.resolve();
      if (cancelled) return;
      if (phase !== 'matched' || !matched?.tmdbId) return;

      setProvidersLoading(true);
      setProviders(null);
      try {
        const result = await getWatchProviders(matched.tmdbId);
        if (!cancelled) setProviders(result.ok ? result.data : null);
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    }

    void loadProviders();
    return () => { cancelled = true; };
  }, [phase, matched]);

  // Tear down the Realtime channel on unmount.
  useEffect(() => {
    return () => {
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
    };
  }, [supabase]);

  const handleCreate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createMovieNight();
      if (!result.ok) {
        if (result.code === 'unauthorized') { router.push('/login'); return; }
        setError(result.message);
        return;
      }
      setNightId(result.data.nightId);
      setCode(result.data.code);
      setPhase('waiting');
      subscribe(result.data.nightId);
    } finally {
      setBusy(false);
    }
  }, [router, subscribe]);

  const handleJoin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await joinMovieNight(joinInput);
      if (!result.ok) {
        if (result.code === 'unauthorized') { router.push('/login'); return; }
        setError(result.message);
        return;
      }
      setNightId(result.data.nightId);
      setCode(result.data.code);
      const snap = await loadDeck(result.data.nightId);
      subscribe(result.data.nightId);
      if (snap?.status === 'matched') {
        void goToMatch(snap.matchedTmdbId);
      } else {
        setPhase('swiping');
      }
    } finally {
      setBusy(false);
    }
  }, [joinInput, router, loadDeck, subscribe, goToMatch]);

  const vote = useCallback(
    async (liked: boolean) => {
      const id = nightIdRef.current;
      const current = cardsRef.current[index];
      if (!id || !current) return;

      // Advance optimistically; the vote persists in the background.
      const nextIndex = index + 1;
      setIndex(nextIndex);
      if (nextIndex >= cardsRef.current.length) setPhase('done');

      const result = await voteMovieNight(id, current.tmdbId, liked);
      if (result.ok && result.data.matched) {
        void goToMatch(result.data.matchedTmdbId);
      } else if (!result.ok && result.code === 'unauthorized') {
        router.push('/login');
      }
    },
    [index, goToMatch, router]
  );

  const handleSwipe = useCallback(
    (action: SwipeAction) => { void vote(actionToLiked(action)); },
    [vote]
  );

  const handleAddBoth = useCallback(async () => {
    const id = nightIdRef.current;
    if (!id) return;
    setBusy(true);
    try {
      const result = await addMovieNightToWatchlists(id);
      if (result.ok) setAddedToWatchlists(true);
      else setError(result.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const currentMovie = cards[index] ? cardToMovie(cards[index]) : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans">
      <header className="p-6 pb-4 flex items-center justify-between">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={18} />
          <span className="font-mono">Filmmoo</span>
        </button>
        <div className="flex items-center gap-2 text-white/80">
          <Users size={18} />
          <span className="font-serif font-bold tracking-tight">Movie Night</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-8" data-night-id={nightId ?? ''}>
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-4 w-full max-w-sm rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Lobby ── */}
        {phase === 'lobby' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-8">
            <div className="text-center">
              <Clapperboard className="mx-auto mb-4 text-pink-500" size={48} />
              <h1 className="text-2xl font-serif font-bold mb-2">Watch together</h1>
              <p className="text-white/50 text-sm">
                Swipe the same deck with a friend. The first movie you both want to watch wins.
              </p>
            </div>

            <button
              onClick={() => void handleCreate()}
              disabled={busy}
              className="w-full py-4 rounded-2xl bg-white text-black font-bold tracking-wide hover:bg-white/90 transition-colors disabled:opacity-60 uppercase text-sm flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              Start a Movie Night
            </button>

            <div className="w-full flex items-center gap-3 text-white/30 text-xs font-mono">
              <div className="h-px flex-1 bg-white/10" />
              OR JOIN
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="w-full flex flex-col gap-3">
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                placeholder="ENTER CODE"
                maxLength={MOVIE_NIGHT_CODE_LENGTH}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-4 text-center text-2xl font-mono tracking-[0.4em] uppercase placeholder:text-white/20 placeholder:tracking-normal placeholder:text-base focus:outline-none focus:border-white/30"
              />
              <button
                onClick={() => void handleJoin()}
                disabled={busy || joinInput.trim().length !== MOVIE_NIGHT_CODE_LENGTH}
                className="w-full py-4 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-bold tracking-wide uppercase text-sm flex items-center justify-center gap-2 border border-white/10"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : null}
                Join
              </button>
            </div>
          </div>
        )}

        {/* ── Host waiting for a guest ── */}
        {phase === 'waiting' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
            <p className="text-white/50 text-sm font-mono uppercase tracking-widest">Share this code</p>
            <div
              data-testid="night-code"
              className="text-6xl font-mono font-bold tracking-[0.3em] text-white bg-white/5 border border-white/10 rounded-2xl px-6 py-8 w-full"
            >
              {code}
            </div>
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Waiting for your partner to join…
            </div>
          </div>
        )}

        {/* ── Swiping the shared deck ── */}
        {phase === 'swiping' && currentMovie && (
          <div className="w-full max-w-sm flex flex-col items-center">
            <p className="mb-4 text-white/40 text-xs font-mono">
              {index + 1} / {cards.length} · swipe right / ♥ = yes
            </p>
            <div className="relative w-full aspect-[2/3]">
              <AnimatePresence>
                <SwipeCard
                  key={currentMovie.cardId}
                  movie={currentMovie}
                  index={0}
                  isTop
                  onSwipe={(action) => handleSwipe(action)}
                  onUndo={() => {}}
                  canUndo={false}
                />
              </AnimatePresence>
            </div>
            <div className="mt-8 flex items-center justify-center gap-6">
              <button
                onClick={() => void vote(false)}
                aria-label="Not tonight"
                className="w-16 h-16 rounded-full bg-white/5 text-white/70 flex items-center justify-center hover:bg-white/10 transition-colors border border-white/10"
              >
                <X size={28} />
              </button>
              <button
                onClick={() => void vote(true)}
                aria-label="Yes, watch it"
                className="w-16 h-16 rounded-full bg-pink-500/15 text-pink-400 flex items-center justify-center hover:bg-pink-500/25 transition-colors border border-pink-500/30"
              >
                <Heart size={28} />
              </button>
            </div>
          </div>
        )}

        {/* ── Voted the whole deck, waiting on the partner ── */}
        {phase === 'done' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
            <Loader2 size={28} className="animate-spin text-white/50" />
            <p className="text-white/60 text-sm">
              You&apos;ve voted on every movie. Waiting for a match with your partner…
            </p>
          </div>
        )}

        {/* ── Match! ── */}
        {phase === 'matched' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-5">
            <div className="text-center">
              <Heart className="mx-auto mb-2 text-pink-500" size={36} fill="currentColor" />
              <h1 className="text-2xl font-serif font-bold">It&apos;s a match!</h1>
              <p className="text-white/50 text-sm">You both want to watch this tonight.</p>
            </div>

            {matched ? (
              <>
                <div className="w-full rounded-3xl overflow-hidden border border-white/10 bg-white/5">
                  <div className="relative aspect-[2/3] w-full">
                    {matched.posterUrl && matched.posterUrl.startsWith('https://image.tmdb.org/') ? (
                      // eslint-disable-next-line @next/next/no-img-element -- simple poster, no layout metrics needed here
                      <img src={matched.posterUrl} alt={`${matched.title} poster`} className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Clapperboard size={48} className="text-white/20" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-5">
                      <h2 className="text-2xl font-serif font-bold leading-tight">{matched.title}</h2>
                      <p className="text-white/70 text-sm font-mono">{matched.year || ''} · {matched.genre}</p>
                    </div>
                  </div>
                </div>

                <div className="w-full">
                  <WatchProvidersRow providers={providers} isLoading={providersLoading} error={null} />
                </div>

                <button
                  onClick={() => void handleAddBoth()}
                  disabled={busy || addedToWatchlists}
                  className="w-full py-4 rounded-2xl bg-white text-black font-bold tracking-wide hover:bg-white/90 transition-colors disabled:opacity-60 uppercase text-sm flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 size={18} className="animate-spin" /> : addedToWatchlists ? <Check size={18} /> : null}
                  {addedToWatchlists ? 'Added to both watchlists' : 'Add to both watchlists'}
                </button>
              </>
            ) : (
              <Loader2 size={28} className="animate-spin text-white/50" />
            )}

            <button
              onClick={() => router.push('/')}
              className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors text-sm border border-white/10"
            >
              Back to Filmmoo
            </button>
          </div>
        )}

        {/* ── Expired ── */}
        {phase === 'expired' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
            <p className="text-white/60 text-sm">This movie night has expired.</p>
            <button
              onClick={() => { setPhase('lobby'); setError(null); setNightId(null); setCards([]); setIndex(0); }}
              className="px-6 py-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors text-sm border border-white/10"
            >
              Start over
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
