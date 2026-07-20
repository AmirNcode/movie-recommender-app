import Image from 'next/image';
import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#0a0a0a] px-6 py-6 text-white/55">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 text-xs leading-relaxed md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl space-y-3">
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center opacity-90 transition-opacity hover:opacity-100"
            aria-label="The Movie Database"
          >
            <Image src="/tmdb-logo.svg" alt="TMDB" width={137} height={18} />
          </a>
          <p>
            This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data by{' '}
            <a
              href="https://www.justwatch.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-white/75 underline-offset-4 hover:text-white hover:underline"
            >
              JustWatch
            </a>
            .
          </p>
        </div>

        <nav aria-label="Legal" className="flex shrink-0 gap-4 font-mono uppercase tracking-[0.18em] text-[0.65rem]">
          <Link href="/privacy" className="transition-colors hover:text-white">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-white">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
