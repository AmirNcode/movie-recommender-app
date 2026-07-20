import { describe, expect, it } from 'vitest';
import {
  computeTasteVector,
  fromVectorLiteral,
  movieEmbeddingText,
  normalise,
  toVectorLiteral,
} from '@/lib/embeddings';

describe('movieEmbeddingText', () => {
  it('includes title, year, genre, and synopsis', () => {
    expect(
      movieEmbeddingText({ title: 'Heat', year: 1995, genre: 'Crime', synopsis: 'Cat and mouse.' })
    ).toBe('Heat (1995) — Crime. Cat and mouse.');
  });

  it('omits missing fields', () => {
    expect(movieEmbeddingText({ title: 'Heat', year: null, genre: null, synopsis: null })).toBe('Heat');
  });

  it('caps at 2000 characters', () => {
    const text = movieEmbeddingText({ title: 'X', year: null, genre: null, synopsis: 'a'.repeat(5000) });
    expect(text.length).toBe(2000);
  });
});

describe('normalise', () => {
  it('returns a unit vector', () => {
    const result = normalise([3, 4]);
    expect(result).not.toBeNull();
    expect(result![0]).toBeCloseTo(0.6);
    expect(result![1]).toBeCloseTo(0.8);
  });

  it('returns null for a zero vector', () => {
    expect(normalise([0, 0, 0])).toBeNull();
  });
});

describe('computeTasteVector', () => {
  it('returns null for empty input', () => {
    expect(computeTasteVector([])).toBeNull();
  });

  it('weights entries and normalises the mean', () => {
    const result = computeTasteVector([
      { embedding: [1, 0], weight: 1 },
      { embedding: [0, 1], weight: 1 },
    ]);
    expect(result).not.toBeNull();
    expect(result![0]).toBeCloseTo(Math.SQRT1_2);
    expect(result![1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('lets negative weights pull the vector away', () => {
    const result = computeTasteVector([
      { embedding: [1, 0], weight: 1 },
      { embedding: [0, 1], weight: -0.7 },
    ]);
    expect(result).not.toBeNull();
    expect(result![0]).toBeGreaterThan(0);
    expect(result![1]).toBeLessThan(0);
  });

  it('returns null when weights cancel out exactly', () => {
    expect(
      computeTasteVector([
        { embedding: [1, 0], weight: 1 },
        { embedding: [1, 0], weight: -1 },
      ])
    ).toBeNull();
  });

  it('skips entries with mismatched dimensions', () => {
    const result = computeTasteVector([
      { embedding: [1, 0], weight: 1 },
      { embedding: [1, 0, 0], weight: 1 },
    ]);
    expect(result).toEqual([1, 0]);
  });
});

describe('vector literals', () => {
  it('round-trips through the pgvector text format', () => {
    const vec = [0.25, -1, 3.5];
    expect(fromVectorLiteral(toVectorLiteral(vec))).toEqual(vec);
  });

  it('passes arrays through and rejects garbage', () => {
    expect(fromVectorLiteral([1, 2])).toEqual([1, 2]);
    expect(fromVectorLiteral('not json')).toBeNull();
    expect(fromVectorLiteral(42)).toBeNull();
    expect(fromVectorLiteral('{"a":1}')).toBeNull();
  });
});
