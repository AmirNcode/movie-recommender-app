import 'server-only';
import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { capCinemaDna, isValidCinemaDna, type CinemaDna } from '@/lib/cinema-dna';
import { logger } from '@/lib/logger';

/** A stored, publicly-shareable recommendation snapshot (no author identity). */
export type SharedRecommendation = {
  id: string;
  /** 'rec' = movie recommendation; 'dna' = Cinema DNA card (S16). */
  kind: 'rec' | 'dna';
  tmdbId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  reason: string | null;
  /** Present only for kind 'dna'. */
  dna: CinemaDna | null;
};

/** Basic UUID v4-shape check so a bogus id never hits the DB. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only TMDB-hosted posters are ever surfaced on the public page. */
function trustedPoster(url: string | null): string | null {
  return typeof url === 'string' && url.startsWith('https://image.tmdb.org/') ? url : null;
}

/**
 * Loads a shared recommendation by id for the public `/r/<id>` page.
 *
 * Reads via the admin client (the row is world-readable by policy, but the
 * admin client avoids depending on an anon session on a public route). Returns
 * `null` for a malformed id or a missing row so callers can `notFound()`.
 * Wrapped in React `cache` to dedupe the page + `generateMetadata` reads.
 */
export const getSharedRecommendation = cache(
  async (id: string): Promise<SharedRecommendation | null> => {
    if (!UUID_RE.test(id)) return null;

    const admin = createAdminClient();
    if (!admin) {
      logger.error('SHARED_REC_NO_ADMIN_CLIENT');
      return null;
    }

    const { data, error } = await admin
      .from('shared_recommendations')
      .select('id, kind, tmdb_movie_id, movie_title, movie_year, poster_url, reason, dna')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      logger.warn('SHARED_REC_READ_FAILED', { error: error.message });
      return null;
    }
    if (!data) return null;

    const kind = data.kind === 'dna' ? 'dna' : 'rec';
    return {
      id: data.id,
      kind,
      tmdbId: data.tmdb_movie_id,
      title: data.movie_title,
      year: data.movie_year,
      posterUrl: trustedPoster(data.poster_url),
      reason: data.reason,
      dna: kind === 'dna' && isValidCinemaDna(data.dna) ? capCinemaDna(data.dna) : null,
    };
  }
);
