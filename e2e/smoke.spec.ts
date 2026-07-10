import { test, expect } from '@playwright/test';

test('login, swipe, watchlist, logout', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — global-setup did not run.');
  }

  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();

  // Deck renders at least one card.
  await expect(page.locator('h2').first()).toBeVisible({ timeout: 15_000 });

  // Button-swipe 3 cards.
  for (const label of ['Loved', 'Watched', 'Unwatched'] as const) {
    await page.getByRole('button', { name: label }).click();
    await page.waitForTimeout(500); // let the swipe animation settle
  }

  // Open the watchlist panel.
  await page.getByRole('button', { name: 'Watchlist' }).click();
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();

  // Recommend button should be enabled once the user has swiped.
  await expect(page.getByRole('button', { name: 'Recommend' })).toBeEnabled();

  // Logout.
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
