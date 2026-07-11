import { describe, it, expect } from 'vitest';
import { isProStatus } from '@/lib/billing';

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe('isProStatus', () => {
  it('grants Pro for active within the current period', () => {
    expect(isProStatus('active', future)).toBe(true);
  });

  it('grants Pro for trialing within the current period', () => {
    expect(isProStatus('trialing', future)).toBe(true);
  });

  it('keeps Pro for a canceled subscription until the period actually ends', () => {
    // Stripe reports status 'active' with cancel_at_period_end until it lapses;
    // once it lapses the webhook writes 'canceled', which never entitles.
    expect(isProStatus('canceled', future)).toBe(false);
  });

  it('denies Pro when the period has already ended, even if active', () => {
    expect(isProStatus('active', past)).toBe(false);
  });

  it('denies Pro for non-entitling statuses', () => {
    expect(isProStatus('past_due', future)).toBe(false);
    expect(isProStatus('inactive', future)).toBe(false);
  });

  it('denies Pro when there is no period end', () => {
    expect(isProStatus('active', null)).toBe(false);
  });
});
