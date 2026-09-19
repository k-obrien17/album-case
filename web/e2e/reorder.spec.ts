import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { ranked, snapshot } from './support/fixtures';

test('dragging an existing row by its grip reorders the list and re-syncs', async ({ page }) => {
  const mocks = await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 9), ranked(2, 6), ranked(3, 3)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Ranked list/ }).click();

  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2', 'Fixture Album 3']);

  const grip = page.getByLabel('Reorder Fixture Album 3');
  const gripBox = await grip.boundingBox();
  const topRowBox = await page.locator('.rank-row').nth(0).boundingBox();
  if (!gripBox || !topRowBox) throw new Error('expected grip/top row to be visible');

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(topRowBox.x + topRowBox.width / 2, topRowBox.y + 2, { steps: 10 });
  await page.mouse.up();

  await expect(rows).toHaveText(['Fixture Album 3', 'Fixture Album 1', 'Fixture Album 2']);
  await expect
    .poll(() => mocks.postRankingCalls.length, { message: 'expected a ranking snapshot save after reorder' })
    .toBeGreaterThan(0);
  const lastSave = mocks.postRankingCalls.at(-1) as { ranked: { mbid: string }[] };
  expect(lastSave.ranked.map((a) => a.mbid)).toEqual(['album-3', 'album-1', 'album-2']);
});
