import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { album } from './support/fixtures';

function snapshotWithWantToListen(albums: ReturnType<typeof album>[]) {
  return {
    ranked: [],
    lists: { wantToListen: albums, notHeard: [], dontCare: [] },
    artist_locks: [],
    blocked_artists: [],
    curated_skips: [],
    updated_at: 1,
  };
}

test('removing a saved-list album requires confirmation and can be cancelled', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshotWithWantToListen([album(1), album(2)]),
  });

  await page.goto('/');
  await page.locator('.nav-more summary').click();
  await page.locator('.nav-more-items').getByRole('button', { name: /^Want to listen/ }).click();

  const titles = page.locator('.saved-title');
  await expect(titles).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  // Playwright auto-dismisses dialogs by default when no handler is
  // registered -- that's the "cancel" path here.
  await page.locator('.saved-item').first().getByRole('button', { name: 'Remove' }).click();

  await expect(titles).toHaveText(['Fixture Album 1', 'Fixture Album 2']);
});

test('confirming removal takes the album out of the saved list', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshotWithWantToListen([album(1), album(2)]),
  });

  await page.goto('/');
  await page.locator('.nav-more summary').click();
  await page.locator('.nav-more-items').getByRole('button', { name: /^Want to listen/ }).click();

  const titles = page.locator('.saved-title');
  await expect(titles).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.saved-item').first().getByRole('button', { name: 'Remove' }).click();

  await expect(titles).toHaveText(['Fixture Album 2']);
});
