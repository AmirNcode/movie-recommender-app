/**
 * S6 ACCEPTANCE: two accounts create + join a Movie Night, both swipe "yes" on
 * the same card, and both screens flip to the match within ~2s (the second
 * voter via the direct action result, the first — still mid-deck, so with no
 * poll fallback — purely via Supabase Realtime). Then a third account is denied
 * the night by RLS, while a participant can read it.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile?.('.env');

const MATCH_HEADING = "It's a match!";

function creds(prefix: string): { email: string; password: string } {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) throw new Error(`${prefix}_EMAIL/${prefix}_PASSWORD not set — global-setup did not run.`);
  return { email, password };
}

function publishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error('No Supabase publishable/anon key in env.');
  return key;
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test('two-account realtime match + third-account RLS denial', async ({ browser }) => {
  const A = creds('MN_A');
  const B = creds('MN_B');
  const C = creds('MN_C');

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  try {
    await login(hostPage, A.email, A.password);
    await login(guestPage, B.email, B.password);

    // ── Host creates a night, reads the code ──
    await hostPage.goto('/night');
    await hostPage.getByRole('button', { name: 'Start a Movie Night' }).click();
    const codeEl = hostPage.getByTestId('night-code');
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const code = (await codeEl.textContent())?.trim() ?? '';
    expect(code).toHaveLength(6);

    // ── Guest joins with the code ──
    await guestPage.goto('/night');
    await guestPage.getByPlaceholder('ENTER CODE').fill(code);
    await guestPage.getByRole('button', { name: 'Join', exact: true }).click();

    // Both land on the shared deck (host via the waiting→active transition).
    await expect(guestPage.getByRole('button', { name: 'Yes, watch it' })).toBeVisible({ timeout: 15_000 });
    await expect(hostPage.getByRole('button', { name: 'Yes, watch it' })).toBeVisible({ timeout: 15_000 });

    // The night id (shared) for the RLS check.
    const nightId = await hostPage.locator('[data-night-id]').getAttribute('data-night-id');
    expect(nightId).toBeTruthy();

    // ── Both vote "yes" on the first (identically-ranked) card ──
    await guestPage.getByRole('button', { name: 'Yes, watch it' }).click();
    await hostPage.getByRole('button', { name: 'Yes, watch it' }).click();
    const votedAt = Date.now();

    await Promise.all([
      expect(hostPage.getByRole('heading', { name: MATCH_HEADING })).toBeVisible({ timeout: 8_000 }),
      expect(guestPage.getByRole('heading', { name: MATCH_HEADING })).toBeVisible({ timeout: 8_000 }),
    ]);
    const elapsed = Date.now() - votedAt;
    console.log(`[movie-night] both screens flipped to match in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(4_000);

    // ── RLS: a participant can read the night; a third account cannot ──
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = publishableKey();

    const participant = createClient(url, key, { auth: { persistSession: false } });
    await participant.auth.signInWithPassword({ email: A.email, password: A.password });
    const asParticipant = await participant.from('movie_nights').select('id').eq('id', nightId!);
    expect(asParticipant.error).toBeNull();
    expect(asParticipant.data).toHaveLength(1); // host sees their own night

    const outsider = createClient(url, key, { auth: { persistSession: false } });
    await outsider.auth.signInWithPassword({ email: C.email, password: C.password });
    const asOutsiderNight = await outsider.from('movie_nights').select('id').eq('id', nightId!);
    const asOutsiderCards = await outsider.from('movie_night_cards').select('tmdb_movie_id').eq('night_id', nightId!);
    const asOutsiderVotes = await outsider.from('movie_night_votes').select('tmdb_movie_id').eq('night_id', nightId!);

    // RLS denies silently → zero rows (not an error) on all three tables.
    expect(asOutsiderNight.data).toEqual([]);
    expect(asOutsiderCards.data).toEqual([]);
    expect(asOutsiderVotes.data).toEqual([]);
    console.log('[movie-night] third account denied on nights/cards/votes ✓');

    await participant.auth.signOut();
    await outsider.auth.signOut();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
