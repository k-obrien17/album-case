import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import { bootstrapApp } from './bootstrap';
import { hasSyncConflict, markPendingSync, saveSyncBase } from './syncStatus';

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

function stubFetch(
  rankingRoute: RankingRoute,
  extra: { seed?: Album[]; discovered?: Album[] } = {}
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/seed/albums.json')) {
        return { ok: true, json: async () => extra.seed ?? [album('seed1')] } as unknown as Response;
      }
      if (url.includes('/seed/preferred-artists.json')) {
        return { ok: true, json: async () => ({ by_plays: [] }) } as unknown as Response;
      }
      if (url.includes('/seed/priority-albums.json')) {
        return { ok: false, status: 404 } as unknown as Response;
      }
      if (url.includes('/api/discover-artist')) {
        return { ok: true, json: async () => ({ albums: extra.discovered ?? [] }) } as unknown as Response;
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
    expect(result.blockedArtists).toEqual([]);
    expect(result.curatedSkips).toEqual(new Set());
  });

  // loadSeedPool caches module-level, so tests that need their own seed pool
  // re-import bootstrap against a fresh module registry.
  async function freshBootstrapApp(ownerId: string) {
    vi.resetModules();
    const { bootstrapApp: fresh } = await import('./bootstrap');
    return fresh(ownerId);
  }

  it('overlays discovered genres onto a seed-pool album that has none', async () => {
    stubFetch(
      { ok: true, body: {} },
      { seed: [album('seed1')], discovered: [{ ...album('seed1'), genres: ['shoegaze'] }] }
    );

    const result = await freshBootstrapApp('11111111-1111-4111-8111-111111111111');

    const seedEntry = result.pool.find((a) => a.mbid === 'seed1');
    expect(seedEntry?.genres).toEqual(['shoegaze']);
    // Still one pool entry: the discovered row overlays, never duplicates.
    expect(result.pool.filter((a) => a.mbid === 'seed1')).toHaveLength(1);
  });

  it('keeps a pool album\'s own genres when a discovered row differs', async () => {
    stubFetch(
      { ok: true, body: {} },
      {
        seed: [{ ...album('seed1'), genres: ['folk'] }],
        discovered: [{ ...album('seed1'), genres: ['rock'] }],
      }
    );

    const result = await freshBootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.pool.find((a) => a.mbid === 'seed1')?.genres).toEqual(['folk']);
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
    expect(hasSyncConflict()).toBe(true);
  });
});
