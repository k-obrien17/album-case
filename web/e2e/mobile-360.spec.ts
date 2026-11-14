import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { album, ranked, snapshot } from './support/fixtures';

// SHIP-STANDARD.md must-pass: the golden path (drag the candidate to an exact
// rank position) is usable at 360px, with no horizontal scroll and tap
// targets >= 44px.
test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

const rankedAlbums = Array.from({ length: 40 }, (_, i) => ranked(i + 1, 9.9 - i * 0.05));

test('My list at 360px has no horizontal scroll and every row control is at least 44px', async ({ page }) => {
  await installApiMocks(page, { seedAlbums: [album(9999)], snapshot: snapshot(rankedAlbums) });
  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();
  await expect(page.locator('.rank-row')).toHaveCount(40);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const undersized = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rank-row button, .candidate-pill')]
      .map((el) => ({ label: `${el.className} ${el.textContent?.trim().slice(0, 20)}`, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
      .filter((s) => s.w > 0 && (s.w < 44 || s.h < 44))
  );
  expect(undersized).toEqual([]);
});

test('dragging the candidate to a deep row at 360px autoscrolls and lands at the dropped position', async ({ page }) => {
  await installApiMocks(page, { seedAlbums: [album(9999)], snapshot: snapshot(rankedAlbums) });
  await page.goto('/');
  await page.getByRole('button', { name: /^My list/ }).click();
  await page.locator('.candidate-pill').click();
  // With a non-empty list the card leads with this-or-that choices; the drag
  // handle ("or drag to place") sits under "More ways to rank" on phones.
  await page.locator('.candidate-more-toggle').click();

  const handle = page.locator('.candidate-drag');
  await expect(handle).toContainText('Fixture Album 9999');
  const box = await handle.boundingBox();
  if (!box) throw new Error('expected the candidate drag handle to be visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 740 - 20, { steps: 8 });

  const target = page.locator('.rank-row', { hasText: 'Fixture Album 30' });
  let targetBox = await target.boundingBox();
  const deadline = Date.now() + 20_000;
  while ((!targetBox || targetBox.y < 160 || targetBox.y > 560) && Date.now() < deadline) {
    await page.waitForTimeout(60);
    targetBox = await target.boundingBox();
  }
  if (!targetBox || targetBox.y < 160 || targetBox.y > 560) throw new Error('autoscroll never brought the target row into view');
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 2, { steps: 6 });
  await page.mouse.up();

  const titles = await page.locator('.rank-row .rank-title').allTextContents();
  expect(titles.indexOf('Fixture Album 9999')).toBe(29);
  expect(titles).toHaveLength(41);
});
