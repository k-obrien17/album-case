import type { Album, ArtistLock } from './types';
import { moveItem } from './order';

/** True if `ranked`'s relative order satisfies every lock. Locked albums no
 *  longer present in `ranked` (e.g. set aside) are simply skipped -- a lock
 *  only constrains members currently in the ranked list. */
export function isValidOrder(ranked: Album[], locks: ArtistLock[]): boolean {
  return locks.every((lock) => {
    const present = ranked
      .filter((album) => lock.order.includes(album.mbid))
      .map((album) => album.mbid);
    const expected = lock.order.filter((mbid) => present.includes(mbid));
    return present.every((mbid, i) => mbid === expected[i]);
  });
}

/** True if moving the row at `from` to `to` (same semantics as `moveItem`)
 *  would break any lock. `from === to` is always false (a no-op move can
 *  never change relative order). */
export function wouldViolateLock(
  ranked: Album[],
  locks: ArtistLock[],
  from: number,
  to: number
): boolean {
  if (from === to) return false;
  return !isValidOrder(moveItem(ranked, from, to), locks);
}

/**
 * Nearest index to `target` (searching outward, below first) that does not
 * violate any lock when moving `from` there. `from` itself is always a safe
 * fallback: moving an item to its own current position is a no-op, so this
 * function always terminates with a defined, valid result.
 */
export function nearestValidDropIndex(
  ranked: Album[],
  locks: ArtistLock[],
  from: number,
  target: number
): number {
  // If the current list is already invalid, return `from` as a safe fallback
  if (!isValidOrder(ranked, locks)) return from;

  const maxTo = ranked.length - 1;
  const clamped = Math.max(0, Math.min(target, maxTo));
  if (!wouldViolateLock(ranked, locks, from, clamped)) return clamped;

  for (let offset = 1; offset <= maxTo; offset++) {
    const below = clamped - offset;
    if (below >= 0 && !wouldViolateLock(ranked, locks, from, below)) return below;
    const above = clamped + offset;
    if (above <= maxTo && !wouldViolateLock(ranked, locks, from, above)) return above;
  }
  return from;
}

/** Capture `artistMbid`'s current relative order within `ranked` as a lock. */
export function buildLock(artistMbid: string, ranked: Album[]): ArtistLock {
  return {
    artistMbid,
    order: ranked.filter((album) => album.primary_artist_mbid === artistMbid).map((a) => a.mbid),
  };
}

/** Replace any existing lock for `lock.artistMbid`, or append it as new. */
export function upsertLock(locks: ArtistLock[], lock: ArtistLock): ArtistLock[] {
  return [...removeLock(locks, lock.artistMbid), lock];
}

/** Drop the lock for `artistMbid`, if any. */
export function removeLock(locks: ArtistLock[], artistMbid: string): ArtistLock[] {
  return locks.filter((lock) => lock.artistMbid !== artistMbid);
}
