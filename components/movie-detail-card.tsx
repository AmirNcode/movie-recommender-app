'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Eye, Film, Heart, Loader2, Plus, Share2, ThumbsDown } from 'lucide-react';
import { getWatchProviders, shareRecommendation } from '@/actions/movies';
import type { MovieDetail } from '@/types/library';
import type { SwipeAction, WatchProvider, WatchProviderData } from '@/types/movie';

function isTrustedPosterUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.startsWith('https://image.tmdb.org/');
}

function providerLogoUrl(path: string | null): string | null {
  return path ? `https://image.tmdb.org/t/p/w45${path}` : null;
}

function ProviderLogo({ provider }: { provider: WatchProvider }) {
  const logoUrl = providerLogoUrl(provider.logo_path);
  if (!logoUrl) {
    return (
      <span className="flex h-7 min-w-7 items-center justify-center rounded bg-white/10 px-1.5 text-[9px] font-bold text-white/70">
        {provider.provider_name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <Image
      src={logoUrl}
      alt={provider.provider_name}
      width={28}
      height={28}
      className="h-7 w-7 rounded bg-white/10 object-cover"
    />
  );
}

function ProviderGroup({ label, providers }: { label: string; providers: WatchProvider[] }) {
  if (providers.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/35">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {providers.slice(0, 6).map((provider) => (
          <ProviderLogo key={`${label}-${provider.provider_id}`} provider={provider} />
        ))}
      </div>
    </div>
  );
}

function WatchProvidersRow({
  providers,
  isLoading,
  error,
}: {
  providers: WatchProviderData | null;
  isLoading: boolean;
  error: string | null;
}) {
  const hasProviders = Boolean(providers && (providers.stream.length || providers.rent.length || providers.buy.length));
  const content = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/55">Where to watch</h3>
        <span className="shrink-0 text-[10px] text-white/35">Streaming data by JustWatch</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-white/45">
          <Loader2 size={14} className="animate-spin" />
          Loading providers...
        </div>
      ) : error ? (
        <p className="text-xs text-white/45">{error}</p>
      ) : hasProviders && providers ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProviderGroup label="Stream" providers={providers.stream} />
          <ProviderGroup label="Rent" providers={providers.rent} />
          <ProviderGroup label="Buy" providers={providers.buy} />
        </div>
      ) : (
        <p className="text-xs text-white/45">Not streaming in your region</p>
      )}
    </div>
  );

  if (providers?.link && hasProviders) {
    return (
      <a href={providers.link} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }

  return content;
}

export function MovieDetailCard({
  movie,
  title,
  subtitle,
  isInWatchlist,
  watchlistMessage,
  onToggleWatchlist,
  onRate,
  onBack,
  showRatingActions = true,
  backLabel = 'Back',
}: {
  movie: MovieDetail;
  title?: string | null;
  subtitle?: string;
  isInWatchlist?: boolean;
  watchlistMessage?: string | null;
  onToggleWatchlist?: () => void;
  onRate?: (action: Exclude<SwipeAction, 'unwatched'>) => void;
  onBack: () => void;
  showRatingActions?: boolean;
  backLabel?: string;
}) {
  const [providers, setProviders] = useState<WatchProviderData | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const tmdbId = movie.tmdbId;
  const canShare = Boolean(movie.recommendationReason) && Boolean(tmdbId) && tmdbId > 0;

  async function handleShare() {
    if (isSharing) return;
    setIsSharing(true);
    setShareMessage(null);

    const copyToClipboard = async (url: string) => {
      try {
        await navigator.clipboard.writeText(url);
        setShareMessage('Link copied to clipboard');
      } catch {
        setShareMessage('Could not copy the link.');
      }
    };

    try {
      const result = await shareRecommendation({
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.year,
        posterUrl: movie.posterUrl,
        reason: movie.recommendationReason ?? undefined,
      });

      if (!result.ok) {
        setShareMessage(result.message);
        return;
      }

      const url = `${window.location.origin}${result.data.url}`;

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: `Watch ${movie.title}`, url });
          setShareMessage('Shared!');
        } catch (err) {
          // A cancelled share sheet isn't an error; anything else → clipboard.
          if ((err as { name?: string })?.name !== 'AbortError') {
            await copyToClipboard(url);
          }
        }
      } else {
        await copyToClipboard(url);
      }
    } catch {
      setShareMessage('Could not create a share link.');
    } finally {
      setIsSharing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      await Promise.resolve();
      if (cancelled) return;

      if (!tmdbId || tmdbId <= 0) {
        setProviders(null);
        setProvidersError(null);
        setProvidersLoading(false);
        return;
      }

      setProvidersLoading(true);
      setProvidersError(null);

      try {
        const result = await getWatchProviders(tmdbId);
        if (cancelled) return;
        if (result.ok) {
          setProviders(result.data);
        } else {
          setProviders(null);
          setProvidersError(result.message);
        }
      } catch {
        if (!cancelled) {
          setProviders(null);
          setProvidersError('Streaming providers are unavailable right now.');
        }
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    }

    void loadProviders();

    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  const watchProvidersRow = useMemo(
    () => <WatchProvidersRow providers={providers} isLoading={providersLoading} error={providersError} />,
    [providers, providersError, providersLoading]
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans overflow-hidden">
      {isTrustedPosterUrl(movie.posterUrl) && (
        <div
          className="absolute inset-0 z-0 opacity-20 bg-cover bg-center blur-xl scale-110 pointer-events-none"
          style={{ backgroundImage: `url(${movie.posterUrl})` }}
        />
      )}

      <header className="px-6 pt-0 pb-1 flex items-center justify-between z-10 min-h-[0.75rem]">
        <div>
          {title ? <h1 className="text-2xl font-serif font-bold tracking-tight">{title}</h1> : null}
          {subtitle ? <p className="text-white/50 text-xs mt-1">{subtitle}</p> : null}
        </div>
      </header>

      <main className="flex-1 relative flex flex-col items-center justify-start px-6 pb-6 pt-0 z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-sm aspect-[2/3] border border-white/10 rounded-3xl overflow-hidden relative flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.8)]"
        >
          {onToggleWatchlist ? (
            <button
              onClick={onToggleWatchlist}
              disabled={!movie.tmdbId}
              className="absolute top-4 right-4 z-50 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 transition-colors border border-white/20 shadow-lg"
            >
              {isInWatchlist ? <Check size={24} className="text-green-400" /> : <Plus size={24} />}
            </button>
          ) : null}

          {canShare ? (
            <button
              onClick={() => void handleShare()}
              disabled={isSharing}
              aria-label="Share this recommendation"
              className="absolute top-4 left-4 z-50 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 transition-colors border border-white/20 shadow-lg disabled:opacity-60"
            >
              {isSharing ? <Loader2 size={22} className="animate-spin" /> : <Share2 size={22} />}
            </button>
          ) : null}

          <AnimatePresence>
            {shareMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 4 }}
                className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center z-50 px-4 py-2 bg-black/80 backdrop-blur-md text-white text-xs font-mono rounded-full border border-white/10 shadow-xl whitespace-nowrap max-w-[90%]"
              >
                {shareMessage}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {watchlistMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 4 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 h-12 flex items-center z-50 px-4 bg-black/80 backdrop-blur-md text-white text-xs font-mono rounded-full border border-white/10 shadow-xl whitespace-nowrap"
              >
                {watchlistMessage}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute inset-0 z-0 bg-white/5">
            {isTrustedPosterUrl(movie.posterUrl) ? (
              <Image src={movie.posterUrl} alt={`${movie.title} poster`} fill className="object-cover" sizes="(max-width: 640px) 100vw, 400px" priority />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Film size={48} className="text-white/20" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent pointer-events-none" />
          </div>

          <div className="absolute inset-0 overflow-y-auto scrollbar-hide z-10">
            <div className="h-full flex flex-col justify-end p-8 pb-6 relative z-20 pointer-events-none">
              <div className="pointer-events-auto">
                <h2 className="text-4xl font-bold text-white mb-2 font-serif leading-tight">{movie.title}</h2>
                <div className="flex items-center gap-3 text-white/80 text-sm mb-4 font-mono">
                  <span className="px-2 py-1 rounded bg-white/20 backdrop-blur-sm">{movie.year}</span>
                  <span>•</span>
                  <span>{movie.genre}</span>
                </div>
                <p className="text-white/90 text-sm leading-relaxed drop-shadow-md">{movie.synopsis}</p>
              </div>
            </div>

            <div className="bg-[#0a0a0a] p-8 pt-6 relative z-10">
              <div className="absolute bottom-full left-0 right-0 h-72 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent pointer-events-none" />
              {movie.recommendationReason ? (
                <>
                  <h3 className="text-[10px] font-bold tracking-widest text-pink-400/60 uppercase mb-2">Why you&apos;ll love it</h3>
                  <p className="text-pink-100/90 leading-relaxed text-sm italic mb-6">{movie.recommendationReason}</p>
                </>
              ) : null}
              <div className="mb-5">{watchProvidersRow}</div>
              <div className="pt-4 border-t border-white/10 pb-2">
                <p className="text-white/40 text-[10px] uppercase tracking-widest font-mono">Dir. {movie.director}</p>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="mt-8 flex flex-col items-center w-full max-w-sm gap-4 z-10">
          {showRatingActions && onRate ? (
            <>
              <div className="text-center text-xs text-white/60 font-mono">Already seen? Log it now</div>
              <div className="flex justify-center gap-4">
                <button onClick={() => onRate('disliked')} className="w-14 h-14 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center hover:bg-orange-500/20 transition-colors border border-orange-500/30">
                  <ThumbsDown size={24} />
                </button>
                <button onClick={() => onRate('loved')} className="w-14 h-14 rounded-full bg-pink-500/10 text-pink-500 flex items-center justify-center hover:bg-pink-500/20 transition-colors border border-pink-500/30">
                  <Heart size={24} />
                </button>
                <button onClick={() => onRate('watched')} className="w-14 h-14 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center hover:bg-green-500/20 transition-colors border border-green-500/30">
                  <Eye size={24} />
                </button>
              </div>
            </>
          ) : null}

          <button onClick={onBack} className="w-full py-4 mt-2 rounded-2xl bg-white text-black font-bold tracking-wide hover:bg-white/90 transition-colors text-sm uppercase">
            {backLabel}
          </button>
        </div>
      </main>
    </div>
  );
}
