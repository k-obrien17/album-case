import { test, expect, type Page } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { ranked, snapshot } from './support/fixtures';

/** Edits an already-ranked row's rating (onSetRating, web/src/main.ts), which
 *  triggers exactly one persistRankingState() call -- unlike the candidate's
 *  "rate it directly" control, which also fires persistLists() alongside it
 *  and would make two saves race each other. */
async function editRating(page: Page, title: string, rating: string): Promise<void> {
  await page.getByRole('button', { name: /^Ranked list/ }).click();
  await page.getByLabel(`Edit rating for ${title}`).click();
  const input = page.getByLabel(`Rating for ${title}`);
  await input.fill(rating);
  await input.press('Enter');
}

test('a 409 conflict on save shows the conflict banner and keeps local edits', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 5)]),
    postRanking: () => ({ status: 409 }),
  });

  await page.goto('/');
  await editRating(page, 'Fixture Album 1', '7.5');

  const banner = page.locator('.sync-banner');
  await expect(banner).toContainText(
    'The saved copy changed in another tab or device. Your unsaved work is kept here.'
  );
  await expect(page.getByRole('button', { name: 'Export unsaved backup' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Discard unsaved changes & load saved copy' })
  ).toBeVisible();
});

test('a failed save retries and clears the banner once it succeeds', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 5)]),
    postRanking: (_body, callIndex) =>
      callIndex === 1 ? { status: 500 } : { status: 200, body: { updated_at: Date.now() } },
  });

  await page.goto('/');
  await editRating(page, 'Fixture Album 1', '7.5');

  const banner = page.locator('.sync-banner');
  await expect(banner).toContainText('Not saved to the server yet. Retrying...');

  // syncEngine's retry timer (SYNC_RETRY_MS, web/src/syncEngine.ts) is 4s.
  await expect(banner).toBeHidden({ timeout: 6000 });
});
