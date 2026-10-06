import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { snapshot } from './support/fixtures';

test('"Search everywhere" re-runs the album search live', async ({ page }) => {
  await installApiMocks(page, { snapshot: snapshot([]) });
  const albumSearches: string[] = [];
  await page.route('**/api/search-album*', async (route) => {
    const url = new URL(route.request().url());
    albumSearches.push(url.search);
    const live = url.searchParams.get('live') === '1';
    await route.fulfill({
      json: {
        albums: [{
          mbid: live ? 'live-1' : 'cat-1',
          title: live ? 'Live Result' : 'Catalog Result',
          primary_artist_name: 'Some Artist',
          release_year: 2001,
          cover_url: '',
        }],
      },
    });
  });

  // Typed from the default screen: the search bar is on every view and
  // searches for new albums on its own once typing pauses.
  await page.goto('/');
  const searchBox = page.getByLabel('Search your albums or bands');
  await searchBox.fill('zzz');
  await expect(page.getByText('Catalog Result')).toBeVisible();

  await page.getByRole('button', { name: 'Search everywhere' }).click();

  await expect(page.getByText('Live Result')).toBeVisible();
  expect(albumSearches[0]).not.toContain('live=1');
  expect(albumSearches.at(-1)).toContain('live=1');

  // Esc clears the search and returns to the screen it started from.
  await searchBox.press('Escape');
  await expect(searchBox).toHaveValue('');
  await expect(page.getByRole('heading', { name: /Find albums I/ })).toBeVisible();
});

test('"Search everywhere" is offered when nothing is found', async ({ page }) => {
  await installApiMocks(page, { snapshot: snapshot([]), searchAlbumResults: [] });

  await page.goto('/');
  await page.getByLabel('Search your albums or bands').fill('zzz');

  await expect(page.getByText('No albums or bands found.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search everywhere' })).toBeVisible();
});
