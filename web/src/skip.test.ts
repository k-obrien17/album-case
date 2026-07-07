import { describe, it, expect } from 'vitest';
import type { Album } from './ranking/types';
import { pickCandidate } from './seed';
import { excludedMbids, addToList, type SavedLists } from './lists';
import { loadSkippedAlbums, saveSkippedAlbums } from './skippedAlbums';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function reselect(
  pool: Album[],
  ranked: Album[],
  lists: SavedLists,
  skipped: Set<string>,
  rng: () => number
): Album | null {
  const excluded = excludedMbids(lists);
  for (const mbid of skipped) excluded.add(mbid);
  return pickCandidate(pool, ranked, excluded, rng);
}

const emptyLists = (): SavedLists => ({ wantToListen: [], notHeard: [], dontCare: [] });

describe('skip for now (persisted)', () => {
  it('never re-offers a skipped album while fresh candidates remain', () => {
    const pool = [album('a'), album('b'), album('c')];
    const skipped = new Set(['a']);
    // Draw the first eligible album deterministically (rng -> 0).
    const picked = reselect(pool, [], emptyLists(), skipped, () => 0);
    expect(picked?.mbid).not.toBe('a');
    expect(['b', 'c']).toContain(picked?.mbid);
  });

  it('does not add the skipped album to any saved list or excludedMbids', () => {
    const lists = emptyLists();
    const skipped = new Set<string>();
    skipped.add('a');
    expect(lists.wantToListen).toEqual([]);
    expect(lists.notHeard).toEqual([]);
    expect(lists.dontCare).toEqual([]);
    expect(excludedMbids(lists).has('a')).toBe(false);
    expect(skipped.has('a')).toBe(true);
  });

  it('keeps a skipped album excluded when it is the only remaining candidate', () => {
    const pool = [album('a')];
    const skipped = new Set(['a']);
    const picked = reselect(pool, [], emptyLists(), skipped, () => 0);
    expect(picked).toBeNull();
  });

  it('keeps set-aside albums excluded alongside skipped albums', () => {
    const pool = [album('a'), album('b')];
    let lists = emptyLists();
    lists = addToList(lists, album('b'), 'dontCare'); // permanently set aside
    const skipped = new Set(['a']);
    const picked = reselect(pool, [], lists, skipped, () => 0);
    expect(picked).toBeNull();
    expect(excludedMbids(lists).has('b')).toBe(true);
  });

  it('persists skipped albums across save/load', () => {
    const skipped = new Set(['a', 'b']);
    saveSkippedAlbums(skipped);
    expect(loadSkippedAlbums()).toEqual(new Set(['a', 'b']));
  });
});
