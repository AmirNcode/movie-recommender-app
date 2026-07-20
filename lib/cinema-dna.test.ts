import { describe, expect, it } from 'vitest';
import { capCinemaDna, isValidCinemaDna } from '@/lib/cinema-dna';

const valid = {
  archetype: 'The Midnight Auteur',
  headline: 'You chase mood over plot, like Blade Runner taught you to.',
  traits: ['Neo-noir devotee', 'Slow-burn tolerant', 'Score-sensitive'],
  guilty_pleasure: 'The Fast Saga',
  blind_spot: 'Golden-age musicals',
};

describe('isValidCinemaDna', () => {
  it('accepts a well-formed payload', () => {
    expect(isValidCinemaDna(valid)).toBe(true);
  });

  it('rejects non-objects and missing fields', () => {
    expect(isValidCinemaDna(null)).toBe(false);
    expect(isValidCinemaDna('nope')).toBe(false);
    expect(isValidCinemaDna({ ...valid, archetype: '' })).toBe(false);
    expect(isValidCinemaDna({ ...valid, headline: undefined })).toBe(false);
  });

  it('rejects bad traits arrays', () => {
    expect(isValidCinemaDna({ ...valid, traits: [] })).toBe(false);
    expect(isValidCinemaDna({ ...valid, traits: ['a', 2, 'c'] })).toBe(false);
    expect(isValidCinemaDna({ ...valid, traits: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(false);
  });
});

describe('capCinemaDna', () => {
  it('trims, caps lengths, and keeps at most 3 traits', () => {
    const capped = capCinemaDna({
      archetype: `  ${'x'.repeat(500)}  `,
      headline: 'y'.repeat(500),
      traits: ['a', 'b', 'c', 'd', 'e'],
      guilty_pleasure: ' gp ',
      blind_spot: ' bs ',
    });
    expect(capped.archetype.length).toBe(120);
    expect(capped.headline.length).toBe(300);
    expect(capped.traits).toEqual(['a', 'b', 'c']);
    expect(capped.guilty_pleasure).toBe('gp');
    expect(capped.blind_spot).toBe('bs');
  });
});
