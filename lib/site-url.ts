/**
 * Resolves the app's canonical absolute origin.
 *
 * Used as Next.js `metadataBase` so relative Open Graph asset URLs (e.g. the
 * `/r/<id>/opengraph-image` share card) resolve to absolute URLs in the emitted
 * `<meta>` tags — social crawlers require absolute image URLs.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_SITE_URL` — explicit production domain (set once D1 lands).
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — the project's stable production host.
 *   3. `VERCEL_URL` — the current deployment host (preview builds).
 *   4. `http://localhost:3000` — local dev fallback.
 */
export function getSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(withProtocol(explicit));

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return new URL(`https://${prod}`);

  const deployment = process.env.VERCEL_URL;
  if (deployment) return new URL(`https://${deployment}`);

  return new URL('http://localhost:3000');
}

/** Ensures a configured origin carries an explicit protocol. */
function withProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
