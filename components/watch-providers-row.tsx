'use client';

import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import type { WatchProvider, WatchProviderData } from '@/types/movie';

/**
 * "Where to watch" provider row (S1). Extracted from MovieDetailCard so the
 * Movie Night (S6) match screen can reuse the exact same presentation. Renders
 * grouped Stream/Rent/Buy provider logos with the required JustWatch
 * attribution; the whole row links to the TMDB/JustWatch landing page when one
 * is available and there are providers to show.
 */

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

export function WatchProvidersRow({
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
