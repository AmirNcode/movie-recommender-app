import { describe, expect, it } from 'vitest';
import { parseRateLimitResult } from './rate-limit';

describe('parseRateLimitResult', () => {
  it('allows the request when the RPC returns an object with allowed: true', () => {
    expect(parseRateLimitResult({ allowed: true }, 60_000)).toEqual({ allowed: true });
  });

  it('allows the request when the RPC returns null', () => {
    expect(parseRateLimitResult(null, 60_000)).toEqual({ allowed: true });
  });

  it('denies the request and passes through retryAfter from the RPC', () => {
    expect(parseRateLimitResult({ allowed: false, retryAfter: 42 }, 60_000)).toEqual({
      allowed: false,
      retryAfter: 42,
    });
  });

  it('falls back to the configured window when retryAfter is missing on a denial', () => {
    expect(parseRateLimitResult({ allowed: false }, 60_000)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
  });

  it('parses a JSON-stringified RPC response the same as an object response', () => {
    expect(parseRateLimitResult(JSON.stringify({ allowed: false, retryAfter: 10 }), 60_000)).toEqual({
      allowed: false,
      retryAfter: 10,
    });
  });
});
