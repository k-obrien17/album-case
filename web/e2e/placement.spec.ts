import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { album, ranked, snapshot } from './support/fixtures';

test('dragging the candidate into the list places it at the dropped position', async ({ page }) => {
  const candidate = album(3);
  await installApiMocks(page, {
    seedAlbums: [candidate],
    snapshot: snapshot([ranked(1, 8), ranked(2, 4)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();

  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  const dragHandle = page.locator('.candidate-drag');
  await expect(dragHandle).toContainText('Fixture Album 3');
  const handleBox = await dragHandle.boundingBox();
  const secondRowBox = await page.locator('.rank-row').nth(1).boundingBox();
  if (!handleBox || !secondRowBox) throw new Error('expected drag source/target to be visible');

  // Drop just above the second row's midpoint -- computeDropIndex
  // (web/src/ui/rankList.ts) resolves that to index 1, between the two
  // existing rows.
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondRowBox.x + secondRowBox.width / 2, secondRowBox.y + 2, { steps: 10 });
  await page.mouse.up();

  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 3', 'Fixture Album 2']);
  await expect(page.locator('.candidate-done')).toHaveText('You have placed every album in the pool.');
});
