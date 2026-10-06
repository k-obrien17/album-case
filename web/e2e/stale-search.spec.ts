import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { snapshot } from './support/fixtures';

test('a slow first search response never overwrites a faster later one', async ({ page }) => {
  await installApiMocks(page, { snapshot: snapshot([]) });

  // Query "aaa" resolves slowly; "bbb" resolves immediately. main.ts's
  // runMusicBrainzSearch (src/main.ts) discards a response if the live
  // search box has moved on to a different query by the time it lands.
  await page.route('**/api/search-album*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'aaa') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ json: { albums: [{ mbid: 'stale-aaa', title: 'Stale Aaa Result', primary_artist_name: 'Aaa Artist', release_year: 2001, cover_url: '' }] } });
      return;
    }
    await route.fulfill({ json: { albums: [{ mbid: 'fresh-bbb', title: 'Fresh Bbb Result', primary_artist_name: 'Bbb Artist', release_year: 2002, cover_url: '' }] } });
  });

  await page.goto('/');

  // The search fires on its own once typing pauses; wait until the slow
  // "aaa" request is actually in flight before moving on to "bbb".
  const searchBox = page.getByLabel('Search your albums or bands');
  const aaaSent = page.waitForRequest((req) => req.url().includes('/api/search-album') && req.url().includes('q=aaa'));
  await searchBox.fill('aaa');
  await aaaSent;
  await expect(page.getByText('Searching for new albums…')).toBeVisible();

  await searchBox.fill('bbb');

  await expect(page.getByText('Fresh Bbb Result')).toBeVisible();

  // Give the slow "aaa" response time to land and confirm it never clobbers
  // the "bbb" results that are already showing.
  await page.waitForTimeout(1500);
  await expect(page.getByText('Fresh Bbb Result')).toBeVisible();
  await expect(page.getByText('Stale Aaa Result')).toHaveCount(0);
});
