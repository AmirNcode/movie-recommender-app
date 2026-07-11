/**
 * S15: affiliate groundwork for the S1 "Where to watch" provider row.
 *
 * Phase-1 scope only — no partner contracts yet. Today this just stamps our
 * UTM params onto the JustWatch/TMDB landing link so downstream click
 * attribution works, and exposes a per-provider hook (`affiliateLinkFor`) that
 * returns the plain link now but is the single place a JustWatch-partner /
 * Amazon-Associates deep link gets wired in once those programs are approved.
 */

import type { WatchProvider } from '@/types/movie';

/** UTM params stamped on every outbound watch-provider link. */
const UTM_PARAMS: Readonly<Record<string, string>> = {
  utm_source: 'filmmoo',
  utm_medium: 'app',
};

/**
 * Appends Filmmoo UTM params to a watch-provider landing URL, preserving any
 * existing query string. Returns the input unchanged if it isn't a parseable
 * absolute URL (never throws — a bad link must not break the provider row).
 */
export function withAffiliateParams(link: string): string {
  try {
    const url = new URL(link);
    for (const [key, value] of Object.entries(UTM_PARAMS)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return link;
  }
}

/**
 * Resolves the outbound URL for a single provider chip.
 *
 * Today this returns the shared landing link with UTM params — the same target
 * for every provider. The `provider` argument is already threaded through so a
 * per-provider deep link can be substituted here without touching callers.
 *
 * @param provider - the provider the chip represents (unused until deep links land)
 * @param baseLink - the shared JustWatch/TMDB landing link for the movie
 */
export function affiliateLinkFor(provider: WatchProvider, baseLink: string): string {
  // AFFILIATE: swap in a per-provider partner deep link keyed on
  // provider.provider_id (JustWatch partner API / Amazon Associates tag / etc.)
  // once the affiliate program is approved. Until then every provider shares
  // the UTM-stamped landing link.
  void provider;
  return withAffiliateParams(baseLink);
}
