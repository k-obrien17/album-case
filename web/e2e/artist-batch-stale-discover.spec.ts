import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { albumForArtist, ranked, snapshot } from './support/fixtures';

test('leaving the artist-batch view before discovery resolves does not clobber the destination view', async ({
  page,
}) => {
  await installApiMocks(page, {
    seedAlbums: [albumForArtist(11, 1)],
    snapshot: snapshot([ranked(1, 5)]),
  });

  // Delay the auto-fired discover-artist call so there's a window to
  // navigate away before it resolves. Registered after installApiMocks, so
  // Playwright's reverse-registration route order gives this precedence.
  await page.route('**/api/discover-artist*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ json: { albums: [] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();

  await page.getByRole('button', { name: 'View all 2 Fixture Artist 1 albums' }).click();
  await expect(page.getByRole('heading', { name: "Fixture Artist 1's albums" })).toBeVisible();

  // Leave before the delayed discover-artist response lands.
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByRole('heading', { name: "Fixture Artist 1's albums" })).not.toBeVisible();
  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1']);

  // Wait past the delayed response landing, then confirm the ranked list is
  // still what's showing -- not silently replaced by the closed batch view.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: "Fixture Artist 1's albums" })).not.toBeVisible();
  await expect(rows).toHaveText(['Fixture Album 1']);
});
