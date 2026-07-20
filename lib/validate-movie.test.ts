import { describe, expect, it } from 'vitest';
import { validateMovie } from './validate-movie';
import type { MovieDetail } from '@/types/library';

function makeMovie(overrides: Partial<MovieDetail> = {}): MovieDetail {
  return {
    tmdbId: 27205,
    title: 'Inception',
    year: 2010,
    director: 'Christopher Nolan',
    genre: 'Sci-Fi',
    synopsis: 'A thief who steals corporate secrets.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/abc.jpg',
    source: 'swipe',
    ...overrides,
  };
}

describe('validateMovie', () => {
  it('rejects a non-positive or non-integer tmdbId', () => {
    expect(validateMovie(makeMovie({ tmdbId: 0 }))).toMatchObject({ ok: false, code: 'validation' });
    expect(validateMovie(makeMovie({ tmdbId: -5 }))).toMatchObject({ ok: false, code: 'validation' });
    expect(validateMovie(makeMovie({ tmdbId: 1.5 }))).toMatchObject({ ok: false, code: 'validation' });
  });

  it('rejects a tmdbId above the max allowed', () => {
    expect(validateMovie(makeMovie({ tmdbId: 3_000_000_000 }))).toMatchObject({
      ok: false,
      code: 'validation',
    });
  });

  it('truncates over-long text fields instead of rejecting', () => {
    const result = validateMovie(makeMovie({ title: 'a'.repeat(500), synopsis: 'b'.repeat(3000) }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.movie.title).toHaveLength(300);
      expect(result.movie.synopsis).toHaveLength(2000);
    }
  });

  it('drops a posterUrl that does not match the TMDB CDN pattern', () => {
    const result = validateMovie(makeMovie({ posterUrl: 'https://evil.example.com/x.jpg' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.movie.posterUrl).toBeUndefined();
    }
  });

  it('keeps a valid TMDB posterUrl', () => {
    const result = validateMovie(makeMovie());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.movie.posterUrl).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    }
  });

  it('coerces an unknown source to manual', () => {
    const result = validateMovie(makeMovie({ source: 'not-a-real-source' as MovieDetail['source'] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.movie.source).toBe('manual');
    }
  });

  it('zeroes out an out-of-range year', () => {
    const result = validateMovie(makeMovie({ year: 1800 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.movie.year).toBe(0);
    }
  });
});
