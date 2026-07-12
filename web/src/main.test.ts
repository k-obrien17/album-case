import { describe, expect, it, vi } from 'vitest';
import { hydrateAlbums, resolveInitialState, restoreFromCode, serverSnapshotIsRicher } from './main';
import type { SavedLists } from './lists';
import type { Album, RankedAlbum, RankingState } from './ranking/types';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function albumWithArtistMbid(mbid: string, artistMbid: string): Album {
  return { ...album(mbid), primary_artist_mbid: artistMbid };
}

function rankedAlbum(mbid: string, rating: number = 5.0): RankedAlbum {
  return { ...album(mbid), rating };
}

const VALID = '66666666-6666-4666-8666-666666666666';

describe('resolveInitialState (server-authoritative load-on-open)', () => {
  it('prefers the full server snapshot over the localStorage cache', () => {
    const server = {
      ranked: [rankedAlbum('a')],
      lists: {
        wantToListen: [album('b')],
        notHeard: [],
        dontCare: [album('c')],
      } as SavedLists,
      artistLocks: [{ artistMbid: VALID, order: ['a'] }],
    };
    const cached = {
      state: { ranked: [album('x')], pending: null } as RankingState,
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [],
    };

    const resolved = resolveInitialState(server, cached);

    expect(resolved.fromServer).toBe(true);
    expect(resolved.state.ranked).toEqual([rankedAlbum('a')]);
    // dontCare round-trips through the snapshot into the resolved state.
    expect(resolved.lists.dontCare).toEqual([album('c')]);
    expect(resolved.lists.wantToListen).toEqual([album('b')]);
    expect(resolved.artistLocks).toEqual(server.artistLocks);
  });

  it('falls back to the localStorage cache when the server has nothing', () => {
    const cached = {
      state: { ranked: [album('x')], pending: null } as RankingState,
      lists: { wantToListen: [album('y')], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [{ artistMbid: VALID, order: ['x'] }],
    };

    const resolved = resolveInitialState(null, cached);

    expect(resolved.fromServer).toBe(false);
    expect(resolved.state.ranked).toEqual([album('x')]);
    expect(resolved.lists.wantToListen).toEqual([album('y')]);
    expect(resolved.artistLocks).toEqual(cached.artistLocks);
  });
});

describe('serverSnapshotIsRicher', () => {
  it('detects when the server has more ranked/list albums than the local cache', () => {
    const server = {
      ranked: [album('a'), album('b')],
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [],
    };
    const cached = {
      state: { ranked: [album('a')], pending: null } as RankingState,
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [],
    };

    expect(serverSnapshotIsRicher(server, cached)).toBe(true);
  });

  it('detects when the server has artist locks missing from the local cache', () => {
    const server = {
      ranked: [album('a')],
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [{ artistMbid: VALID, order: ['a', 'b'] }],
    };
    const cached = {
      state: { ranked: [album('a')], pending: null } as RankingState,
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [],
    };

    expect(serverSnapshotIsRicher(server, cached)).toBe(true);
  });

  it('keeps local pending work when the cache is richer than the server', () => {
    const server = {
      ranked: [album('a')],
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [],
    };
    const cached = {
      state: { ranked: [album('a'), album('b')], pending: null } as RankingState,
      lists: { wantToListen: [], notHeard: [], dontCare: [] } as SavedLists,
      artistLocks: [],
    };

    expect(serverSnapshotIsRicher(server, cached)).toBe(false);
  });
});

describe('hydrateAlbums', () => {
  it('fills missing artist mbids from the current pool without replacing saved ordering', () => {
    const saved = [album('a')];
    const pool = new Map([['a', albumWithArtistMbid('a', '11111111-1111-4111-8111-111111111111')]]);

    expect(hydrateAlbums(saved, pool)).toEqual([
      albumWithArtistMbid('a', '11111111-1111-4111-8111-111111111111'),
    ]);
  });
});

describe('restoreFromCode', () => {
  it('rejects an invalid code without loading or adopting a session', async () => {
    const setSession = vi.fn();
    const load = vi.fn();

    const outcome = await restoreFromCode('not-a-code', [], { setSession, load });

    expect(outcome).toEqual({ status: 'invalid' });
    expect(load).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('adopts the session and returns the snapshot when one is found', async () => {
    const snapshot = {
      state: { ranked: [album('a')], pending: null } as RankingState,
      lists: { wantToListen: [album('b')], notHeard: [], dontCare: [] } as SavedLists,
    };
    const setSession = vi.fn();
    const load = vi.fn().mockResolvedValue(snapshot);

    // Whitespace around the code is tolerated; the trimmed id is what gets set.
    const outcome = await restoreFromCode(`  ${VALID}  `, [album('a'), album('b')], {
      setSession,
      load,
    });

    expect(setSession).toHaveBeenCalledWith(VALID);
    expect(outcome).toEqual({
      status: 'restored',
      state: snapshot.state,
      lists: snapshot.lists,
    });
  });

  it('returns not-found and leaves the session untouched when no snapshot exists', async () => {
    const setSession = vi.fn();
    const load = vi.fn().mockResolvedValue(null);

    const outcome = await restoreFromCode(VALID, [], { setSession, load });

    expect(outcome).toEqual({ status: 'not-found' });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('returns error (never throws) when the load fails, session untouched', async () => {
    const setSession = vi.fn();
    const load = vi.fn().mockRejectedValue(new Error('offline'));

    const outcome = await restoreFromCode(VALID, [], { setSession, load });

    expect(outcome).toEqual({ status: 'error' });
    expect(setSession).not.toHaveBeenCalled();
  });
});
