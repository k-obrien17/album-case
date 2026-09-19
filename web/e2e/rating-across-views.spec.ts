import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { albumForArtist, ranked, snapshot } from './support/fixtures';

test('a rating changed in the artist-batch view is reflected back in the main ranked list', async ({
  page,
}) => {
  // The batch view opens via the candidate's "View all N <artist> albums"
  // action (web/src/ui/rankList.ts's buildActions), which only renders once
  // an artist has 2+ total albums -- so this artist needs both a ranked
  // album and an unranked one (the candidate) to reach it.
  await installApiMocks(page, {
    seedAlbums: [albumForArtist(11, 1)],
    snapshot: snapshot([ranked(1, 5)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Ranked list/ }).click();

  // exact: true throughout -- "Fixture Album 1" is otherwise a substring
  // match of "Fixture Album 11" (the unranked candidate sharing this artist).
  await expect(page.getByLabel('Edit rating for Fixture Album 1', { exact: true })).toHaveText('5.00');

  await page.getByRole('button', { name: 'View all 2 Fixture Artist 1 albums' }).click();
  await expect(page.getByRole('heading', { name: "Fixture Artist 1's albums" })).toBeVisible();

  await page.getByLabel('Edit rating for Fixture Album 1', { exact: true }).click();
  const editInput = page.getByLabel('Rating for Fixture Album 1', { exact: true });
  await editInput.fill('8.50');
  await editInput.press('Enter');

  await expect(page.getByLabel('Edit rating for Fixture Album 1', { exact: true })).toHaveText('8.50');

  await page.getByRole('button', { name: '← Back' }).click();

  // Same album, same underlying rating -- the main ranked list is not a
  // separate copy of the state the batch view edited.
  await expect(page.getByLabel('Edit rating for Fixture Album 1', { exact: true })).toHaveText('8.50');
});
