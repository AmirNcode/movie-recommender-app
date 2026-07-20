import { describe, it, expect } from 'vitest';
import { withAffiliateParams, affiliateLinkFor } from '@/lib/affiliate';
import type { WatchProvider } from '@/types/movie';

const provider: WatchProvider = { provider_id: 8, provider_name: 'Netflix', logo_path: '/x.jpg' };

describe('withAffiliateParams', () => {
  it('appends the Filmmoo UTM params', () => {
    const url = new URL(withAffiliateParams('https://www.themoviedb.org/movie/27205/watch'));
    expect(url.searchParams.get('utm_source')).toBe('filmmoo');
    expect(url.searchParams.get('utm_medium')).toBe('app');
  });

  it('preserves an existing query string', () => {
    const url = new URL(withAffiliateParams('https://www.themoviedb.org/movie/27205/watch?locale=US'));
    expect(url.searchParams.get('locale')).toBe('US');
    expect(url.searchParams.get('utm_source')).toBe('filmmoo');
  });

  it('overwrites pre-existing UTM values rather than duplicating them', () => {
    const result = withAffiliateParams('https://ex.com/w?utm_source=other');
    const url = new URL(result);
    expect(url.searchParams.getAll('utm_source')).toEqual(['filmmoo']);
  });

  it('returns the input unchanged for an unparseable URL', () => {
    expect(withAffiliateParams('not a url')).toBe('not a url');
  });
});

describe('affiliateLinkFor', () => {
  it('returns the UTM-stamped landing link for every provider (phase-1 stub)', () => {
    const link = affiliateLinkFor(provider, 'https://ex.com/watch');
    expect(link).toBe(withAffiliateParams('https://ex.com/watch'));
    expect(new URL(link).searchParams.get('utm_source')).toBe('filmmoo');
  });
});
