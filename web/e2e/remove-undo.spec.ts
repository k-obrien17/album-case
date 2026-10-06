import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { ranked, snapshot } from './support/fixtures';

test('removing a ranked row is one tap and can be undone', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 9), ranked(2, 6)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();

  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  // No confirm dialog: a dialog here would fail the test, since Playwright
  // would auto-dismiss it and the row would stay put.
  await page.getByLabel('Remove Fixture Album 1 from ranked list').click();
  await expect(rows).toHaveText(['Fixture Album 2']);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('removal takes the row out of the ranked list and says where it went', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 9), ranked(2, 6)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();

  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  await page.getByLabel('Remove Fixture Album 1 from ranked list').click();

  await expect(rows).toHaveText(['Fixture Album 2']);
  await expect(page.locator('.rank-status')).toContainText("Don't care");
  await expect(page.getByRole('button', { name: /^Don't care 1$/ })).toBeVisible();
});
