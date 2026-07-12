import { describe, it, expect } from 'vitest';
import type { Album, RankingState } from './types';
import { setAsideAlbum } from './setAside';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function rankedAlbum(mbid: string, rating: number = 5.0) {
  return { ...album(mbid), rating };
}

describe('setAsideAlbum', () => {
  it('always drops any in-progress placement to null', () => {
    const state: RankingState = {
      ranked: [rankedAlbum('a'), rankedAlbum('b')],
      pending: { album: album('c'), lo: 0, hi: 2 },
    };
    const next = setAsideAlbum(state, 'c');
    expect(next.pending).toBeNull();
  });

  it('removes the target album from ranked when present', () => {
    const state: RankingState = {
      ranked: [rankedAlbum('a'), rankedAlbum('b'), rankedAlbum('c')],
      pending: null,
    };
    const next = setAsideAlbum(state, 'b');
    expect(next.ranked.map((a) => a.mbid)).toEqual(['a', 'c']);
  });

  it('leaves the other ranked entries and their order intact', () => {
    const state: RankingState = {
      ranked: [rankedAlbum('x'), rankedAlbum('y'), rankedAlbum('z')],
      pending: null,
    };
    const next = setAsideAlbum(state, 'y');
    expect(next.ranked.map((a) => a.mbid)).toEqual(['x', 'z']);
  });

  it('is a no-op on ranked for an mbid that is not present (still drops pending)', () => {
    const state: RankingState = {
      ranked: [rankedAlbum('a'), rankedAlbum('b')],
      pending: { album: album('c'), lo: 0, hi: 2 },
    };
    const next = setAsideAlbum(state, 'missing');
    expect(next.ranked.map((a) => a.mbid)).toEqual(['a', 'b']);
    expect(next.pending).toBeNull();
  });

  it('does not mutate the input state', () => {
    const original: RankingState = {
      ranked: [rankedAlbum('a'), rankedAlbum('b')],
      pending: { album: album('c'), lo: 0, hi: 2 },
    };
    const snapshotRanked = original.ranked.map((a) => a.mbid);
    setAsideAlbum(original, 'a');
    expect(original.ranked.map((a) => a.mbid)).toEqual(snapshotRanked);
    expect(original.pending).not.toBeNull();
  });
});
