/**
 * Cinema DNA (S16): a Gemini-generated taste report for Pro users, cached on
 * `profiles.cinema_dna` and regenerated at most weekly. This module holds the
 * shape, runtime guard, and normalisation — pure and unit-testable.
 */

/** The structured taste report Gemini returns. */
export type CinemaDna = {
  /** Short persona name, e.g. "The Midnight Auteur". */
  archetype: string;
  /** One-sentence summary of the user's taste. */
  headline: string;
  /** Three short trait phrases. */
  traits: string[];
  /** The mainstream pick they secretly love. */
  guilty_pleasure: string;
  /** A genre/era they haven't explored yet. */
  blind_spot: string;
};

const MAX_SHORT = 120;
const MAX_LONG = 300;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Runtime guard for a parsed Gemini response (types are erased at runtime). */
export function isValidCinemaDna(data: unknown): data is CinemaDna {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!isNonEmptyString(obj.archetype)) return false;
  if (!isNonEmptyString(obj.headline)) return false;
  if (!isNonEmptyString(obj.guilty_pleasure)) return false;
  if (!isNonEmptyString(obj.blind_spot)) return false;
  if (!Array.isArray(obj.traits) || obj.traits.length === 0 || obj.traits.length > 5) return false;
  return obj.traits.every(isNonEmptyString);
}

/** Trims/caps a validated DNA payload before it is stored or rendered. */
export function capCinemaDna(dna: CinemaDna): CinemaDna {
  return {
    archetype: dna.archetype.trim().slice(0, MAX_SHORT),
    headline: dna.headline.trim().slice(0, MAX_LONG),
    traits: dna.traits.slice(0, 3).map((t) => t.trim().slice(0, MAX_SHORT)),
    guilty_pleasure: dna.guilty_pleasure.trim().slice(0, MAX_SHORT),
    blind_spot: dna.blind_spot.trim().slice(0, MAX_SHORT),
  };
}
