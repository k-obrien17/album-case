import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import { bootstrapApp } from './bootstrap';
import { markPendingSync, saveSyncBase } from './syncStatus';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function rankedAlbum(mbid: string, rating = 5.0) {
  return { ...album(mbid), rating };
}

function fakeLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

type RankingRoute = { ok: boolean; status?: number; body?: unknown; reject?: boolean };

function stubFetch(rankingRoute: RankingRoute) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/seed/albums.json')) {
        return { ok: true, json: async () => [album('seed1')] } as unknown as Response;
      }
      if (url.includes('/seed/preferred-artists.json')) {
        return { ok: true, json: async () => ({ by_plays: [] }) } as unknown as Response;
      }
      if (url.includes('/seed/priority-albums.json')) {
        return { ok: false, status: 404 } as unknown as Response;
      }
      if (url.includes('/api/discover-artist')) {
        return { ok: true, json: async () => ({ albums: [] }) } as unknown as Response;
      }
      if (url.includes('/api/ranking')) {
        if (rankingRoute.reject) throw new Error('offline');
        return {
          ok: rankingRoute.ok,
          status: rankingRoute.status ?? 200,
          json: async () => rankingRoute.body ?? {},
        } as unknown as Response;
      }
      throw new Error(`unmocked fetch: ${url}`);
    })
  );
}

describe('bootstrapApp', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports found status, hydrates the server snapshot, and adopts server blocked/curated lists', async () => {
    stubFetch({
      ok: true,
      body: {
        snapshot: {
          ranked: [rankedAlbum('a')],
          lists: { wantToListen: [], notHeard: [], dontCare: [] },
          artist_locks: [],
          blocked_artists: ['Nickelback'],
          curated_skips: ['pitchfork-1980s:47'],
          updated_at: 789,
        },
      },
    });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('found');
    expect(result.pendingSync).toBe(false);
    expect(result.serverSnapshot?.ranked.map((a) => a.mbid)).toEqual(['a']);
    expect(result.blockedArtists).toEqual(['Nickelback']);
    expect(result.curatedSkips).toEqual(new Set(['pitchfork-1980s:47']));
    expect(result.snapshotBaseUpdatedAt).toBe(789);
    expect(result.pool.map((a) => a.mbid)).toContain('seed1');
  });

  it('reports missing status with a null snapshot base when the server has nothing saved yet', async () => {
    stubFetch({ ok: true, body: {} });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('missing');
    expect(result.serverSnapshot).toBeNull();
    expect(result.snapshotBaseUpdatedAt).toBeNull();
  });

  it('reports error status and falls back to the cached sync base when the server is unreachable', async () => {
    stubFetch({ ok: false, reject: true });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('error');
    expect(result.serverSnapshot).toBeNull();
    expect(result.pendingSync).toBe(false);
    expect(result.snapshotBaseUpdatedAt).toBeUndefined();
  });

  it('does not let a found server response overwrite blocked/curated lists when a local edit is pending', async () => {
    markPendingSync();
    saveSyncBase(456);
    stubFetch({
      ok: true,
      body: {
        snapshot: {
          ranked: [rankedAlbum('a')],
          lists: { wantToListen: [], notHeard: [], dontCare: [] },
          artist_locks: [],
          blocked_artists: ['ServerBlocked'],
          curated_skips: ['server-skip:1'],
          updated_at: 999,
        },
      },
    });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('found');
    expect(result.pendingSync).toBe(true);
    expect(result.blockedArtists).toEqual([]);
    expect(result.curatedSkips).toEqual(new Set());
    expect(result.snapshotBaseUpdatedAt).toBe(456);
  });
});
