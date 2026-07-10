/**
 * Fail-fast guard for required server-side environment variables.
 *
 * A misconfigured deploy otherwise ships green and then silently breaks every
 * server feature: the queue never fills, posters go missing, rate limiting is
 * bypassed, and `/` is unprotected — with nothing logged. `assertServerEnv`
 * throws on the first server-side import at runtime instead, naming the missing
 * key. It is a no-op during `next build` so builds don't require secrets.
 */

const REQUIRED_SERVER_ENV = [
  'GEMINI_API_KEY',
  'TMDB_API_KEY',
  'SUPABASE_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
] as const;

const PUBLISHABLE_KEY_ALIASES = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export function assertServerEnv(): void {
  // Don't fail the production build, which runs without secrets present.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const missing: string[] = REQUIRED_SERVER_ENV.filter((key) => !process.env[key]);

  const hasPublishable = PUBLISHABLE_KEY_ALIASES.some((key) => process.env[key]);
  if (!hasPublishable) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}
