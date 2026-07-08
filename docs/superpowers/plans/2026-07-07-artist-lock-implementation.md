# Artist Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner rank one artist's albums against each other in an isolated view, lock that relative order, and have the global drag-to-place ranked list refuse any drag that would violate an active lock.

**Architecture:** A new `ArtistLock` type (`{ artistMbid, order: string[] }`) is tracked as a third top-level piece of app state in `main.ts`, alongside the existing `state: RankingState` and `lists: SavedLists` — persisted the same way (`localStorage` + Turso snapshot), enforced by a pure `isValidOrder`/`wouldViolateLock` pair, and surfaced through a new artist-scoped view built on top of the existing `mountRankList` component (extended with a few new optional options) rather than a parallel drag implementation.

**Tech Stack:** Vite + TypeScript, Vitest, `@libsql/client` (Turso), Vercel serverless functions. No new dependencies.

## Global Constraints

- File size: keep new/modified files under ~300 lines where practical (project convention; `main.ts` and `rankList.ts` are already over this before the feature — don't make either worse than necessary).
- Safe DOM construction only (`createElement`/`textContent`), never `innerHTML`.
- Mobile is the primary device: tap targets ≥ 44px, usable at 360px width, no horizontal scroll.
- `web/src/ui/*.ts` is not unit-tested in this codebase today (verified: no `.test.ts` files under `src/ui/`) — verify those changes by running `npm run dev` and exercising the flow, not by writing new DOM tests. Every other new/modified file gets Vitest coverage.
- Never put `ALBUM_CASE_WRITE_KEY` in source, screenshots, logs, or `VITE_*` env vars.
- Don't use Elo or any model allowing self-contradicting picks — the ranked list stays a strict total order; a lock is a constraint on that order, not an alternate model.
- Commands: `cd web && npm run test` (Vitest, single run), `cd web && npm run build` (`tsc && vite build` — this is the real type-check gate since there's no separate `tsc --noEmit` script), `cd web && npm run dev` (manual verification).

---

## File Structure

**New files:**
- `web/src/ranking/locks.ts` + `web/src/ranking/locks.test.ts` — pure `ArtistLock` validity/enforcement/construction: `isValidOrder`, `wouldViolateLock`, `nearestValidDropIndex`, `buildLock`, `upsertLock`, `removeLock`.
- `web/src/artistLockAlbums.ts` + `web/src/artistLockAlbums.test.ts` — pure grouping/index-mapping for the scoped view: `artistAlbumsFor`, `mapFilteredReorderToGlobal`.
- `web/src/artistLocksStorage.ts` + `web/src/artistLocksStorage.test.ts` — `localStorage` persistence for `ArtistLock[]`, mirrors `lists.ts`.
- `web/src/ui/artistLockView.ts` — the scoped view: header + Lock/Unlock control, a `mountRankList` instance filtered to one artist for already-ranked albums, a small hand-rolled list of "#/Place" rows for not-yet-ranked albums.

**Modified files:**
- `web/src/ranking/types.ts` — add the `ArtistLock` type. `RankingState` is unchanged.
- `web/src/rankingSync.ts` + `web/src/rankingSync.test.ts` — thread `artistLocks: ArtistLock[]` through the snapshot payload/response.
- `web/api/_schema.js` — add `artist_locks_json TEXT` to `CREATE_RANKING_SNAPSHOTS_TABLE`.
- `web/api/ranking.ts` + `web/api/ranking.test.ts` — idempotent `ALTER TABLE` for existing deployments, validate/read/write `artist_locks_json`.
- `web/src/ui/rankList.ts` — new optional `RankListOptions` fields (`onOpenArtistLock`, `getLockedArtistMbids`, `getNearestValidDrop`, `hideCandidateColumn`, `emptyRankedMessage`); a new row icon; live drop-index snapping.
- `web/src/main.ts` + `web/src/main.test.ts` — new `artistLocks` state variable + persistence, `resolveInitialState` gains a third input/output, new handlers, `ViewMode` gains `'artistLock'`.
- `web/src/style.css` — new classes for the lock icon and the scoped view.

---

### Task 1: `ArtistLock` type + pure enforcement module

**Files:**
- Modify: `web/src/ranking/types.ts`
- Create: `web/src/ranking/locks.ts`
- Test: `web/src/ranking/locks.test.ts`

**Interfaces:**
- Produces: `ArtistLock = { artistMbid: string; order: string[] }` (exported from `ranking/types.ts`); `isValidOrder(ranked: Album[], locks: ArtistLock[]): boolean`; `wouldViolateLock(ranked: Album[], locks: ArtistLock[], from: number, to: number): boolean`; `nearestValidDropIndex(ranked: Album[], locks: ArtistLock[], from: number, target: number): number`; `buildLock(artistMbid: string, ranked: Album[]): ArtistLock`; `upsertLock(locks: ArtistLock[], lock: ArtistLock): ArtistLock[]`; `removeLock(locks: ArtistLock[], artistMbid: string): ArtistLock[]` — all from `web/src/ranking/locks.ts`.

- [ ] **Step 1: Add the `ArtistLock` type**

Add to `web/src/ranking/types.ts`, after the existing `Album` type (do not touch `RankingState`):

```ts
/**
 * A frozen relative order for one artist's albums. `order` holds album mbids
 * in locked relative order (index 0 = most preferred). Enforcement only
 * checks the relative order of these mbids within `ranked` -- other albums
 * may sit anywhere between/around them.
 */
export type ArtistLock = {
  artistMbid: string;
  order: string[];
};
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/ranking/locks.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ranking/locks.test.ts`
Expected: FAIL — `Cannot find module './locks'` (the module doesn't exist yet).

- [ ] **Step 4: Implement `web/src/ranking/locks.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/ranking/locks.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/ranking/types.ts web/src/ranking/locks.ts web/src/ranking/locks.test.ts
git commit -m "feat: add ArtistLock type and pure lock-enforcement module"
```

---

### Task 2: Pure album grouping + filtered-to-global index mapping

**Files:**
- Create: `web/src/artistLockAlbums.ts`
- Test: `web/src/artistLockAlbums.test.ts`

**Interfaces:**
- Consumes: `Album`, `ArtistLock` (`ranking/types.ts`); `SavedLists` (`lists.ts`).
- Produces: `type ArtistLockAlbums = { ranked: Album[]; unranked: Album[] }`; `artistAlbumsFor(artistMbid: string, ranked: Album[], lists: SavedLists, pool: Album[]): ArtistLockAlbums`; `mapFilteredReorderToGlobal(ranked: Album[], artistMbid: string, filteredFrom: number, filteredTo: number): { from: number; to: number } | null`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/artistLockAlbums.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/artistLockAlbums.test.ts`
Expected: FAIL — `Cannot find module './artistLockAlbums'`.

- [ ] **Step 3: Implement `web/src/artistLockAlbums.ts`**

```ts
import type { Album } from './ranking/types';
import type { SavedLists } from './lists';

export type ArtistLockAlbums = {
  /** This artist's albums currently in the global ranked list, in current
   *  relative order. */
  ranked: Album[];
  /** This artist's albums not yet in the global ranked list: saved-list
   *  entries plus still-a-bare-candidate pool entries, de-duped. */
  unranked: Album[];
};

/** Group one artist's known albums into ranked/unranked, for the
 *  artist-scoped lock view. `pool` is the full candidate pool (already
 *  includes discovered albums by the time this is called). */
export function artistAlbumsFor(
  artistMbid: string,
  ranked: Album[],
  lists: SavedLists,
  pool: Album[]
): ArtistLockAlbums {
  const byArtist = (album: Album) => album.primary_artist_mbid === artistMbid;

  const rankedAlbums = ranked.filter(byArtist);
  const rankedIds = new Set(rankedAlbums.map((a) => a.mbid));

  const savedAlbums = [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare].filter(byArtist);
  const poolAlbums = pool.filter(byArtist);

  const seen = new Set<string>();
  const unranked: Album[] = [];
  for (const album of [...savedAlbums, ...poolAlbums]) {
    if (rankedIds.has(album.mbid) || seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    unranked.push(album);
  }

  return { ranked: rankedAlbums, unranked };
}

/**
 * Translate a reorder expressed in the artist-filtered sub-list's own index
 * space (`filteredFrom`/`filteredTo`, matching `RankListOptions.onReorder`
 * semantics: `to` is interpreted post-removal) into the equivalent
 * `{ from, to }` against the full global `ranked` array. Returns `null` if
 * `filteredFrom` doesn't land on one of this artist's rows.
 */
export function mapFilteredReorderToGlobal(
  ranked: Album[],
  artistMbid: string,
  filteredFrom: number,
  filteredTo: number
): { from: number; to: number } | null {
  const byArtist = (album: Album) => album.primary_artist_mbid === artistMbid;
  const filteredGlobalIndices = ranked
    .map((album, i) => ({ album, i }))
    .filter(({ album }) => byArtist(album))
    .map(({ i }) => i);

  if (filteredFrom < 0 || filteredFrom >= filteredGlobalIndices.length) return null;
  const from = filteredGlobalIndices[filteredFrom];

  const withoutMoved = ranked.filter((_, i) => i !== from);
  const remainingFilteredIndices = withoutMoved
    .map((album, i) => ({ album, i }))
    .filter(({ album }) => byArtist(album))
    .map(({ i }) => i);

  const clampedTo = Math.max(0, Math.min(filteredTo, remainingFilteredIndices.length));
  const to =
    clampedTo < remainingFilteredIndices.length
      ? remainingFilteredIndices[clampedTo]
      : withoutMoved.length;

  return { from, to };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/artistLockAlbums.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/artistLockAlbums.ts web/src/artistLockAlbums.test.ts
git commit -m "feat: add artist-scoped album grouping and index mapping"
```

---

### Task 3: Client-side lock persistence (`localStorage`)

**Files:**
- Create: `web/src/artistLocksStorage.ts`
- Test: `web/src/artistLocksStorage.test.ts`

**Interfaces:**
- Consumes: `ArtistLock` (`ranking/types.ts`).
- Produces: `loadArtistLocks(): ArtistLock[]`; `saveArtistLocks(locks: ArtistLock[]): void`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/artistLocksStorage.test.ts` (mirrors `lists.test.ts` exactly in style):

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { ArtistLock } from './ranking/types';
import { loadArtistLocks, saveArtistLocks } from './artistLocksStorage';

const ARTIST_A = '11111111-1111-4111-8111-111111111111';

describe('artistLocksStorage', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns an empty array when nothing is stored yet', () => {
    expect(loadArtistLocks()).toEqual([]);
  });

  it('round-trips locks through save/load', () => {
    const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1', 'a2'] }];
    saveArtistLocks(locks);
    expect(loadArtistLocks()).toEqual(locks);
  });

  it('returns an empty array for corrupted stored JSON rather than throwing', () => {
    localStorage.setItem('tastetest-artist-locks', 'not json');
    expect(loadArtistLocks()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/artistLocksStorage.test.ts`
Expected: FAIL — `Cannot find module './artistLocksStorage'`.

- [ ] **Step 3: Implement `web/src/artistLocksStorage.ts`**

```ts
import type { ArtistLock } from './ranking/types';

const LOCKS_KEY = 'tastetest-artist-locks';

// Mirrors lists.ts: localStorage may be unavailable (private browsing,
// quota, non-browser test env) or throw. Keep the loop working in-memory
// rather than crashing; only a real reload loses state in that case.
let memoryLocks: ArtistLock[] | null = null;

/** Load the artist locks, or an empty array if nothing is stored yet or
 *  storage is unreadable. */
export function loadArtistLocks(): ArtistLock[] {
  if (typeof localStorage === 'undefined') return memoryLocks ?? [];

  try {
    const raw = localStorage.getItem(LOCKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ArtistLock[]) : [];
  } catch (err) {
    console.warn('tastetest: failed to read artist locks from localStorage, using in-memory locks', err);
    return memoryLocks ?? [];
  }
}

/** Persist the artist locks under `tastetest-artist-locks`. */
export function saveArtistLocks(locks: ArtistLock[]): void {
  memoryLocks = locks;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(LOCKS_KEY, JSON.stringify(locks));
  } catch (err) {
    console.warn('tastetest: failed to persist artist locks to localStorage, continuing in-memory', err);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/artistLocksStorage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/artistLocksStorage.ts web/src/artistLocksStorage.test.ts
git commit -m "feat: persist artist locks to localStorage"
```

---

### Task 4: Server schema + API — `artist_locks_json`

**Files:**
- Modify: `web/api/_schema.js`
- Modify: `web/api/ranking.ts`
- Test: `web/api/ranking.test.ts`

**Interfaces:**
- Consumes: nothing new (plain JSON over HTTP).
- Produces: `GET /api/ranking` response gains `snapshot.artist_locks: ArtistLock[]` (defaults to `[]` when the column is null, e.g. pre-migration rows); `POST /api/ranking` accepts an optional `artist_locks` field in the body (validated, defaults to `[]` when omitted) and persists it to the new column.

- [ ] **Step 1: Add the column to the schema DDL**

In `web/api/_schema.js`, modify `CREATE_RANKING_SNAPSHOTS_TABLE`:

```js
export const CREATE_RANKING_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS ranking_snapshots (
    session_id TEXT PRIMARY KEY,
    ranking_json TEXT NOT NULL,
    lists_json TEXT NOT NULL,
    artist_locks_json TEXT,
    updated_at INTEGER NOT NULL
);
`;
```

(`artist_locks_json` is nullable — new installs get the column from this DDL; the already-deployed production table needs the `ALTER TABLE` fallback added next, exactly like `discovered_albums.primary_artist_mbid` in `discover-artist.ts`.)

- [ ] **Step 2: Write the failing tests**

Add to `web/api/ranking.test.ts`, inside the existing `describe('/api/ranking', ...)` block, after the two existing `it(...)` cases:

```ts
  it('round-trips artist_locks_json through POST then GET', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    dbMock.execute.mockResolvedValue({ rows: [] });
    dbMock.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 1 }]);
    const artistLocks = [{ artistMbid: '33333333-3333-4333-8333-333333333333', order: ['a', 'b'] }];

    const postRes = makeRes();
    await handler(
      postReq({
        session_id: '11111111-1111-4111-8111-111111111111',
        ranked: [album('22222222-2222-4222-8222-222222222222')],
        lists: { wantToListen: [], notHeard: [], dontCare: [] },
        artist_locks: artistLocks,
      }) as never,
      postRes as never
    );
    expect(postRes.statusCode).toBe(200);

    const insertCall = dbMock.batch.mock.calls[0][0][1];
    expect(insertCall.args).toContain(JSON.stringify(artistLocks));
  });

  it('defaults artist_locks to an empty array when the body omits it', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    dbMock.execute.mockResolvedValue({ rows: [] });
    dbMock.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 1 }]);

    const res = makeRes();
    await handler(
      postReq({
        session_id: '11111111-1111-4111-8111-111111111111',
        ranked: [],
        lists: { wantToListen: [], notHeard: [], dontCare: [] },
      }) as never,
      res as never
    );
    expect(res.statusCode).toBe(200);

    const insertCall = dbMock.batch.mock.calls[0][0][1];
    expect(insertCall.args).toContain('[]');
  });

  it('GET defaults a null artist_locks_json (pre-migration row) to an empty array', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    dbMock.execute.mockResolvedValue({
      rows: [
        {
          ranking_json: '[]',
          lists_json: '{"wantToListen":[],"notHeard":[],"dontCare":[]}',
          artist_locks_json: null,
          updated_at: 123,
        },
      ],
    });
    const res = makeRes();

    await handler(
      getReq({ session_id: '11111111-1111-4111-8111-111111111111' }) as never,
      res as never
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { snapshot: { artist_locks: unknown } }).snapshot.artist_locks).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run api/ranking.test.ts`
Expected: FAIL — the new assertions don't match current behavior (no `artist_locks` field is read/written yet).

- [ ] **Step 4: Implement the API changes**

In `web/api/ranking.ts`:

Add the `ArtistLock` type and body/validate/parse plumbing near the existing `SnapshotLists`/`Album` types:

```ts
type ArtistLock = {
  artistMbid: string;
  order: string[];
};
```

Extend `RankingBody`:

```ts
type RankingBody = {
  session_id?: unknown;
  ranked?: unknown;
  lists?: unknown;
  artist_locks?: unknown;
  base_updated_at?: unknown;
};
```

Add a parser near `parseLists`:

```ts
function parseArtistLocks(value: unknown): ArtistLock[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const locks: ArtistLock[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const { artistMbid, order } = item;
    if (typeof artistMbid !== 'string' || !UUID_RE.test(artistMbid)) return null;
    if (!Array.isArray(order) || !order.every((mbid) => typeof mbid === 'string' && UUID_RE.test(mbid))) {
      return null;
    }
    locks.push({ artistMbid, order: order as string[] });
  }
  return locks;
}
```

Extend `validate`'s return type and body:

```ts
function validate(body: RankingBody | null):
  | {
      ok: true;
      sessionId: string;
      ranked: Album[];
      lists: SnapshotLists;
      artistLocks: ArtistLock[];
      baseUpdatedAt: number | null | undefined;
    }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };
  if (!isSessionId(body.session_id)) return { ok: false, message: 'invalid_session' };

  const ranked = parseAlbumList(body.ranked);
  const lists = parseLists(body.lists);
  const artistLocks = parseArtistLocks(body.artist_locks);
  if (!ranked || !lists || !artistLocks) return { ok: false, message: 'invalid_snapshot' };
  const baseUpdatedAt = parseBaseUpdatedAt(body.base_updated_at);
  if (body.base_updated_at !== undefined && baseUpdatedAt === undefined) {
    return { ok: false, message: 'invalid_base_updated_at' };
  }

  const rankedIds = new Set(ranked.map((album) => album.mbid));
  const saved = [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare];
  if (saved.some((album) => rankedIds.has(album.mbid))) {
    return { ok: false, message: 'ranked_album_in_saved_list' };
  }

  const savedIds = new Set<string>();
  for (const album of saved) {
    if (savedIds.has(album.mbid)) return { ok: false, message: 'duplicate_saved_album' };
    savedIds.add(album.mbid);
  }

  return { ok: true, sessionId: body.session_id, ranked, lists, artistLocks, baseUpdatedAt };
}
```

Update `ensureSchema` with the idempotent migration, mirroring `discover-artist.ts:38`:

```ts
function ensureSchema(): Promise<void> {
  const client = db();
  schemaReady ??= (async () => {
    for (const sql of SCHEMA_STATEMENTS) {
      await client.execute(sql);
    }
    try {
      await client.execute('ALTER TABLE ranking_snapshots ADD COLUMN artist_locks_json TEXT');
    } catch {
      // Existing deployments may already have this nullable column.
    }
  })();
  return schemaReady;
}
```

Update `handleGet` to select and return the new column:

```ts
async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!isSessionId(sessionId)) {
    res.status(400).json({ error: 'invalid_session' });
    return;
  }

  await ensureSchema();
  const rows = await db().execute({
    sql: `
SELECT ranking_json, lists_json, artist_locks_json, updated_at
FROM ranking_snapshots
WHERE session_id = ?
`,
    args: [sessionId],
  });
  const row = rows.rows[0];
  if (!row) {
    res.status(200).json({ snapshot: null });
    return;
  }

  const ranked = JSON.parse(String(row.ranking_json)) as Album[];
  const lists = JSON.parse(String(row.lists_json)) as Partial<SnapshotLists>;
  const artistLocks = row.artist_locks_json ? (JSON.parse(String(row.artist_locks_json)) as ArtistLock[]) : [];
  res.status(200).json({
    snapshot: {
      ranked,
      lists: {
        wantToListen: lists.wantToListen ?? [],
        notHeard: lists.notHeard ?? [],
        dontCare: lists.dontCare ?? [],
      },
      artist_locks: artistLocks,
      updated_at: Number(row.updated_at),
    },
  });
}
```

Update `handlePost` to write the new column (replace the `snapshotArgs`/SQL block):

```ts
  await ensureSchema();
  const now = Date.now();
  const snapshotArgs = [
    validated.sessionId,
    JSON.stringify(validated.ranked),
    JSON.stringify(validated.lists),
    JSON.stringify(validated.artistLocks),
    now,
  ];
  const snapshotSql =
    validated.baseUpdatedAt === null
      ? `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO NOTHING
`
      : validated.baseUpdatedAt === undefined
        ? `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  artist_locks_json = excluded.artist_locks_json,
  updated_at = excluded.updated_at
`
        : `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  artist_locks_json = excluded.artist_locks_json,
  updated_at = excluded.updated_at
WHERE ranking_snapshots.updated_at = ?
`;
```

(The rest of `handlePost` — the `db().batch([...])` call and conflict check — is unchanged; it already spreads `snapshotArgs` and appends `baseUpdatedAt` conditionally.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run api/ranking.test.ts`
Expected: PASS (5 tests: the 2 pre-existing plus the 3 new ones).

- [ ] **Step 6: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/api/_schema.js web/api/ranking.ts web/api/ranking.test.ts
git commit -m "feat: persist artist locks in the ranking snapshot API"
```

---

### Task 5: Client sync layer — `rankingSync.ts`

**Files:**
- Modify: `web/src/rankingSync.ts`
- Modify: `web/src/rankingSync.test.ts`

**Interfaces:**
- Consumes: `ArtistLock` (`ranking/types.ts`).
- Produces: `snapshotPayload(sessionId: string, state: RankingState, lists: SavedLists, artistLocks: ArtistLock[], baseUpdatedAt?: number | null): SnapshotPayload`; `saveRankingSnapshot(sessionId: string, state: RankingState, lists: SavedLists, artistLocks: ArtistLock[], baseUpdatedAt?: number | null): Promise<RankingSnapshotSave>`; `RankingSnapshotLoad`'s `'found'` variant gains `artistLocks: ArtistLock[]`.

- [ ] **Step 1: Update the existing tests for the new signature**

In `web/src/rankingSync.test.ts`:

Replace the `'serializes FULL album records...'` test body's call and expectation:

```ts
  it('serializes FULL album records (not just mbids) plus session id', () => {
    const state: RankingState = { ranked: [album('a'), album('b')], pending: null };
    const lists: SavedLists = {
      wantToListen: [album('c')],
      notHeard: [album('d')],
      dontCare: [album('e')],
    };
    const artistLocks = [{ artistMbid: '33333333-3333-4333-8333-333333333333', order: ['a'] }];

    expect(snapshotPayload('session-1', state, lists, artistLocks)).toEqual({
      session_id: 'session-1',
      ranked: [album('a'), album('b')],
      lists: {
        wantToListen: [album('c')],
        notHeard: [album('d')],
        dontCare: [album('e')],
      },
      artist_locks: artistLocks,
    });
  });
```

Replace `'includes the snapshot version when provided'`:

```ts
  it('includes the snapshot version when provided', () => {
    const state: RankingState = { ranked: [album('a')], pending: null };
    const lists: SavedLists = { wantToListen: [], notHeard: [], dontCare: [] };

    expect(snapshotPayload('session-1', state, lists, [], 123)).toEqual({
      session_id: 'session-1',
      ranked: [album('a')],
      lists,
      artist_locks: [],
      base_updated_at: 123,
    });
  });
```

Replace the `saveRankingSnapshot(...)` call in `'reports conflict on a stale versioned save'`:

```ts
    const result = await saveRankingSnapshot(
      '11111111-1111-4111-8111-111111111111',
      { ranked: [album('a')], pending: null },
      { wantToListen: [], notHeard: [], dontCare: [] },
      [],
      123
    );
```

For every `loadRankingSnapshot`/`loadRankingSnapshotDetailed` test in the `describe('loadRankingSnapshot', ...)` block, add `artist_locks: []` (or a populated array where relevant) to the mocked `snapshot` fixture object and to the corresponding `toEqual(...)` expectation. Concretely, in `'returns full album records including dontCare, no seed pool needed'`:

```ts
  it('returns full album records including dontCare, no seed pool needed', async () => {
    const snapshot = {
      ranked: [album('a')],
      lists: {
        wantToListen: [album('b')],
        notHeard: [album('c')],
        dontCare: [album('d')],
      },
      artist_locks: [{ artistMbid: '33333333-3333-4333-8333-333333333333', order: ['a'] }],
      updated_at: 123,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ snapshot }),
      } as unknown as Response)
    );

    const result = await loadRankingSnapshot('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual({
      ranked: [album('a')],
      lists: {
        wantToListen: [album('b')],
        notHeard: [album('c')],
        dontCare: [album('d')],
      },
      artistLocks: snapshot.artist_locks,
    });
  });
```

In `'defaults a missing dontCare bucket to an empty list (older snapshot)'`, the mocked `snapshot` has no `artist_locks` key at all (simulating a pre-migration row) — add that expectation:

```ts
    expect(result).toEqual({
      ranked: [album('a')],
      lists: { wantToListen: [], notHeard: [], dontCare: [] },
      artistLocks: [],
    });
```

The remaining tests (`'returns null...'`, `'distinguishes a missing snapshot...'`, `'returns null without throwing...'`) are unaffected — they don't inspect the shape of a found snapshot.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/rankingSync.test.ts`
Expected: FAIL — TypeScript arg-count errors on `snapshotPayload`/`saveRankingSnapshot` calls, and the new `artist_locks`/`artistLocks` assertions don't match current output.

- [ ] **Step 3: Implement the changes in `web/src/rankingSync.ts`**

Add the import and extend the shared types:

```ts
import type { Album, ArtistLock, RankingState } from './ranking/types';
```

```ts
type SnapshotPayload = {
  session_id: string;
  ranked: Album[];
  lists: SnapshotLists;
  artist_locks: ArtistLock[];
  base_updated_at?: number | null;
};

type SnapshotResponse = {
  snapshot: null | {
    ranked: Album[];
    lists: {
      wantToListen: Album[];
      notHeard: Album[];
      dontCare?: Album[];
    };
    // Older snapshots predate artist locks; a missing field is no locks.
    artist_locks?: ArtistLock[];
    updated_at: number;
  };
};

export type RankingSnapshotLoad =
  | {
      status: 'found';
      ranked: Album[];
      lists: SavedLists;
      artistLocks: ArtistLock[];
      updatedAt: number;
    }
  | { status: 'missing' }
  | { status: 'error' };
```

Update `snapshotPayload`:

```ts
export function snapshotPayload(
  sessionId: string,
  state: RankingState,
  lists: SavedLists,
  artistLocks: ArtistLock[],
  baseUpdatedAt?: number | null
): SnapshotPayload {
  const payload: SnapshotPayload = {
    session_id: sessionId,
    ranked: state.ranked,
    lists: {
      wantToListen: lists.wantToListen,
      notHeard: lists.notHeard,
      dontCare: lists.dontCare,
    },
    artist_locks: artistLocks,
  };
  if (baseUpdatedAt !== undefined) payload.base_updated_at = baseUpdatedAt;
  return payload;
}
```

Update `saveRankingSnapshot`'s signature and its call to `snapshotPayload`:

```ts
export async function saveRankingSnapshot(
  sessionId: string,
  state: RankingState,
  lists: SavedLists,
  artistLocks: ArtistLock[],
  baseUpdatedAt?: number | null
): Promise<RankingSnapshotSave> {
  if (!getWriteKey()) return { status: 'skipped' };

  try {
    const response = await fetch('/api/ranking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...writeKeyHeaders() },
      body: JSON.stringify(snapshotPayload(sessionId, state, lists, artistLocks, baseUpdatedAt)),
    });
```

(The rest of `saveRankingSnapshot`'s body is unchanged.)

Update `loadRankingSnapshotDetailed`'s return on the `'found'` path:

```ts
  return {
    status: 'found',
    ranked: parseAlbumArray(body.snapshot.ranked),
    lists: {
      wantToListen: parseAlbumArray(body.snapshot.lists?.wantToListen),
      notHeard: parseAlbumArray(body.snapshot.lists?.notHeard),
      dontCare: parseAlbumArray(body.snapshot.lists?.dontCare),
    },
    artistLocks: Array.isArray(body.snapshot.artist_locks) ? body.snapshot.artist_locks : [],
    updatedAt: body.snapshot.updated_at,
  };
```

Update `loadRankingSnapshot`'s return type/body to pass `artistLocks` through:

```ts
export async function loadRankingSnapshot(
  sessionId: string
): Promise<{ ranked: Album[]; lists: SavedLists; artistLocks: ArtistLock[] } | null> {
  const result = await loadRankingSnapshotDetailed(sessionId);
  if (result.status !== 'found') return null;
  return { ranked: result.ranked, lists: result.lists, artistLocks: result.artistLocks };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/rankingSync.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/rankingSync.ts web/src/rankingSync.test.ts
git commit -m "feat: thread artist locks through the client snapshot sync layer"
```

---

### Task 6: `rankList.ts` — lock icon, live drop-index snapping, reusable-for-scoped-view options

**Files:**
- Modify: `web/src/ui/rankList.ts`

**Interfaces:**
- Consumes: nothing new (stays DOM-free of `ArtistLock` internals — the caller supplies a pre-computed snap function).
- Produces: `RankListOptions` gains 5 new optional fields: `onOpenArtistLock?: (album: Album) => void`, `getLockedArtistMbids?: () => string[]`, `getNearestValidDrop?: (from: number, to: number) => number`, `hideCandidateColumn?: boolean`, `emptyRankedMessage?: string`.

Not unit-tested per this file's existing convention (no `.test.ts` under `src/ui/`) — verified in Task 9 by running the app.

- [ ] **Step 1: Extend `RankListOptions`**

In `web/src/ui/rankList.ts`, replace the `RankListOptions` type:

```ts
export type RankListOptions = {
  getRanked: () => Album[];
  getCandidate: () => Album | null;
  /** Insert the current candidate at `index`. */
  onPlace: (index: number) => void;
  /** Move the ranked row at `from` to `to` (post-removal index). */
  onReorder: (from: number, to: number) => void;
  /** Set the candidate aside into a saved list. */
  onSetAside: (album: Album, which: ListName) => void;
  /** Defer the candidate for this session without saving it anywhere. */
  onSkip: (album: Album) => void;
  /** Hide this artist's remaining albums from future candidate selection. */
  onBlockArtist: (album: Album) => void;
  /** Record a single assisted this-or-that answer as a pairwise atom. */
  onCompare?: (winnerMbid: string, loserMbid: string) => void;
  /** Discover and queue the rest of this album's artist's other LPs. */
  onDiscoverArtist?: (album: Album) => void;
  /** Open the artist-lock scoped view for this row's artist. Omit to hide
   *  the lock icon entirely (used by the scoped view's own inner list, which
   *  has no lock-within-a-lock flow). */
  onOpenArtistLock?: (album: Album) => void;
  /** Artist mbids with an active lock, for the lock icon's visual state. */
  getLockedArtistMbids?: () => string[];
  /** For a row reorder starting at `from`, snap a proposed `to` to the
   *  nearest index that keeps every active lock intact. Omit when this
   *  instance's index space can never cross a lock (e.g. an artist-filtered
   *  sub-list, where a within-artist reorder can never violate any lock). */
  getNearestValidDrop?: (from: number, to: number) => number;
  /** Suppress the next-candidate column entirely (no card, no "done"
   *  message). Used by the artist-scoped sub-view, which has no candidate
   *  flow of its own -- unranked albums get their own list instead. */
  hideCandidateColumn?: boolean;
  /** Override the empty-ranked-list message. */
  emptyRankedMessage?: string;
};
```

- [ ] **Step 2: Snap the live drop index against active locks**

Replace `computeDropIndex` and its two call sites:

```ts
  function computeDropIndex(
    clientY: number,
    source: DragState['source'] | undefined = drag?.source
  ): number {
    const rows = rowElements();
    let raw = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        raw = i;
        break;
      }
    }
    if (!source || source.type !== 'row' || !opts.getNearestValidDrop) return raw;
    return opts.getNearestValidDrop(source.index, raw);
  }
```

In `startDrag`, change the `dropIndex` initializer to pass `source` explicitly (it's already a parameter there, but `drag` itself isn't assigned yet, so the default `drag?.source` would be `undefined` at that call site):

```ts
    drag = {
      source,
      album,
      ghost,
      pointerId: ev.pointerId,
      dropIndex: computeDropIndex(ev.clientY, source),
      lastClientY: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
    };
```

`updateIndicator`'s existing `drag.dropIndex = computeDropIndex(clientY);` call is unchanged — by the time it runs, `drag` is set, so the default parameter picks up `drag.source` correctly.

- [ ] **Step 3: Add the lock icon to `buildRow`, and make it and the discover icon conditional**

Replace `buildRow`:

```ts
  function buildRow(
    album: Album,
    index: number,
    subRanks: Map<string, SubRank>,
    lockedArtists: Set<string>
  ): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-row';

    const num = document.createElement('span');
    num.className = 'rank-num';
    num.textContent = String(index + 1);

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const title = document.createElement('p');
    title.className = 'rank-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = rankedSubtitle(album, subRanks.get(album.mbid));
    meta.append(title, sub);

    li.append(num, meta);

    if (opts.onDiscoverArtist) {
      const discoverBtn = document.createElement('button');
      discoverBtn.type = 'button';
      discoverBtn.className = 'rank-discover';
      discoverBtn.setAttribute('aria-label', `Rank the rest of ${album.primary_artist_name}'s albums`);
      discoverBtn.textContent = '▶';
      discoverBtn.addEventListener('click', () => opts.onDiscoverArtist?.(album));
      li.append(discoverBtn);
    }

    if (opts.onOpenArtistLock) {
      const isLocked = lockedArtists.has(album.primary_artist_mbid ?? '');
      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = isLocked ? 'rank-lock rank-lock-active' : 'rank-lock';
      lockBtn.setAttribute(
        'aria-label',
        isLocked
          ? `${album.primary_artist_name}'s order is locked`
          : `Lock ${album.primary_artist_name}'s order`
      );
      lockBtn.textContent = '⚷';
      lockBtn.addEventListener('click', () => opts.onOpenArtistLock?.(album));
      li.append(lockBtn);
    }

    // A dedicated grip so the row body still flick-scrolls on touch; only the
    // grip disables native scrolling (touch-action:none via .rank-grip).
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'rank-grip';
    grip.setAttribute('aria-label', `Reorder ${album.title}`);
    grip.textContent = '⇅';
    grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));
    li.append(grip);

    return li;
  }
```

- [ ] **Step 4: Wire `hideCandidateColumn` and `emptyRankedMessage` into `render`**

In `render()`, change the empty-ranked-list branch:

```ts
    if (ranked.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'rank-empty';
      empty.textContent =
        opts.emptyRankedMessage ??
        'Your ranked list is empty. Drag the next album in, or tap it to start.';
      listEl.append(empty);
    } else {
      const subRanks = computeSubRanks(ranked);
      const lockedArtists = new Set(opts.getLockedArtistMbids?.() ?? []);
      ranked.forEach((album, i) => listEl.append(buildRow(album, i, subRanks, lockedArtists)));
    }
```

Then wrap the candidate column so it's skipped entirely when `hideCandidateColumn` is set:

```ts
    const candidateCol = document.createElement('div');
    candidateCol.className = 'candidate-col';
    if (!opts.hideCandidateColumn) {
      const candidate = opts.getCandidate();
      if (candidate) {
        // Long list -> assisted this-or-that by default; short list -> drag/tap.
        if (ranked.length >= ASSIST_THRESHOLD) {
          if (!assist || assist.album.mbid !== candidate.mbid) {
            assist = startAssist(ranked, candidate);
          }
          candidateCol.append(buildAssisted(candidate));
        } else {
          assist = null;
          candidateCol.append(buildCandidate(candidate));
        }
      } else {
        assist = null;
        const done = document.createElement('p');
        done.className = 'candidate-done';
        done.textContent = 'You have placed every album in the pool.';
        candidateCol.append(done);
      }
    }

    layout.append(...(opts.hideCandidateColumn ? [listCol] : [candidateCol, listCol]));
```

(This replaces the existing `if (candidate) { ... } else { ... }` block and the final `layout.append(candidateCol, listCol);` line — everything else in `render()` is unchanged.)

- [ ] **Step 5: Type-check**

Run: `cd web && npm run build`
Expected: succeeds (no TS errors). `main.ts` will fail to compile at this point because `buildRow`'s signature/`RankListOptions` additions are all optional and additive — this step should already pass in isolation. If it doesn't, the diagnostic will point at the exact line to fix before moving on.

- [ ] **Step 6: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/ui/rankList.ts
git commit -m "feat: add artist-lock icon and live lock-aware drag blocking to rankList"
```

---

### Task 7: `web/src/ui/artistLockView.ts` — the scoped view

**Files:**
- Create: `web/src/ui/artistLockView.ts`

**Interfaces:**
- Consumes: `mountRankList`/`RankListOptions` (`rankList.ts`); `artistAlbumsFor`/`mapFilteredReorderToGlobal` (`artistLockAlbums.ts`); `buildLock` (`ranking/locks.ts`); `Album`, `ArtistLock` (`ranking/types.ts`); `SavedLists` (`lists.ts`).
- Produces: `mountArtistLockView(container: HTMLElement, opts: ArtistLockViewOptions): { render: () => void; teardown: () => void }` where

```ts
export type ArtistLockViewOptions = {
  album: Album; // any album by the target artist, used for identity/name
  getRanked: () => Album[];
  getLists: () => SavedLists;
  getPool: () => Album[];
  getArtistLocks: () => ArtistLock[];
  onReorder: (from: number, to: number) => void; // global indices
  onPlace: (album: Album, globalIndex: number) => void;
  onLock: (lock: ArtistLock) => void;
  onUnlock: (artistMbid: string) => void;
  onDiscover: () => Promise<void>;
  onClose: () => void;
};
```

Not unit-tested per this file's existing convention — verified in Task 9 by running the app.

- [ ] **Step 1: Implement `web/src/ui/artistLockView.ts`**

```ts
import type { Album, ArtistLock } from '../ranking/types';
import type { SavedLists } from '../lists';
import { artistAlbumsFor, mapFilteredReorderToGlobal } from '../artistLockAlbums';
import { buildLock } from '../ranking/locks';
import { mountRankList } from './rankList';

export type ArtistLockViewOptions = {
  album: Album;
  getRanked: () => Album[];
  getLists: () => SavedLists;
  getPool: () => Album[];
  getArtistLocks: () => ArtistLock[];
  onReorder: (from: number, to: number) => void;
  onPlace: (album: Album, globalIndex: number) => void;
  onLock: (lock: ArtistLock) => void;
  onUnlock: (artistMbid: string) => void;
  onDiscover: () => Promise<void>;
  onClose: () => void;
};

export type ArtistLockViewController = {
  render: () => void;
  teardown: () => void;
};

function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}

export function mountArtistLockView(
  container: HTMLElement,
  opts: ArtistLockViewOptions
): ArtistLockViewController {
  const artistMbid = opts.album.primary_artist_mbid;
  const artistName = opts.album.primary_artist_name;
  let ranklistController: ReturnType<typeof mountRankList> | null = null;
  let loading = true;

  function isLocked(): boolean {
    return !!artistMbid && opts.getArtistLocks().some((lock) => lock.artistMbid === artistMbid);
  }

  function buildUnrankedRow(album: Album, maxRank: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'lock-unranked-row';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const title = document.createElement('p');
    title.className = 'rank-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = subtitle(album);
    meta.append(title, sub);

    const form = document.createElement('form');
    form.className = 'candidate-place';
    const input = document.createElement('input');
    input.className = 'candidate-place-input';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = String(maxRank);
    input.placeholder = '#';
    input.setAttribute('aria-label', `Rank position for ${album.title}`);
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'candidate-place-button';
    btn.textContent = 'Place';
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const rank = Number(input.value);
      if (!Number.isInteger(rank) || rank < 1) return;
      opts.onPlace(album, Math.min(rank, maxRank) - 1);
    });
    form.append(input, btn);

    li.append(meta, form);
    return li;
  }

  function render(): void {
    container.textContent = '';
    ranklistController?.teardown();
    ranklistController = null;

    const wrap = document.createElement('div');
    wrap.className = 'lock-view';

    const header = document.createElement('div');
    header.className = 'lock-view-header';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lock-view-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => opts.onClose());
    const heading = document.createElement('h2');
    heading.className = 'lock-view-title';
    heading.textContent = `${artistName}'s order`;
    header.append(backBtn, heading);
    wrap.append(header);

    if (!artistMbid) {
      const warning = document.createElement('p');
      warning.className = 'rank-status';
      warning.textContent = 'Refresh Album Case to lock this artist\'s order.';
      wrap.append(warning);
      container.append(wrap);
      return;
    }

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'lock-view-toggle';
    if (isLocked()) {
      lockBtn.textContent = 'Unlock';
      lockBtn.addEventListener('click', () => opts.onUnlock(artistMbid));
    } else {
      lockBtn.textContent = 'Lock in order';
      lockBtn.addEventListener('click', () => opts.onLock(buildLock(artistMbid, opts.getRanked())));
    }
    wrap.append(lockBtn);

    if (loading) {
      const status = document.createElement('p');
      status.className = 'rank-status';
      status.textContent = `Finding the rest of ${artistName}'s albums...`;
      wrap.append(status);
    }

    const rankedCol = document.createElement('div');
    rankedCol.className = 'lock-ranked-col';
    ranklistController = mountRankList(rankedCol, {
      getRanked: () => artistAlbumsFor(artistMbid, opts.getRanked(), opts.getLists(), opts.getPool()).ranked,
      getCandidate: () => null,
      hideCandidateColumn: true,
      emptyRankedMessage: `None of ${artistName}'s albums are ranked yet.`,
      onPlace: () => {},
      onReorder: (from, to) => {
        const mapped = mapFilteredReorderToGlobal(opts.getRanked(), artistMbid, from, to);
        if (mapped) opts.onReorder(mapped.from, mapped.to);
      },
      onSetAside: () => {},
      onSkip: () => {},
      onBlockArtist: () => {},
    });
    wrap.append(rankedCol);

    const unranked = artistAlbumsFor(artistMbid, opts.getRanked(), opts.getLists(), opts.getPool()).unranked;
    if (unranked.length > 0) {
      const unrankedHeading = document.createElement('p');
      unrankedHeading.className = 'lock-unranked-heading';
      unrankedHeading.textContent = 'Not yet ranked:';
      wrap.append(unrankedHeading);

      const unrankedList = document.createElement('ol');
      unrankedList.className = 'lock-unranked-list';
      const maxRank = opts.getRanked().length + 1;
      unranked.forEach((album) => unrankedList.append(buildUnrankedRow(album, maxRank)));
      wrap.append(unrankedList);
    }

    container.append(wrap);
  }

  function teardown(): void {
    ranklistController?.teardown();
    ranklistController = null;
  }

  render();
  if (artistMbid) {
    void opts.onDiscover().finally(() => {
      loading = false;
      render();
    });
  } else {
    loading = false;
  }

  return { render, teardown };
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npm run build`
Expected: succeeds. (`main.ts` still won't call this module yet, so no wiring errors should surface here — if `tsc` reports unused-export or similar, double check the file compiles standalone by also running `npx tsc --noEmit -p .` from `web/`.)

- [ ] **Step 3: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/ui/artistLockView.ts
git commit -m "feat: add artist-scoped lock view"
```

---

### Task 8: `main.ts` wiring

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/main.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: `resolveInitialState` gains a third snapshot field (`artistLocks`) in both its `serverSnapshot` parameter and `cached` parameter, and in its return value.

- [ ] **Step 1: Update `main.test.ts` fixtures for the new `resolveInitialState` signature**

In `web/src/main.test.ts`, update the two `resolveInitialState` tests:

```ts
describe('resolveInitialState (server-authoritative load-on-open)', () => {
  it('prefers the full server snapshot over the localStorage cache', () => {
    const server = {
      ranked: [album('a')],
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
    expect(resolved.state.ranked).toEqual([album('a')]);
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
```

(`VALID` is already defined at the top of this file as a fixture UUID; `albumWithArtistMbid` is unused by these two edits, no change needed there.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/main.test.ts`
Expected: FAIL — `resolveInitialState` doesn't accept/return `artistLocks` yet.

- [ ] **Step 3: Update `resolveInitialState`'s signature**

In `web/src/main.ts`, add the import:

```ts
import type { Album, ArtistLock, RankingState } from './ranking/types';
```

Replace `resolveInitialState`:

```ts
export function resolveInitialState(
  serverSnapshot: { ranked: Album[]; lists: SavedLists; artistLocks: ArtistLock[] } | null,
  cached: { state: RankingState; lists: SavedLists; artistLocks: ArtistLock[] }
): { state: RankingState; lists: SavedLists; artistLocks: ArtistLock[]; fromServer: boolean } {
  if (serverSnapshot) {
    return {
      state: { ranked: serverSnapshot.ranked, pending: null },
      lists: serverSnapshot.lists,
      artistLocks: serverSnapshot.artistLocks,
      fromServer: true,
    };
  }
  return { state: cached.state, lists: cached.lists, artistLocks: cached.artistLocks, fromServer: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/main.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `artistLocks` state, persistence, and sync into `main()`**

Add the new imports at the top of `web/src/main.ts`:

```ts
import { loadArtistLocks, saveArtistLocks } from './artistLocksStorage';
import { buildLock, upsertLock, removeLock, nearestValidDropIndex } from './ranking/locks';
import { artistAlbumsFor } from './artistLockAlbums';
import { mountArtistLockView } from './ui/artistLockView';
```

Extend `ViewMode`:

```ts
type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistLock';
```

Near where `cachedState`/`cachedLists`/`serverSnapshot` are loaded (around the existing `const cachedState: RankingState = loadRanking() ?? { ranked: [], pending: null };` line), add:

```ts
  const cachedState: RankingState = loadRanking() ?? { ranked: [], pending: null };
  const cachedLists = loadLists();
  const cachedArtistLocks = loadArtistLocks();
  let blockedArtists = loadBlockedArtists();
  const serverLoad = await loadRankingSnapshotDetailed(OWNER_ID);
  let serverSnapshot =
    serverLoad.status === 'found'
      ? { ranked: serverLoad.ranked, lists: serverLoad.lists, artistLocks: serverLoad.artistLocks }
      : null;
```

(Only the `serverSnapshot` ternary's object literal gains `artistLocks`; everything else in that block is unchanged.)

Where `serverSnapshot` is hydrated against the pool (the `if (serverSnapshot) { serverSnapshot = { ranked: hydrateAlbums(...), lists: hydrateLists(...) }; }` block), carry `artistLocks` through unchanged (it holds mbids only, nothing to hydrate):

```ts
  if (serverSnapshot) {
    serverSnapshot = {
      ranked: hydrateAlbums(serverSnapshot.ranked, poolById),
      lists: hydrateLists(serverSnapshot.lists, poolById),
      artistLocks: serverSnapshot.artistLocks,
    };
  }
```

Update the `resolveInitialState` call and the destructured result:

```ts
  const initial = resolveInitialState(pendingSync ? null : serverSnapshot, {
    state: cachedState,
    lists: cachedLists,
    artistLocks: cachedArtistLocks,
  });
  let state: RankingState = initial.state;
  let lists: SavedLists = initial.lists;
  let artistLocks: ArtistLock[] = initial.artistLocks;
```

Where `initial.fromServer` triggers `saveRanking(state); saveLists(lists);`, add the locks save:

```ts
  if (initial.fromServer) {
    saveRanking(state);
    saveLists(lists);
    saveArtistLocks(artistLocks);
  } else if (
```

(The rest of that `else if` condition is unchanged.)

- [ ] **Step 6: Add `persistArtistLocks` next to `persistLists`**

```ts
  function persistLists(): void {
    saveLists(lists);
    markPendingSync();
    updateSyncBanner();
    queueRankingSnapshotSync();
  }

  function persistArtistLocks(): void {
    saveArtistLocks(artistLocks);
    markPendingSync();
    updateSyncBanner();
    queueRankingSnapshotSync();
  }
```

- [ ] **Step 7: Thread `artistLocks` into `syncRankingSnapshot`'s `saveRankingSnapshot` call**

```ts
    const result = await saveRankingSnapshot(
      session.session_id,
      state,
      lists,
      artistLocks,
      snapshotBaseUpdatedAt
    );
```

- [ ] **Step 8: Add `handleOpenArtistLock` and the scoped-view render/teardown wiring**

Add near `handleDiscoverArtist`:

```ts
  let lockedArtistMbid: string | null = null;
  let artistLockController: ReturnType<typeof mountArtistLockView> | null = null;

  function findAlbumByArtist(artistMbid: string): Album | null {
    return (
      state.ranked.find((a) => a.primary_artist_mbid === artistMbid) ??
      [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare].find(
        (a) => a.primary_artist_mbid === artistMbid
      ) ??
      pool.find((a) => a.primary_artist_mbid === artistMbid) ??
      null
    );
  }

  function renderArtistLockView(): void {
    if (!lockedArtistMbid) {
      showView('ranked');
      return;
    }
    const artistMbid = lockedArtistMbid;
    const artistAlbum = findAlbumByArtist(artistMbid);
    if (!artistAlbum) {
      lockedArtistMbid = null;
      showView('ranked');
      return;
    }

    artistLockController?.teardown();
    stage.textContent = '';
    artistLockController = mountArtistLockView(stage, {
      album: artistAlbum,
      getRanked: () => state.ranked,
      getLists: () => lists,
      getPool: () => pool,
      getArtistLocks: () => artistLocks,
      onReorder: (from, to) => {
        state = { ranked: moveItem(state.ranked, from, to), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
      onPlace: (album, index) => {
        state = { ranked: insertAt(state.ranked, album, index), pending: null };
        lists = removeFromList(lists, album.mbid, 'wantToListen');
        lists = removeFromList(lists, album.mbid, 'notHeard');
        lists = removeFromList(lists, album.mbid, 'dontCare');
        persistRankingState();
        persistLists();
        renderArtistLockView();
      },
      onLock: (lock) => {
        artistLocks = upsertLock(artistLocks, lock);
        persistArtistLocks();
        renderArtistLockView();
      },
      onUnlock: (mbid) => {
        artistLocks = removeLock(artistLocks, mbid);
        persistArtistLocks();
        renderArtistLockView();
      },
      onDiscover: async () => {
        const knownMbids = pool
          .filter((a) => a.primary_artist_mbid === artistMbid)
          .map((a) => a.mbid);
        const result = await discoverArtistDetailed(
          session.session_id,
          artistAlbum.primary_artist_name,
          artistMbid,
          knownMbids
        );
        if (result.status === 'found') {
          const poolIds = new Set(pool.map((a) => a.mbid));
          for (const found of result.albums) {
            if (!poolIds.has(found.mbid)) {
              pool.push(found);
              poolIds.add(found.mbid);
            }
          }
        }
      },
      onClose: () => {
        lockedArtistMbid = null;
        showView('ranked');
      },
    });
  }

  function handleOpenArtistLock(album: Album): void {
    if (!album.primary_artist_mbid) {
      rankList.showStatus(`Refresh Album Case to lock ${album.primary_artist_name}'s order.`);
      return;
    }
    lockedArtistMbid = album.primary_artist_mbid;
    showView('artistLock');
  }
```

- [ ] **Step 9: Wire the new `showView` branch and teardown-on-leave**

Replace `showView`:

```ts
  function showView(next: ViewMode): void {
    // Leaving the drag view: cancel any in-flight drag / listeners.
    if (view === 'ranked' && next !== 'ranked') {
      rankList.teardown();
    }
    if (view === 'artistLock' && next !== 'artistLock') {
      artistLockController?.teardown();
      artistLockController = null;
    }
    view = next;

    if (view === 'ranked') {
      rankList.render();
    } else if (view === 'blockedArtists') {
      renderBlockedArtists();
    } else if (view === 'artistLock') {
      renderArtistLockView();
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
  }
```

- [ ] **Step 10: Wire the new `mountRankList` options for the main view**

In the `mountRankList(stage, { ... })` call, add:

```ts
  const rankList = mountRankList(stage, {
    getRanked: () => state.ranked,
    getCandidate: () => candidate,
    getLockedArtistMbids: () => artistLocks.map((lock) => lock.artistMbid),
    getNearestValidDrop: (from, to) => nearestValidDropIndex(state.ranked, artistLocks, from, to),
    onOpenArtistLock: (album) => handleOpenArtistLock(album),
    onPlace: (index) => {
```

(Everything else inside that `mountRankList(...)` call is unchanged — this only adds three new option fields before the existing `onPlace`.)

- [ ] **Step 11: Preserve `renderNav`'s tab set**

`renderNav`'s `items` array intentionally does NOT get an `'artistLock'` entry — it's not a persistent tab, only reachable via a row's lock icon and left via the scoped view's own "Back" button (`showView('ranked')`). No change needed to `renderNav` beyond what already exists.

- [ ] **Step 12: Type-check and run the full test suite**

Run: `cd web && npm run build`
Expected: succeeds, no TS errors.

Run: `cd web && npm run test`
Expected: PASS, all suites green.

- [ ] **Step 13: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/main.ts web/src/main.test.ts
git commit -m "feat: wire artist-lock state, persistence, and scoped view into main"
```

---

### Task 9: CSS

**Files:**
- Modify: `web/src/style.css`

- [ ] **Step 1: Add lock-icon styling**

Add after the existing `.rank-discover:hover` rule (matches `.rank-discover`'s exact structure, plus an active-state modifier):

```css
.rank-lock {
  flex-shrink: 0;
  width: 44px;
  min-height: 44px;
  border: 1px solid var(--color-border-btn);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 1rem;
  cursor: pointer;
}

.rank-lock:hover {
  background: var(--color-bg-alt);
  color: var(--color-fg);
}

.rank-lock-active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
```

- [ ] **Step 2: Add scoped-view layout styling**

Add at the end of the file:

```css
.lock-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lock-view-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.lock-view-back {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-btn);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-mono);
  cursor: pointer;
}

.lock-view-title {
  margin: 0;
  font-size: 1rem;
  color: var(--color-fg);
  overflow-wrap: anywhere;
}

.lock-view-toggle {
  align-self: flex-start;
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-accent);
  font-family: var(--font-mono);
  cursor: pointer;
}

.lock-unranked-heading {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.8rem;
}

.lock-unranked-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lock-unranked-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 8px;
  border: 1px solid var(--color-border-row);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/style.css
git commit -m "style: add artist-lock icon and scoped-view styling"
```

---

### Task 10: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd web && npm run test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 2: Exercise the golden path in the browser**

Run: `cd web && npm run dev`, open the printed local URL.

Walk through:
1. Rank at least 3 albums by the same artist (via the existing candidate flow), scattered among other artists.
2. Click that artist's new lock icon on any of their ranked rows. Confirm the scoped view opens, shows only that artist's ranked albums (draggable) plus any unranked ones (with a "#/Place" control each), and the header reads `"<Artist>'s order"`.
3. Drag to reorder the artist's albums within the scoped view; confirm dragging works and updates their order.
4. Click "Lock in order". Confirm the button flips to "Unlock" and the icon on the main list now shows the locked state for that artist's rows.
5. Go back to the main ranked list (Back button). Try dragging one of that artist's albums past another of their own albums — confirm the drop is blocked/snapped rather than landing there. Confirm dragging albums by *other* artists is unaffected.
6. Return to the scoped view, click "Unlock", confirm the lock icon reverts and the main list no longer blocks reordering that artist's albums.
7. Reload the page. Confirm the lock (if left active) survives the reload (localStorage + server round-trip).

- [ ] **Step 3: Confirm no regressions in adjacent flows**

Spot-check: normal candidate placement (drag + "#/Place" + assisted this-or-that on a long list), the ▶ discover-artist flow, set-aside actions, and the existing saved-list tabs still work as before.

- [ ] **Step 4: Report results**

No commit for this task — if verification surfaces a bug, fix it as a follow-up commit referencing which step failed and why, then re-run Steps 1-3.

---

## Self-Review Notes

**Spec coverage:** every "Approved answer" in the spec maps to a task — album scope (Task 2/7), "#/Place" reuse (Task 7), drag-to-place sub-ranking (Task 7 via `mountRankList`), row-icon entry point (Task 6), live block-not-flag enforcement (Task 1 + Task 6), unlock→re-batch→re-lock-only editability (Task 7's `isLocked()` branch — no in-place edit path exists), and the lock-scope decision (Task 1's `buildLock` only captures currently-ranked members, matching the spec's "at the moment Lock was pressed" rule).

**Data-model deviation (documented in the spec, Task 1/3):** `artistLocks` is a third top-level state variable, not nested in `RankingState` — corrected after finding `insertion.ts`/`assist.ts`/`backup.ts` all construct `RankingState` literals that would otherwise need an unrelated field.

**Type consistency check:** `ArtistLock` (Task 1) is used identically by `locks.ts`, `artistLockAlbums.ts`, `rankingSync.ts`, `api/ranking.ts` (a structurally-identical local type, matching this codebase's existing pattern of a local `Album` type in `api/ranking.ts` rather than importing across the client/server boundary), `main.ts`, and `artistLockView.ts`. `nearestValidDropIndex`'s signature matches its one call site in `main.ts` (Task 8, Step 10) and its consumption via `RankListOptions.getNearestValidDrop` (Task 6). `artistAlbumsFor`'s return shape (`{ ranked, unranked }`) matches its two call sites in `artistLockView.ts` (Task 7).
