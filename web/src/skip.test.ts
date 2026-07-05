import { describe, it, expect } from 'vitest';
import type { Album } from './ranking/types';
import { pickCandidate } from './seed';
import { excludedMbids, addToList, type SavedLists } from './lists';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

/**
 * Faithful re-implementation of main.ts `reselectCandidate`: select from the
 * pool excluding set-aside lists AND session-deferred skips; if the fresh pool
 * drains while skips remain, rotate the deferred set back in. `deferred` is
 * mutated in place (as it is in main.ts), so the drain path is observable.
 */
function reselect(
  pool: Album[],
  ranked: Album[],
  lists: SavedLists,
  deferred: Set<string>,
  rng: () => number
): Album | null {
  const excluded = excludedMbids(lists);
  for (const mbid of deferred) excluded.add(mbid);
  let candidate = pickCandidate(pool, ranked, excluded, rng);
  if (!candidate && deferred.size > 0) {
    deferred.clear();
    candidate = pickCandidate(pool, ranked, excludedMbids(lists), rng);
  }
  return candidate;
}

const emptyLists = (): SavedLists => ({ wantToListen: [], notHeard: [], dontCare: [] });

describe('skip for now (session-deferred)', () => {
  it('never re-offers a skipped album while fresh candidates remain', () => {
    const pool = [album('a'), album('b'), album('c')];
    const deferred = new Set(['a']);
    // Draw the first eligible album deterministically (rng -> 0).
    const picked = reselect(pool, [], emptyLists(), deferred, () => 0);
    expect(picked?.mbid).not.toBe('a');
    expect(['b', 'c']).toContain(picked?.mbid);
  });

  it('does not add the skipped album to any saved list or excludedMbids', () => {
    const lists = emptyLists();
    const deferred = new Set<string>();
    // Skip == add to the transient set only, never to lists.
    deferred.add('a');
    expect(lists.wantToListen).toEqual([]);
    expect(lists.notHeard).toEqual([]);
    expect(lists.dontCare).toEqual([]);
    expect(excludedMbids(lists).has('a')).toBe(false);
  });

  it('re-offers the skipped album once the fresh pool drains', () => {
    const pool = [album('a')];
    const deferred = new Set(['a']);
    // Fresh pool (pool minus deferred) is empty -> drain rotation clears
    // `deferred` and offers the skipped album again.
    const picked = reselect(pool, [], emptyLists(), deferred, () => 0);
    expect(picked?.mbid).toBe('a');
    expect(deferred.size).toBe(0);
  });

  it('keeps set-aside albums excluded even after a skip drain', () => {
    const pool = [album('a'), album('b')];
    let lists = emptyLists();
    lists = addToList(lists, album('b'), 'dontCare'); // permanently set aside
    const deferred = new Set(['a']);
    // Only 'a' is skipped; 'b' is set aside. Fresh pool empty -> drain 'a'.
    const picked = reselect(pool, [], lists, deferred, () => 0);
    expect(picked?.mbid).toBe('a');
    // 'b' stays excluded regardless of the skip drain.
    expect(excludedMbids(lists).has('b')).toBe(true);
  });
});
