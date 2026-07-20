import { describe, expect, it } from 'vitest';
import { buildPosterUrl, pickBestTmdbMatch } from './tmdb';
import type { Recommendation } from '@/types/movie';

function makeTarget(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    title: 'Inception',
    year: 2010,
    director: 'Christopher Nolan',
    genre: 'Sci-Fi',
    synopsis: 'A thief who steals corporate secrets through dream-sharing technology.',
    reason: 'You loved other mind-bending sci-fi.',
    ...overrides,
  };
}

describe('pickBestTmdbMatch', () => {
  it('returns null when results is undefined or empty', () => {
    expect(pickBestTmdbMatch(undefined, makeTarget())).toBeNull();
    expect(pickBestTmdbMatch([], makeTarget())).toBeNull();
  });

  it('picks an exact title + year match', () => {
    const result = pickBestTmdbMatch(
      [
        { id: 1, title: 'Inception', release_date: '2010-07-16', poster_path: '/abc.jpg' },
        { id: 2, title: 'Inception: The Cobol Job', release_date: '2010-01-01' },
      ],
      makeTarget()
    );
    expect(result?.id).toBe(1);
  });

  it('falls back to a fuzzy title match in the same year as the target', () => {
    const result = pickBestTmdbMatch(
      [{ id: 3, title: 'The Inception Job', release_date: '2010-01-01' }],
      makeTarget()
    );
    expect(result?.id).toBe(3);
  });

  it('rejects a low-confidence match (wrong title and wrong year)', () => {
    const result = pickBestTmdbMatch(
      [{ id: 4, title: 'Completely Unrelated Movie', release_date: '1985-01-01' }],
      makeTarget()
    );
    expect(result).toBeNull();
  });

  it('matches on original_title when localized title differs', () => {
    const result = pickBestTmdbMatch(
      [{ id: 5, title: 'Origine', original_title: 'Inception', release_date: '2010-07-16' }],
      makeTarget()
    );
    expect(result?.id).toBe(5);
  });
});

describe('buildPosterUrl', () => {
  it('builds a full TMDB image URL from a poster path', () => {
    expect(buildPosterUrl('/abc123.jpg')).toBe('https://image.tmdb.org/t/p/w500/abc123.jpg');
  });

  it('returns undefined for a null or missing poster path', () => {
    expect(buildPosterUrl(null)).toBeUndefined();
    expect(buildPosterUrl(undefined)).toBeUndefined();
  });
});
