import { describe, it, expect } from 'vitest';
import type { Album, ArtistLock } from './types';
import {
  isValidOrder,
  wouldViolateLock,
  nearestValidDropIndex,
  buildLock,
  upsertLock,
  removeLock,
} from './locks';

function album(mbid: string, artistMbid?: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${artistMbid ?? mbid}`,
    ...(artistMbid ? { primary_artist_mbid: artistMbid } : {}),
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

const ARTIST_A = '11111111-1111-4111-8111-111111111111';
const ARTIST_B = '22222222-2222-4222-8222-222222222222';

describe('isValidOrder', () => {
  it('is satisfied when locked albums keep their relative order, interleaved or not', () => {
    const ranked = [
      album('a1', ARTIST_A),
      album('b1', ARTIST_B),
      album('a2', ARTIST_A),
      album('b2', ARTIST_B),
    ];
    const locks: ArtistLock[] = [
      { artistMbid: ARTIST_A, order: ['a1', 'a2'] },
      { artistMbid: ARTIST_B, order: ['b1', 'b2'] },
    ];
    expect(isValidOrder(ranked, locks)).toBe(true);
  });

  it('is violated when a locked pair is swapped', () => {
    const ranked = [album('a2', ARTIST_A), album('a1', ARTIST_A)];
    const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1', 'a2'] }];
    expect(isValidOrder(ranked, locks)).toBe(false);
  });

  it('ignores locked albums that are not currently in ranked (set aside)', () => {
    const ranked = [album('a1', ARTIST_A)];
    const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1', 'a2'] }];
    expect(isValidOrder(ranked, locks)).toBe(true);
  });

  it('is trivially satisfied with no locks', () => {
    expect(isValidOrder([album('a1')], [])).toBe(true);
  });
});

describe('wouldViolateLock', () => {
  const ranked = [
    album('a1', ARTIST_A),
    album('b1', ARTIST_B),
    album('a2', ARTIST_A),
  ];
  const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1', 'a2'] }];

  it('is false for a move that keeps the lock intact', () => {
    // move b1 (index 1) to the end -- a1/a2 relative order untouched
    expect(wouldViolateLock(ranked, locks, 1, 2)).toBe(false);
  });

  it('is true for a move that would cross the locked pair', () => {
    // move a1 (index 0) past a2 (to the end) -- would put a2 before a1
    expect(wouldViolateLock(ranked, locks, 0, 2)).toBe(true);
  });

  it('is false for a no-op move (from === to)', () => {
    expect(wouldViolateLock(ranked, locks, 0, 0)).toBe(false);
  });
});

describe('nearestValidDropIndex', () => {
  const ranked = [
    album('a1', ARTIST_A),
    album('b1', ARTIST_B),
    album('a2', ARTIST_A),
    album('b2', ARTIST_B),
  ];
  const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1', 'a2'] }];

  it('returns the target unchanged when it does not violate any lock', () => {
    expect(nearestValidDropIndex(ranked, locks, 1, 3)).toBe(3);
  });

  it('snaps to the nearest valid index when the target would violate a lock', () => {
    // moving a1 (0) to index 3 would put it after a2 -- invalid; nearest
    // valid index below 3 is 2 (a1 lands right before a2, still before it)
    const result = nearestValidDropIndex(ranked, locks, 0, 3);
    expect(wouldViolateLock(ranked, locks, 0, result)).toBe(false);
  });

  it('falls back to `from` (a guaranteed no-op) when every other index is invalid', () => {
    const tight = [album('a1', ARTIST_A), album('a2', ARTIST_A)];
    const tightLocks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a2', 'a1'] }];
    // ranked is already invalid relative to the lock; from itself must still
    // be returned so the function always terminates with a defined value.
    expect(nearestValidDropIndex(tight, tightLocks, 0, 1)).toBe(0);
  });
});

describe('buildLock', () => {
  it('captures the current relative order of one artist\'s ranked albums', () => {
    const ranked = [album('a2', ARTIST_A), album('b1', ARTIST_B), album('a1', ARTIST_A)];
    expect(buildLock(ARTIST_A, ranked)).toEqual({ artistMbid: ARTIST_A, order: ['a2', 'a1'] });
  });
});

describe('upsertLock / removeLock', () => {
  it('upsertLock replaces an existing lock for the same artist', () => {
    const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1'] }];
    const next = upsertLock(locks, { artistMbid: ARTIST_A, order: ['a2', 'a1'] });
    expect(next).toEqual([{ artistMbid: ARTIST_A, order: ['a2', 'a1'] }]);
  });

  it('upsertLock appends a lock for a new artist', () => {
    const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1'] }];
    const next = upsertLock(locks, { artistMbid: ARTIST_B, order: ['b1'] });
    expect(next).toEqual([
      { artistMbid: ARTIST_A, order: ['a1'] },
      { artistMbid: ARTIST_B, order: ['b1'] },
    ]);
  });

  it('removeLock drops the lock for the given artist and leaves others intact', () => {
    const locks: ArtistLock[] = [
      { artistMbid: ARTIST_A, order: ['a1'] },
      { artistMbid: ARTIST_B, order: ['b1'] },
    ];
    expect(removeLock(locks, ARTIST_A)).toEqual([{ artistMbid: ARTIST_B, order: ['b1'] }]);
  });
});
