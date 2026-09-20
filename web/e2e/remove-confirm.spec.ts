import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { ranked, snapshot } from './support/fixtures';

test('removing a ranked row requires confirmation and can be cancelled', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 9), ranked(2, 6)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Ranked list/ }).click();

  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  // Playwright auto-dismisses dialogs by default when no handler is
  // registered -- that's the "cancel" path here.
  await page.getByLabel('Remove Fixture Album 1 from ranked list').click();

  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);
});

test('confirming removal takes the row out of the ranked list', async ({ page }) => {
  await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 9), ranked(2, 6)]),
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Ranked list/ }).click();

  const rows = page.locator('.rank-row .rank-title');
  await expect(rows).toHaveText(['Fixture Album 1', 'Fixture Album 2']);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Remove Fixture Album 1 from ranked list').click();

  await expect(rows).toHaveText(['Fixture Album 2']);
  await expect(page.locator('.rank-status')).toContainText("Don't care");
});
