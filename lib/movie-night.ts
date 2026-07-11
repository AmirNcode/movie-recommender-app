/**
 * Server-side helpers for Movie Night (S6): join-code generation/normalisation
 * and the shared deck size. Codes are 6 characters from the A–Z2–9 alphabet
 * (digits 0/1 omitted at the source to avoid O/0 and I/1 confusion when a code
 * is read aloud or typed).
 */
import { randomInt } from 'node:crypto';

/** A–Z plus 2–9. No 0 or 1 (ambiguous with O/I when typed from a screen). */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

export const MOVIE_NIGHT_CODE_LENGTH = 6;

/** Number of shared cards dealt into a night's deck at join time. */
export const MOVIE_NIGHT_DECK_SIZE = 30;

/** Generates a random 6-char join code from the A–Z2–9 alphabet. */
export function generateMovieNightCode(): string {
  let code = '';
  for (let i = 0; i < MOVIE_NIGHT_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normalises user-entered join input to a canonical code, or returns null when
 * it can't be a valid code (wrong length, or a character outside the alphabet).
 * Trims surrounding whitespace and upper-cases before validating.
 */
export function normalizeMovieNightCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().toUpperCase();
  if (cleaned.length !== MOVIE_NIGHT_CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}
