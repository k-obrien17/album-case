import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { ranked, snapshot } from './support/fixtures';

test('a 401 shows an explicit locked state, stops retrying, and unlocking saves the pending edit', async ({ page }) => {
  const mocks = await installApiMocks(page, {
    snapshot: snapshot([ranked(1, 5)]),
    postRanking: (_body, callIndex) => (callIndex === 1 ? { status: 401 } : { status: 200, body: { updated_at: Date.now() } }),
  });
  const writeKeyHeaders: (string | undefined)[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/ranking') {
      writeKeyHeaders.push(req.headers()['x-album-case-write-key']);
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();
  await page.getByLabel('Edit rating for Fixture Album 1').click();
  const input = page.getByLabel('Rating for Fixture Album 1');
  await input.fill('7.5');
  await input.press('Enter');

  const banner = page.locator('.sync-banner');
  await expect(banner).toContainText('Saving is locked on this device');
  await expect(banner).toHaveAttribute('role', 'status');

  // No retry loop: the locked state waits for the user instead of hammering the server.
  await page.waitForTimeout(5000);
  expect(mocks.postRankingCalls).toHaveLength(1);

  await banner.getByLabel('Write key').fill('secret-123');
  await banner.getByRole('button', { name: 'Unlock & save' }).click();

  await expect(banner).toBeHidden();
  expect(mocks.postRankingCalls).toHaveLength(2);
  expect(writeKeyHeaders).toEqual([undefined, 'secret-123']);
});
