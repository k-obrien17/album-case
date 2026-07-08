import { describe, it, expect } from 'vitest';
import type { Album } from './ranking/types';
import type { SavedLists } from './lists';
import { artistAlbumsFor, mapFilteredReorderToGlobal } from './artistLockAlbums';

function album(mbid: string, artistMbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${artistMbid}`,
    primary_artist_mbid: artistMbid,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

const ARTIST_A = '11111111-1111-4111-8111-111111111111';
const ARTIST_B = '22222222-2222-4222-8222-222222222222';
const emptyLists = (): SavedLists => ({ wantToListen: [], notHeard: [], dontCare: [] });

describe('artistAlbumsFor', () => {
  it('splits ranked-by-this-artist from not-yet-ranked-by-this-artist', () => {
    const ranked = [album('a1', ARTIST_A), album('b1', ARTIST_B)];
    const lists: SavedLists = { ...emptyLists(), wantToListen: [album('a2', ARTIST_A)] };
    const pool = [album('a1', ARTIST_A), album('a2', ARTIST_A), album('a3', ARTIST_A), album('b1', ARTIST_B)];

    const result = artistAlbumsFor(ARTIST_A, ranked, lists, pool);

    expect(result.ranked.map((a) => a.mbid)).toEqual(['a1']);
    // a2 (saved list) and a3 (still a bare candidate) both count as unranked
    expect(result.unranked.map((a) => a.mbid).sort()).toEqual(['a2', 'a3']);
  });

  it('never duplicates an album across ranked and unranked', () => {
    const ranked = [album('a1', ARTIST_A)];
    const pool = [album('a1', ARTIST_A)]; // still in pool, but already ranked
    const result = artistAlbumsFor(ARTIST_A, ranked, emptyLists(), pool);
    expect(result.ranked.map((a) => a.mbid)).toEqual(['a1']);
    expect(result.unranked).toEqual([]);
  });

  it('returns empty groups for an artist with no known albums', () => {
    const result = artistAlbumsFor(ARTIST_A, [], emptyLists(), []);
    expect(result).toEqual({ ranked: [], unranked: [] });
  });
});

describe('mapFilteredReorderToGlobal', () => {
  it('maps a within-artist filtered move to the equivalent global indices', () => {
    // global: [a1, b1, a2, b2] -- artist A rows sit at global 0 and 2
    const ranked = [album('a1', ARTIST_A), album('b1', ARTIST_B), album('a2', ARTIST_A), album('b2', ARTIST_B)];
    // filtered (A-only) view: [a1, a2] -- move filtered index 0 -> 1 (a1 after a2)
    const mapped = mapFilteredReorderToGlobal(ranked, ARTIST_A, 0, 1);
    expect(mapped).toEqual({ from: 0, to: 2 });
  });

  it('maps moving the last filtered row to the front', () => {
    const ranked = [album('a1', ARTIST_A), album('b1', ARTIST_B), album('a2', ARTIST_A)];
    const mapped = mapFilteredReorderToGlobal(ranked, ARTIST_A, 1, 0);
    expect(mapped).toEqual({ from: 2, to: 0 });
  });

  it('returns null for an out-of-range filtered `from`', () => {
    const ranked = [album('a1', ARTIST_A)];
    expect(mapFilteredReorderToGlobal(ranked, ARTIST_A, 5, 0)).toBeNull();
  });

  it('anchors a move to the front of the artist cluster without jumping past a leading unrelated row', () => {
    // global: [Z, A1, W, A2] -- Z and W belong to a different artist
    const ranked = [album('z1', ARTIST_B), album('a1', ARTIST_A), album('w1', ARTIST_B), album('a2', ARTIST_A)];
    // filtered (A-only) view: [a1, a2] -- move filtered index 1 (a2) to filtered position 0
    const mapped = mapFilteredReorderToGlobal(ranked, ARTIST_A, 1, 0);
    // a2 lands right before a1 (global index 1), not at global index 0 (which would jump it above Z)
    expect(mapped).toEqual({ from: 3, to: 1 });
  });

  it('is a true no-op when dragging a single-row artist cluster to its own position', () => {
    const ranked = [album('z1', ARTIST_B), album('a1', ARTIST_A)];
    const mapped = mapFilteredReorderToGlobal(ranked, ARTIST_A, 0, 0);
    expect(mapped).toEqual({ from: 1, to: 1 });
  });
});
