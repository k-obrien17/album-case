import { describe, expect, it, vi } from 'vitest';
import {
  addSearchedAlbum,
  hydrateAlbums,
  insertAtRating,
  reRate,
  resolveInitialState,
  restoreFromCode,
  serverSnapshotIsRicher,
  setRating,
} from './main';
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

describe('reRate (splice at the computed index, not sort-after-append)', () => {
  it('lets a dragged album actually land at index 0 even when the incumbent #1 is rated 10.00', () => {
    // Guaranteed post-backfill state: rank #1 is always exactly the 10.00
    // ceiling. Dropping anything else at index 0 computes an identical
    // 10.00 rating (ratingForDropIndex's top clamp), which used to tie with
    // the incumbent and lose to it under Array.prototype.sort's stability --
    // making position 0 permanently unreachable.
    const ranked: RankedAlbum[] = [
      rankedAlbum('A', 10),
      rankedAlbum('B', 8),
      rankedAlbum('C', 6),
      rankedAlbum('D', 4),
    ];
    const dragged = ranked[3]; // D, dropped at the very top

    const result = reRate(ranked, dragged, 0);

    expect(result.map((a) => a.mbid)).toEqual(['D', 'A', 'B', 'C']);
    expect(result[0].mbid).toBe('D');
    expect(result[0].rating).toBe(10);
  });
});

describe('insertAtRating (splice at the computed index, not sort-after-append)', () => {
  it('places a directly-rated 10 right after an existing incumbent 10.00, not scrambling the list', () => {
    // Same guaranteed post-backfill state as reRate's regression case: rank
    // #1 is always exactly the 10.00 ceiling. Typing "10" for a brand-new
    // candidate used to append-then-sort, and Array.prototype.sort's
    // stability kept the incumbent ahead of the new entry on the tie --
    // silently landing the new album at index 1 while claiming to be a "10".
    // That part of the observed behavior is actually correct (there's no
    // drop-position intent for a typed rating, so a tie resolves by placing
    // the new entry after existing equal-or-higher ones); what append-then-
    // sort got wrong was risking a full re-sort of the whole list on any
    // tie. This proves the new album lands at exactly index 1, immediately
    // after the incumbent, with the rest of the order undisturbed.
    const ranked: RankedAlbum[] = [
      rankedAlbum('A', 10),
      rankedAlbum('B', 8),
      rankedAlbum('C', 6),
      rankedAlbum('D', 4),
    ];
    const newAlbum = album('E');

    const result = insertAtRating(ranked, newAlbum, 10);

    expect(result.map((a) => a.mbid)).toEqual(['A', 'E', 'B', 'C', 'D']);
    expect(result[1].mbid).toBe('E');
    expect(result[1].rating).toBe(10);
  });
});

describe('setRating (remove-then-reinsert via insertAtRating, 0-10 range)', () => {
  // Exercises the REAL exported setRating from main.ts (not a local copy) --
  // filters the album out of the ranked list by global index, then
  // re-inserts it at its new rating via insertAtRating -- never
  // append-then-sort (see insertAtRating's own describe block above for why
  // that breaks on ties).
  const ranked: RankedAlbum[] = [
    rankedAlbum('A', 9),
    rankedAlbum('B', 7),
    rankedAlbum('C', 5),
    rankedAlbum('D', 3),
  ];

  it('moves an album up the list when its rating is raised above a neighbor', () => {
    const result = setRating(ranked, 3, 8); // D at index 3
    expect(result.map((a) => a.mbid)).toEqual(['A', 'D', 'B', 'C']);
    expect(result[1].rating).toBe(8);
  });

  it('moves an album down the list when its rating is lowered below a neighbor', () => {
    const result = setRating(ranked, 0, 4); // A at index 0
    expect(result.map((a) => a.mbid)).toEqual(['B', 'C', 'A', 'D']);
    expect(result[2].rating).toBe(4);
  });

  it('accepts the 0 floor, landing the album at the bottom of the list', () => {
    const result = setRating(ranked, 0, 0); // A at index 0
    expect(result.map((a) => a.mbid)).toEqual(['B', 'C', 'D', 'A']);
    expect(result[3].rating).toBe(0);
  });

  it('accepts the 10 ceiling, landing the album at the top of the list', () => {
    const result = setRating(ranked, 3, 10); // D at index 3
    expect(result.map((a) => a.mbid)).toEqual(['D', 'A', 'B', 'C']);
    expect(result[0].rating).toBe(10);
  });
});

describe('addSearchedAlbum (the exact function onRateSearchResult calls)', () => {
  // Exercises the REAL exported addSearchedAlbum from main.ts -- insert the
  // searched album into the ranked list at the typed rating, then strip it
  // from all three saved lists. A searched album can already be sitting in a
  // saved list (e.g. a prior "Want to listen"); api/ranking.ts rejects any
  // snapshot where an album is both ranked and in a saved list (400
  // ranked_album_in_saved_list), so skipping this step would only surface as
  // a confusing failure on the NEXT save, far from the actual mistake --
  // this exact bug already blocked the canon import once. Calling the real,
  // exported function (rather than re-running the sequence inline in the
  // test body) is what makes this test actually fail if the removal logic
  // is ever deleted from the real implementation.
  it('inserts the album at the correct rating and removes it from every saved list it was sitting in', () => {
    const ranked: RankedAlbum[] = [
      rankedAlbum('A', 9),
      rankedAlbum('B', 7),
      rankedAlbum('C', 5),
    ];
    const found = album('E');
    const lists: SavedLists = {
      wantToListen: [found],
      notHeard: [album('x')],
      dontCare: [found],
    };

    const result = addSearchedAlbum(ranked, lists, found, 8);

    expect(result.ranked.map((a) => a.mbid)).toEqual(['A', 'E', 'B', 'C']);
    expect(result.ranked[1].rating).toBe(8);
    expect(result.lists.wantToListen).toEqual([]);
    expect(result.lists.dontCare).toEqual([]);
    // A list the album was never in is left untouched.
    expect(result.lists.notHeard).toEqual([album('x')]);
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
