import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Film } from 'lucide-react';
import { getSharedRecommendation } from '@/lib/shared-recommendation';

type PageProps = { params: Promise<{ id: string }> };

/** Trims a reason to a social-preview-friendly length. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const rec = await getSharedRecommendation(id);
  if (!rec) return { title: 'Recommendation not found | Filmmoo' };

  if (rec.kind === 'dna' && rec.dna) {
    const title = `My Cinema DNA: ${rec.dna.archetype}`;
    const description = truncate(rec.dna.headline, 160);
    return {
      title: `${title} | Filmmoo`,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: [{ url: `/r/${rec.id}/opengraph-image` }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [`/r/${rec.id}/opengraph-image`],
      },
    };
  }

  const yearSuffix = rec.year ? ` (${rec.year})` : '';
  const title = `Watch ${rec.title}${yearSuffix}`;
  const description = rec.reason
    ? truncate(rec.reason, 160)
    : `A movie Filmmoo recommends for you.`;

  return {
    title: `${title} | Filmmoo`,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: `/r/${rec.id}/opengraph-image` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/r/${rec.id}/opengraph-image`],
    },
  };
}

export default async function SharedRecommendationPage({ params }: PageProps) {
  const { id } = await params;
  const rec = await getSharedRecommendation(id);
  if (!rec) notFound();

  if (rec.kind === 'dna' && rec.dna) {
    const dna = rec.dna;
    return (
      <main className="min-h-screen bg-[#0a0a0a] px-6 py-16 text-white">
        <div className="mx-auto max-w-2xl space-y-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300">Cinema DNA</p>
          <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight md:text-5xl">{dna.archetype}</h1>
          <p className="text-lg italic leading-relaxed text-pink-100/90">{dna.headline}</p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {dna.traits.map((trait) => (
              <span
                key={trait}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80"
              >
                {trait}
              </span>
            ))}
          </div>

          <div className="grid gap-4 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-pink-400/60">Guilty pleasure</h2>
              <p className="text-sm text-white/85">{dna.guilty_pleasure}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-pink-400/60">Blind spot</h2>
              <p className="text-sm text-white/85">{dna.blind_spot}</p>
            </div>
          </div>

          <div className="pt-2">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-white px-8 text-sm font-bold uppercase tracking-wide text-black transition-colors hover:bg-white/90"
            >
              Discover your Cinema DNA → Sign up
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const yearSuffix = rec.year ? ` · ${rec.year}` : '';

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-16 text-white">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-10 md:flex-row md:items-start">
        <div className="relative aspect-[2/3] w-52 shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_0_40px_rgba(0,0,0,0.8)]">
          {rec.posterUrl ? (
            <Image
              src={rec.posterUrl}
              alt={`${rec.title} poster`}
              fill
              className="object-cover"
              sizes="208px"
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Film size={48} className="text-white/20" />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-6 text-center md:text-left">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-pink-300">Filmmoo recommends</p>
          <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            {rec.title}
            <span className="text-white/40">{yearSuffix}</span>
          </h1>

          {rec.reason ? (
            <div className="space-y-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-pink-400/60">Why you&apos;ll love it</h2>
              <p className="text-base italic leading-relaxed text-pink-100/90">{rec.reason}</p>
            </div>
          ) : null}

          <div className="pt-2">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-white px-8 text-sm font-bold uppercase tracking-wide text-black transition-colors hover:bg-white/90"
            >
              Get your own recommendation → Sign up
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
