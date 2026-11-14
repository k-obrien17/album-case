import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { album, albumForArtist, ranked, snapshot } from './support/fixtures';

test('triaging the last album of an artist moves on to the next artist, not back to the top of the list', async ({ page }) => {
  await installApiMocks(page, {
    seedAlbums: [albumForArtist(11, 1), albumForArtist(12, 2), albumForArtist(13, 3)],
    snapshot: snapshot([ranked(1, 9), ranked(2, 8), ranked(3, 7)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Find albums/ }).click();
  await page.getByRole('button', { name: 'Artist gaps' }).click();
  await page.getByLabel('Choose an artist').selectOption({ label: 'Fixture Artist 2 · 1 ranked · 1 to review' });
  const heading = page.locator('.backlog-artist-heading h3');
  await expect(heading).toHaveText('Fixture Artist 2');

  await page.getByRole('button', { name: 'Haven’t heard' }).click();

  // Artist 2 has nothing left to review, so it drops out. Landing on Artist 1
  // (the top of the list) is the cycling bug.
  await expect(heading).toHaveText('Fixture Artist 3');
});

test('skipping an artist marks it reviewed and shows the next one', async ({ page }) => {
  await installApiMocks(page, {
    seedAlbums: [albumForArtist(11, 1), albumForArtist(12, 2), albumForArtist(13, 3)],
    snapshot: snapshot([ranked(1, 9), ranked(2, 8), ranked(3, 7)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Find albums/ }).click();
  await page.getByRole('button', { name: 'Artist gaps' }).click();
  const heading = page.locator('.backlog-artist-heading h3');
  await expect(heading).toHaveText('Fixture Artist 1');

  await page.getByRole('button', { name: 'Skip artist →' }).click();
  await expect(heading).toHaveText('Fixture Artist 2');
  await expect(page.locator('.backlog-progress').first()).toContainText('1 of 3 artists reviewed');
});

test('removing a saved-list album saves it to the server so it stays hidden', async ({ page }) => {
  const mocks = await installApiMocks(page, {
    seedAlbums: [album(99)],
    snapshot: {
      ranked: [],
      lists: { wantToListen: [album(1), album(2)], notHeard: [], dontCare: [] },
      artist_locks: [],
      blocked_artists: [],
      curated_skips: [],
      skipped_albums: ['earlier-hidden'],
      updated_at: 1,
    } as never,
  });

  await page.goto('/');
  await page.locator('.nav-more summary').click();
  await page.getByRole('button', { name: /^My list/ }).click();
  await page.locator('.view-filters').getByRole('button', { name: /^Want to listen/ }).click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.saved-item').first().getByRole('button', { name: 'Remove' }).click();

  await expect
    .poll(() => (mocks.postRankingCalls.at(-1) as { skipped_albums?: string[] } | undefined)?.skipped_albums?.slice().sort())
    .toEqual(['album-1', 'earlier-hidden']);
});
