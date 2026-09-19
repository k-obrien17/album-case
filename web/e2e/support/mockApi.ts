import type { Page } from '@playwright/test';
import type { Album } from '../../src/ranking/types';
import { album, type SnapshotFixture } from './fixtures';

// loadSeedPool (src/seed.ts) throws if /seed/albums.json comes back empty,
// which crashes main()'s boot before #app ever renders. Every spec needs a
// non-empty pool even when it doesn't care about the candidate, so this is
// the fallback when a spec doesn't pass its own seedAlbums.
const DEFAULT_SEED_ALBUMS: Album[] = [album(999)];

export type PostRankingResult = { status: number; body?: unknown };

export type ApiMockOptions = {
  seedAlbums?: Album[];
  snapshot?: SnapshotFixture | null;
  discoveredAlbums?: Album[];
  searchAlbumResults?: Album[];
  searchArtistResults?: unknown[];
  /** Called for every POST /api/ranking. `callIndex` is 1-based, so a test
   *  can make the Nth save behave differently (e.g. conflict once, then
   *  succeed on retry). Defaults to always succeeding. */
  postRanking?: (body: unknown, callIndex: number) => PostRankingResult;
};

export type ApiMocks = {
  /** Any request that hit neither the seed nor the api dispatch table.
   *  Assert this is empty at the end of a test (or use expectNoUnexpectedRequests). */
  unexpectedRequests: string[];
  /** Every POST /api/ranking body, in call order. */
  postRankingCalls: unknown[];
};

/**
 * Installs a full network boundary for the app: every `/seed/**` and
 * `/api/**` request is served from fixtures, never a real server. Anything
 * not in the dispatch table below fails loudly (500 + recorded in
 * `unexpectedRequests`) instead of silently falling through to the app's
 * offline-degradation paths, which would hide a spec that's exercising the
 * wrong endpoint.
 *
 * A spec can layer a more specific `page.route()` on top of this (e.g. to
 * simulate a slow response for one query) -- Playwright runs routes in
 * reverse-registration order, so a route added after this one takes
 * precedence for URLs it matches.
 */
export async function installApiMocks(page: Page, options: ApiMockOptions = {}): Promise<ApiMocks> {
  const unexpectedRequests: string[] = [];
  const postRankingCalls: unknown[] = [];
  const snapshotFixture = options.snapshot ?? null;

  await page.route('**/seed/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/seed/albums.json') {
      await route.fulfill({ json: options.seedAlbums ?? DEFAULT_SEED_ALBUMS });
      return;
    }
    if (url.pathname === '/seed/preferred-artists.json') {
      await route.fulfill({ json: { by_plays: [] } });
      return;
    }
    if (url.pathname === '/seed/priority-albums.json') {
      await route.fulfill({ json: { version: 'e2e-fixture', albums: [] } });
      return;
    }
    unexpectedRequests.push(`GET ${url.pathname}`);
    await route.fulfill({ status: 500, body: `unmocked seed request: ${url.pathname}` });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/ranking') {
      await route.fulfill({ json: { snapshot: snapshotFixture } });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/ranking') {
      const body = request.postDataJSON();
      postRankingCalls.push(body);
      const result = options.postRanking?.(body, postRankingCalls.length) ?? {
        status: 200,
        body: { updated_at: Date.now() },
      };
      await route.fulfill({ status: result.status, json: result.body ?? {} });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/discover-artist') {
      await route.fulfill({ json: { albums: options.discoveredAlbums ?? [] } });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/search-album') {
      await route.fulfill({ json: { albums: options.searchAlbumResults ?? [] } });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/search-artist') {
      await route.fulfill({ json: { artists: options.searchArtistResults ?? [] } });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/atom') {
      await route.fulfill({ status: 201, json: { ok: true } });
      return;
    }

    unexpectedRequests.push(`${method} ${url.pathname}`);
    await route.fulfill({ status: 500, body: `unmocked api request: ${method} ${url.pathname}` });
  });

  return { unexpectedRequests, postRankingCalls };
}
