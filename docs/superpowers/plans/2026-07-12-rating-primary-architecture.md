# Rating as the Organizing Principle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `rating` (1-10, 2 decimals) the stored, primary value that determines an album's position in the ranked list, replacing today's model where an array-splice position is the only record of order.

**Architecture:** A new `RankedAlbum = Album & { rating: number }` type is used specifically for the ranked list — the plain `Album` type (pool, candidates, seed data, discovery results) is untouched, avoiding a huge, pointless blast radius into seed loading and discovery. `RankingState.ranked` changes from `Album[]` to `RankedAlbum[]`. A new pure function, `ratingForDropIndex`, computes a rating from a drop position by interpolating between neighbors; every place that currently splices an array index (`main.ts`'s six call sites, plus `insertion.ts`'s `applyPick` finalization) switches to computing a rating via this function instead. `web/src/ranking/order.ts` and `web/src/ranking/locks.ts` are **not modified** — confirmed via direct tracing that their internal logic (hypothetical-arrangement validity checks) is independent of how the real state is mutated.

**Tech Stack:** TypeScript, Vite, Vitest — no new dependencies.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-12-rating-primary-architecture-design.md`.
- **Type split, not a universal required field:** `rating` lives on a new `RankedAlbum` type, used only for the ranked list. The base `Album` type (pool/candidate/seed/discovery albums, which aren't ranked yet) is unchanged — confirmed necessary because the static seed file (`public/seed/albums.json`, 162 albums) and the whole discovery pipeline construct plain `Album` objects with no rating, and making rating universally required would silently break seed-pool loading.
- Rating formula for interpolation: midpoint of the two neighboring ratings, clamped to `[1, 10]` at the list ends, rounded to 2 decimals: `Math.round(n * 100) / 100`.
- `web/src/ranking/order.ts` and `web/src/ranking/locks.ts` are **not modified**. `web/src/ranking/insertion.ts` **is** modified (just `applyPick`'s finalization step, per the traced data flow below — everything else in that file stays the same).
- Confirmed by direct code tracing (not assumption): `main.ts` never references `state.pending`, `startPlacement`, `applyPick`, or `nextComparison` — the entire binary-search/assist flow operates on `assist.ts`'s own scratch `AssistPlacement.state`, fully decoupled from the real app state until the assist flow resolves to a single index, which is the only thing `main.ts` ever reads back out (`assistIndex`). This is why `insertion.ts`'s changes are small and localized despite the type change rippling through it.
- No schema migration on Turso — `ranking_snapshots.ranking_json` is an untyped JSON blob.
- Test convention: colocate `.test.ts` next to source. No new test framework.

---

### Task 1: `RankedAlbum` type, `RankingState.ranked: RankedAlbum[]`, and the `ratingForDropIndex` pure function

**Files:**
- Modify: `web/src/ranking/types.ts`
- Create: `web/src/ranking/rating.ts`
- Create: `web/src/ranking/rating.test.ts`

**Interfaces:**
- Produces: `export type RankedAlbum = Album & { rating: number };`, `RankingState.ranked: RankedAlbum[]` (changed from `Album[]`), and `export function ratingForDropIndex(ranked: RankedAlbum[], index: number): number` — later tasks depend on this exact signature and on `RankedAlbum` being importable from `./types`.

This task will break the build broadly (every place constructing a `RankingState`/`ranked` array now needs `RankedAlbum`s, not plain `Album`s) — expected, fixed across Tasks 2-4. Verify only `rating.ts`/`rating.test.ts` in isolation here.

- [ ] **Step 1: Add `RankedAlbum` and update `RankingState`**

In `web/src/ranking/types.ts`, add immediately after the `Album` type:

```ts
/** An album that's actually in the ranked list — carries a rating, the
 *  single source of truth for its position. Pool/candidate/seed albums
 *  are plain `Album`s with no rating until they're placed. */
export type RankedAlbum = Album & {
  rating: number; // 1.00-10.00, 2 decimal places.
};
```

Then change the existing `RankingState` type's `ranked` field:

```ts
export type RankingState = {
  ranked: RankedAlbum[];
  pending: Pending | null;
};
```

Leave `Pending` exactly as it is (`{ album: Album; lo: number; hi: number }`) — the candidate being placed is not yet a `RankedAlbum`.

- [ ] **Step 2: Write the failing tests**

Create `web/src/ranking/rating.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RankedAlbum } from './types';
import { ratingForDropIndex } from './rating';

function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: 'Artist',
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
    rating,
  };
}

describe('ratingForDropIndex', () => {
  it('returns the midpoint of the two neighboring ratings', () => {
    const ranked = [rankedAlbum('a', 9), rankedAlbum('b', 7)];
    expect(ratingForDropIndex(ranked, 1)).toBe(8);
  });

  it('rounds the midpoint to 2 decimal places', () => {
    const ranked = [rankedAlbum('a', 9.5), rankedAlbum('b', 9.49)];
    expect(ratingForDropIndex(ranked, 1)).toBe(9.5);
  });

  it('clamps at the ceiling when dropped at the very top', () => {
    const ranked = [rankedAlbum('a', 9.8), rankedAlbum('b', 5)];
    expect(ratingForDropIndex(ranked, 0)).toBe(10);
  });

  it('does not exceed 10 when dropped at the top of an already-high list', () => {
    const ranked = [rankedAlbum('a', 9.9)];
    expect(ratingForDropIndex(ranked, 0)).toBe(10);
  });

  it('clamps at the floor when dropped at the very bottom', () => {
    const ranked = [rankedAlbum('a', 5), rankedAlbum('b', 1.2)];
    expect(ratingForDropIndex(ranked, 2)).toBe(1);
  });

  it('does not go below 1 when dropped at the bottom of an already-low list', () => {
    const ranked = [rankedAlbum('a', 1.1)];
    expect(ratingForDropIndex(ranked, 1)).toBe(1);
  });

  it('returns 10 for the first album in an empty list', () => {
    expect(ratingForDropIndex([], 0)).toBe(10);
  });

  it('clamps an out-of-range index into range before interpolating', () => {
    const ranked = [rankedAlbum('a', 9), rankedAlbum('b', 7)];
    expect(ratingForDropIndex(ranked, 99)).toBe(1);
    expect(ratingForDropIndex(ranked, -5)).toBe(10);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd web && npx vitest run src/ranking/rating.test.ts`
Expected: FAIL — `rating.ts` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `web/src/ranking/rating.ts`:

```ts
import type { RankedAlbum } from './types';

/**
 * The rating a newly-placed album should get to land at `index` in `ranked`
 * -- an array already sorted by rating descending, assumed NOT to contain
 * the album being placed (remove it first if re-rating an existing one).
 *
 * Interpolates the midpoint between the ratings immediately above and below
 * the target index; clamps to the 1-10 range at either end of the list.
 * 2 decimal places, matching the site-export formula's precision (see
 * docs/superpowers/specs/2026-07-11-album-score-export-design.md for why:
 * avoids ties across a realistic album count).
 *
 * Known, accepted limitation: repeatedly dropping albums into the exact
 * same narrow gap will eventually exhaust the 0.01 precision available
 * between two neighbors, producing a tie. Not solved here.
 */
export function ratingForDropIndex(ranked: RankedAlbum[], index: number): number {
  const clamped = Math.max(0, Math.min(index, ranked.length));
  const above = ranked[clamped - 1]?.rating;
  const below = ranked[clamped]?.rating;

  if (above == null && below == null) return 10;
  if (above == null) return Math.min(10, round2(below! + 0.5));
  if (below == null) return Math.max(1, round2(above - 0.5));
  return round2((above + below) / 2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run src/ranking/rating.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 6: Commit**

```bash
git add web/src/ranking/types.ts web/src/ranking/rating.ts web/src/ranking/rating.test.ts
git commit -m "feat(ranking): add RankedAlbum type and ratingForDropIndex"
```

Expect broad `tsc`/test failures after this — intended, fixed in Tasks 2-4.

---

### Task 2: `insertion.ts`'s `applyPick` computes a rating on finalization; `assist.ts` accepts `RankedAlbum[]`

**Files:**
- Modify: `web/src/ranking/insertion.ts`
- Modify: `web/src/ranking/insertion.test.ts`
- Modify: `web/src/ranking/assist.ts`
- Modify: `web/src/ranking/assist.test.ts`

**Interfaces:**
- Consumes: `ratingForDropIndex(ranked: RankedAlbum[], index: number): number` (Task 1).
- Produces: `applyPick`'s return type is unchanged (`RankingState`), but its `ranked` field now contains real `RankedAlbum`s with computed ratings, not just spliced `Album`s. `assist.ts`'s `startAssist(ranked: RankedAlbum[], album: Album): AssistPlacement` — parameter type changed from `Album[]` to `RankedAlbum[]` (its second parameter, `album`, stays plain `Album` — the candidate isn't rated yet).

This is the one place in the whole plan where the binary-search engine's own behavior changes, not just its types — do this carefully and lean on the existing property-based tests (`insertion.test.ts`'s transitivity test) to catch mistakes.

- [ ] **Step 1: Update failing tests for `applyPick`**

In `web/src/ranking/insertion.test.ts`, find the existing tests that construct a `RankingState` with a populated `ranked` array and call `applyPick` to finalize a placement. Update their fixtures to use `RankedAlbum`s (add a `rating` field to each), and add a new assertion that the finalized result's inserted album carries a computed rating consistent with its neighbors — for example, extend an existing "resolves after enough comparisons" test with:

```ts
it('gives the finalized album a rating interpolated between its neighbors', () => {
  // Using this file's existing fixture-building pattern: construct a small
  // ranked list of RankedAlbums with known ratings (e.g. 9 and 7), place a
  // new candidate, drive it to resolution via applyPick, then assert the
  // resulting ranked array's newly-inserted album has rating 8 (the
  // midpoint) -- not just that it landed at the right array index.
});
```

Write this using the file's own existing helper/fixture pattern (read the top of the file for its existing `album()`-style builder or inline construction style, and match it) rather than inventing a new one.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/ranking/insertion.test.ts`
Expected: FAIL — `applyPick` still does a plain splice with no rating.

- [ ] **Step 3: Update `applyPick`'s finalization step**

In `web/src/ranking/insertion.ts`, add the import:

```ts
import { ratingForDropIndex } from './rating';
```

Then change `applyPick`'s finalization branch (the `if (newLo >= newHi)` block) from:

```ts
  if (newLo >= newHi) {
    const ranked = [
      ...state.ranked.slice(0, newLo),
      album,
      ...state.ranked.slice(newLo),
    ];
    return { ranked, pending: null };
  }
```

to:

```ts
  if (newLo >= newHi) {
    const rating = ratingForDropIndex(state.ranked, newLo);
    const ranked = [
      ...state.ranked.slice(0, newLo),
      { ...album, rating },
      ...state.ranked.slice(newLo),
    ];
    return { ranked, pending: null };
  }
```

Update the doc comment above `applyPick` (currently describes "the candidate is spliced into `ranked` at that index") to mention the rating is computed at finalization too — one sentence, not a rewrite.

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/ranking/insertion.test.ts`
Expected: PASS. The pre-existing "transitivity/no self-contradiction" property test and the "comparison count bound" test should still pass unchanged — they test the search/narrowing logic, which this step didn't touch. If either fails, stop and re-examine before proceeding; that would mean the change touched more than intended.

- [ ] **Step 5: Update `assist.ts`'s `startAssist` signature**

In `web/src/ranking/assist.ts`, change:

```ts
import type { Album, RankingState } from './types';
```
to
```ts
import type { Album, RankedAlbum, RankingState } from './types';
```

And change `startAssist`'s signature:

```ts
export function startAssist(ranked: RankedAlbum[], album: Album): AssistPlacement {
  return { album, state: startPlacement({ ranked, pending: null }, album) };
}
```

(Only the parameter type changes, from `Album[]` to `RankedAlbum[]` — the function body is identical.)

- [ ] **Step 6: Update `assist.test.ts`'s fixtures**

Run `cd web && npx tsc --noEmit` and fix whatever `assist.test.ts` fixtures the compiler flags (its `ranked` array fixtures need `rating` fields now, matching this file's own existing helper pattern).

- [ ] **Step 7: Run the full ranking-engine test suite**

```bash
cd web && npx vitest run src/ranking/
```

Expected: all pass — `insertion.test.ts`, `assist.test.ts`, `rating.test.ts`, plus `order.test.ts`/`locks.test.ts`/`setAside.test.ts`/`subRank.test.ts` (which shouldn't need behavioral changes, only fixture additions if the compiler flags them — that's Task 4's job if any remain after this task, but check now since these live in the same directory).

- [ ] **Step 8: Commit**

```bash
git add web/src/ranking/insertion.ts web/src/ranking/insertion.test.ts web/src/ranking/assist.ts web/src/ranking/assist.test.ts
git commit -m "feat(ranking): applyPick computes a rating on finalization"
```

---

### Task 3: Carry `rating` through the client and server parse functions

**Files:**
- Modify: `web/src/album.ts`
- Modify: `web/src/album.test.ts`
- Modify: `web/api/ranking.ts`
- Modify: `web/api/ranking.test.ts`

**Interfaces:**
- Consumes: `RankedAlbum` (Task 1).
- Produces: a new `parseRankedAlbum`/equivalent in each file (see below) — kept **separate** from the existing `parseAlbum`, since `parseAlbum` is still correctly used for pool/lists/discovery albums that have no rating and must keep working exactly as today.

**Important, corrected from an earlier draft of this plan:** do not add a rating requirement to the existing `parseAlbum` functions — that would break parsing for `lists` (want-to-listen/etc.) and any other plain-`Album` context these files' `parseAlbum` also serves. Instead, add a new, second function alongside the existing one, used only for the `ranked` field.

- [ ] **Step 1: Write the failing test for the client parser**

In `web/src/album.test.ts`, add a new `describe` block (do not modify the existing `parseAlbum` tests):

```ts
describe('parseRankedAlbum', () => {
  it('parses a valid rating', () => {
    const result = parseRankedAlbum({
      mbid: 'a1',
      title: 'Title',
      primary_artist_name: 'Artist',
      release_year: 2000,
      cover_url: 'https://example.test/a1.jpg',
      rating: 8.43,
    });
    expect(result?.rating).toBe(8.43);
  });

  it('rejects a missing or non-numeric rating', () => {
    const base = {
      mbid: 'a1',
      title: 'Title',
      primary_artist_name: 'Artist',
      release_year: 2000,
      cover_url: 'https://example.test/a1.jpg',
    };
    expect(parseRankedAlbum(base)).toBeNull();
    expect(parseRankedAlbum({ ...base, rating: 'high' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/album.test.ts`
Expected: FAIL — `parseRankedAlbum` doesn't exist.

- [ ] **Step 3: Add `parseRankedAlbum` to `web/src/album.ts`**

Add, after the existing `parseAlbum` function (leave `parseAlbum` itself completely unchanged):

```ts
export function parseRankedAlbum(value: unknown): RankedAlbum | null {
  const album = parseAlbum(value);
  if (!album) return null;
  const rating = isObject(value) ? value.rating : undefined;
  if (typeof rating !== 'number') return null;
  return { ...album, rating };
}

export function parseRankedAlbumArray(value: unknown): RankedAlbum[] {
  if (!Array.isArray(value)) return [];
  const albums: RankedAlbum[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const album = parseRankedAlbum(item);
    if (!album || seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    albums.push(album);
  }
  return albums;
}
```

Add `RankedAlbum` to this file's existing type import: `import type { Album, RankedAlbum } from './ranking/types';`.

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/album.test.ts`
Expected: PASS, and every pre-existing test in this file still passes unchanged (they test `parseAlbum`/`parseAlbumArray`, untouched).

- [ ] **Step 5: Find and update the caller that reconstructs the ranked snapshot from the server**

In `web/src/rankingSync.ts`, find the line using `parseAlbumArray` for the `ranked` field specifically (research found: around line 141, `ranked: parseAlbumArray(body.snapshot.ranked)`) and change **only that one call** to `parseRankedAlbumArray` — leave the `wantToListen`/`notHeard`/`dontCare` calls on the same lines using plain `parseAlbumArray`, since those are lists of plain `Album`s, not ranked ones.

- [ ] **Step 6: Write the failing test for the server parser**

In `web/api/ranking.test.ts`, add tests for the ranked-array-specific validation:

```ts
it('accepts a valid rating on an album in the ranked array', async () => {
  // Follow this file's existing pattern for a valid POST body, adding
  // `rating: 8.43` to each album object inside `ranked` specifically
  // (not inside `lists`). Assert 200, and that a follow-up GET reflects it.
});

it('rejects a ranked album missing a rating', async () => {
  // Same valid body shape, but omit `rating` from one `ranked` album.
  // Assert 400.
});

it('does not require a rating on albums inside lists (wantToListen/notHeard/dontCare)', () => {
  // A valid POST body where a `lists.wantToListen` album has no `rating`
  // field at all. Assert this still succeeds (200) -- ranked and lists
  // are validated differently.
});
```

- [ ] **Step 7: Run to verify failure**

Run: `cd web && npx vitest run api/ranking.test.ts`
Expected: the first two FAIL (server doesn't check `ranked`-specific rating yet); the third should already PASS (confirms today's behavior, a useful regression guard for the next step).

- [ ] **Step 8: Add a ranked-specific parse function to `web/api/ranking.ts`**

Add `rating: number;` only to a **new** type, not the existing local `Album` type:

```ts
type RankedAlbum = Album & { rating: number };
```

Add a new parse function alongside the existing `parseAlbum`/`parseAlbumList` (leave both completely unchanged):

```ts
function parseRankedAlbum(value: unknown): RankedAlbum | null {
  const album = parseAlbum(value);
  if (!album) return null;
  const rating = isObject(value) ? value.rating : undefined;
  if (typeof rating !== 'number') return null;
  return { ...album, rating };
}

function parseRankedAlbumList(value: unknown): RankedAlbum[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const albums: RankedAlbum[] = [];
  for (const item of value) {
    const album = parseRankedAlbum(item);
    if (!album || seen.has(album.mbid)) return null;
    seen.add(album.mbid);
    albums.push(album);
  }
  return albums;
}
```

Change the one call site that currently does `const ranked = parseAlbumList(body.ranked);` (in the POST validation function) to `parseRankedAlbumList(body.ranked)` instead — leave `parseLists`'s three calls to `parseAlbumList` (for `wantToListen`/`notHeard`/`dontCare`) untouched. Update the function's return-type annotation for `ranked` from `Album[]` to `RankedAlbum[]` at the same spot.

Also update the GET handler's line `const ranked = JSON.parse(String(row.ranking_json)) as Album[];` to `as RankedAlbum[]`.

- [ ] **Step 9: Run to verify pass**

Run: `cd web && npx vitest run api/ranking.test.ts`
Expected: all pass, including the untouched regression guard from Step 6.

- [ ] **Step 10: Commit**

```bash
git add web/src/album.ts web/src/album.test.ts web/src/rankingSync.ts web/api/ranking.ts web/api/ranking.test.ts
git commit -m "feat(ranking): add ranked-specific parsing that requires a rating"
```

---

### Task 4: Fix every remaining fixture the compiler flags

**Files:** whatever `npx tsc --noEmit` points at — expected to be a subset of the 18-file list and 2-file list identified in research (some may already be resolved by Tasks 2-3's direct edits to `insertion.test.ts`/`assist.test.ts`).

**Interfaces:** none new — this task's only job is a clean `tsc`/`npm run test` after Tasks 1-3. No behavior changes.

- [ ] **Step 1: Get the authoritative list of remaining errors**

```bash
cd web && npx tsc --noEmit
```

Expected: a shrunk list compared to right after Task 1 (Tasks 2-3 already fixed `insertion.test.ts`, `assist.test.ts`, `album.test.ts`, `ranking.test.ts`). Remaining errors will mostly be in files that construct `RankingState`/`ranked: RankedAlbum[]` fixtures without a `rating` — likely `main.test.ts`, `order.test.ts`, `locks.test.ts`, `setAside.test.ts`, `subRank.test.ts`, `rankingSync.test.ts`, and possibly others research didn't specifically flag (trust the compiler over the research list here).

- [ ] **Step 2: Fix each flagged file**

For files with a shared `function album(overrides) {...}` helper that's used to build the `ranked` array specifically, add `rating` to the helper's default return (or, if the same helper builds both ranked and non-ranked fixtures in the same file, add a second small helper, e.g. `rankedAlbum(overrides)`, that wraps the first and adds a rating — match whichever is less invasive to the file's existing structure). For files with raw object literals, add `rating: <value>` directly wherever the compiler points.

Do not change test assertions or logic — only add the missing field. If a test's assertion depended on exact array-splice order and needs updating because order is now rating-derived, that's this task's job too (it's the direct consequence of the field being required, not a separate concern) — but keep such changes minimal and clearly tied to the type change, not a broader rewrite of the test's intent.

- [ ] **Step 3: Repeat until clean**

```bash
cd web && npx tsc --noEmit
```

Expected: no output, exit 0.

- [ ] **Step 4: Run the full test suite**

```bash
cd web && npm run test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(ranking): add rating to remaining RankedAlbum fixtures"
```

---

### Task 5: Rewire `main.ts`'s placement/reorder call sites to compute ratings instead of splicing

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/main.test.ts` (if it asserts on any of these handlers' exact behavior — likely already touched in Task 4; verify here)

**Interfaces:**
- Consumes: `ratingForDropIndex(ranked: RankedAlbum[], index: number): number` (Task 1).
- Produces: nothing new — six existing callback handlers keep their signatures, only their implementation changes.

Six call sites (line numbers as of this plan's base commit — search `insertAt(`/`moveItem(` in `main.ts` if drifted):

1. Artist-lock view `onReorder` (~line 558)
2. Artist-lock view `onSetOverallRank` (~lines 570-572)
3. Artist-lock view `onPlace` (~line 577)
4. Main rank list `onPlace` (~line 667)
5. Main rank list `onReorder` (~line 674)
6. Main rank list `onSetOverallRank` (~lines 688-689)

- [ ] **Step 1: Add the import and a small local helper**

Near `main.ts`'s other `./ranking/*` imports:

```ts
import { ratingForDropIndex } from './ranking/rating';
```

Near the other free functions in `main.ts`:

```ts
/**
 * Remove `album` from `ranked` if present (re-rating an existing album),
 * compute its new rating for landing at `targetIndex` in the resulting
 * array, then return the full list with `album` re-inserted at its
 * rating-sorted position. `targetIndex` should already reflect any
 * lock-safety clamping (nearestValidDropIndex) the caller performed.
 */
function reRate(ranked: RankedAlbum[], album: Album, targetIndex: number): RankedAlbum[] {
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  const clampedIndex = Math.max(0, Math.min(targetIndex, without.length));
  const rating = ratingForDropIndex(without, clampedIndex);
  const rated: RankedAlbum = { ...album, rating };
  return [...without, rated].sort((a, b) => b.rating - a.rating);
}
```

Add `RankedAlbum` to `main.ts`'s existing type import from `./ranking/types`.

Note `reRate`'s second parameter is `album: Album`, not `RankedAlbum` — it accepts either an already-ranked album being moved (which happens to also be a `RankedAlbum`, a valid `Album` too) or a brand-new candidate with no prior rating. Either way, its own prior rating (if any) is discarded and recomputed fresh from the target position.

- [ ] **Step 2: Rewrite the artist-lock view's `onReorder` (~line 556-561)**

```ts
      onReorder: (from, to) => {
        const album = state.ranked[from];
        state = { ranked: reRate(state.ranked, album, to), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
```

- [ ] **Step 3: Rewrite the artist-lock view's `onSetOverallRank` (~line 570-575)**

```ts
      onSetOverallRank: (from, to) => {
        const clamped = nearestValidDropIndex(state.ranked, artistLocks, from, to);
        const album = state.ranked[from];
        state = { ranked: reRate(state.ranked, album, clamped), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
```

- [ ] **Step 4: Rewrite the artist-lock view's `onPlace` (~line 576-584)**

```ts
      onPlace: (album, index) => {
        state = { ranked: reRate(state.ranked, album, index), pending: null };
        lists = removeFromList(lists, album.mbid, 'wantToListen');
        lists = removeFromList(lists, album.mbid, 'notHeard');
        lists = removeFromList(lists, album.mbid, 'dontCare');
        persistRankingState();
        persistLists();
        renderArtistLockView();
      },
```

- [ ] **Step 5: Rewrite the main rank list's `onPlace` (~line 642-672)**

Only the final assignment line changes — everything above it (the `upper`/`lower` neighbor lookups and both `enqueueAtom` calls) stays exactly as-is:

```ts
      state = { ranked: reRate(before, placed, clamped), pending: null };
```

- [ ] **Step 6: Rewrite the main rank list's `onReorder` (~line 673-677)**

```ts
    onReorder: (from, to) => {
      const album = state.ranked[from];
      state = { ranked: reRate(state.ranked, album, to), pending: null };
      persistRankingState();
      rankList.render();
    },
```

- [ ] **Step 7: Rewrite the main rank list's `onSetOverallRank` (~line 687-692)**

```ts
    onSetOverallRank: (from, to) => {
      const clamped = nearestValidDropIndex(state.ranked, artistLocks, from, to);
      const album = state.ranked[from];
      state = { ranked: reRate(state.ranked, album, clamped), pending: null };
      persistRankingState();
      rankList.render();
    },
```

- [ ] **Step 8: Remove the now-unused `insertAt`/`moveItem` import**

`main.ts`'s `import { insertAt, moveItem } from './ranking/order';` is removed entirely. Do not touch `web/src/ranking/order.ts` itself — `web/src/ranking/locks.ts` still imports `moveItem` internally, unrelated to this change.

- [ ] **Step 9: Typecheck and run the full suite**

```bash
cd web && npx tsc --noEmit
npm run test
```

Expected: both clean. If `main.test.ts` asserts an exact resulting array order after a reorder/place/set-rank action, update those specific assertions to reflect rating-derived order — assert the new correct behavior, don't weaken the check.

- [ ] **Step 10: Commit**

```bash
git add web/src/main.ts web/src/main.test.ts
git commit -m "feat(main): compute ratings instead of splicing on place/reorder/set-rank"
```

---

### Task 6: Backfill script for the existing 244 albums

**Files:**
- Create: `web/scripts/backfill-ratings.mjs`

**Interfaces:** none — a one-time, manually-run script.

- [ ] **Step 1: Create the script**

Modeled on `web/scripts/export-collect-albums.mjs` (same env-loading, write-key-gated write path, `OWNER_ID` duplication-with-comment convention):

```js
/**
 * One-time backfill: give every album in the owner's current ranked list a
 * rating computed from its CURRENT position, using the same rank->rating
 * formula already built for the site export
 * (web/scripts/export-collect-albums.mjs's score()). Preserves today's
 * order exactly as the starting point for the new rating-primary model.
 *
 * Run ONCE, after the rating-primary code is deployed.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-ratings.mjs
 */
import { createClient } from '@libsql/client';

// Matches web/src/owner.ts's OWNER_ID.
const OWNER_ID = 'c0ffee00-0000-4000-8000-000000000001';

function score(rank, total) {
  const raw = 1 + (9 * (total - rank)) / (total - 1);
  return Math.round(raw * 100) / 100;
}

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Run `vercel env pull web/.env.local` first.');
    process.exit(1);
  }
  return createClient({ url, authToken });
}

const writeKey = process.env.ALBUM_CASE_WRITE_KEY;
if (!writeKey) {
  console.error('Missing ALBUM_CASE_WRITE_KEY. Set it in web/.env.local first.');
  process.exit(1);
}

const client = db();
const rows = await client.execute({
  sql: 'SELECT ranking_json, lists_json, artist_locks_json, updated_at FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});

const row = rows.rows[0];
if (!row) {
  console.error('No ranking snapshot found for the owner session.');
  process.exit(1);
}

const ranked = JSON.parse(String(row.ranking_json));
const rated = ranked.map((album, index) => ({
  ...album,
  rating: score(index + 1, ranked.length),
}));

const res = await fetch('https://album-case.vercel.app/api/ranking', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-album-case-write-key': writeKey,
  },
  body: JSON.stringify({
    session_id: OWNER_ID,
    ranked: rated,
    lists: JSON.parse(String(row.lists_json)),
    artist_locks: row.artist_locks_json ? JSON.parse(String(row.artist_locks_json)) : [],
    base_updated_at: Number(row.updated_at),
  }),
});

if (!res.ok) {
  console.error(`Backfill write failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`Backfilled ${rated.length} albums. Rank 1 rating: ${rated[0]?.rating}. Rank ${rated.length} rating: ${rated[rated.length - 1]?.rating}.`);

client.close();
```

- [ ] **Step 2: Run it for real**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
node --env-file=web/.env.local web/scripts/backfill-ratings.mjs
```

Expected: `Backfilled 244 albums. Rank 1 rating: 10. Rank 244 rating: 1.` (or the real current count).

- [ ] **Step 3: Verify against the live app**

```bash
curl -s "https://album-case.vercel.app/api/ranking?session_id=c0ffee00-0000-4000-8000-000000000001" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  const ranked = j.snapshot.ranked;
  console.log('total:', ranked.length);
  console.log('first 3:', ranked.slice(0,3).map(a => \`\${a.title} (\${a.rating})\`));
  const sorted = [...ranked].sort((a,b) => b.rating - a.rating);
  console.log('already in rating order:', JSON.stringify(sorted.map(a=>a.mbid)) === JSON.stringify(ranked.map(a=>a.mbid)));
});
"
```

Expected: `total: 244`, real titles with `rating` near 10 for the top 3, `already in rating order: true`.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/backfill-ratings.mjs
git commit -m "feat(scripts): add one-time rating backfill for existing albums"
```

---

### Task 7: Show the rating in the ranked list UI

**Files:**
- Modify: `web/src/ui/rankList.ts`
- Modify: `web/src/style.css` (if a new class is introduced)

**Interfaces:** none new — display-only addition.

- [ ] **Step 1: Locate the row-rendering code**

Find where each ranked row builds its "Overall N/Total" control (search `Overall ${subRank.overallRank}`).

- [ ] **Step 2: Add a rating display element**

```ts
const ratingEl = document.createElement('span');
ratingEl.className = 'rank-rating';
ratingEl.textContent = album.rating.toFixed(2);
```

Append it in the same row container as the existing "Overall" control, matching this file's existing DOM-construction and CSS-class conventions.

- [ ] **Step 3: Manual verification**

```bash
cd web && npm run dev
```

Confirm each row shows its rating (e.g. "9.87"), and that it updates live after a drag/reorder/set-rank action.

- [ ] **Step 4: Full suite once more**

```bash
cd web && npm run test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/rankList.ts web/src/style.css
git commit -m "feat(ui): show each album's rating in the ranked list"
```

---

### Task 8: Direct rating entry for a candidate, as an alternative to drag-to-place

**Files:**
- Modify: `web/src/ui/rankList.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/main.test.ts` (if it asserts on the candidate-handling callback props)

**Interfaces:**
- Produces: a new callback prop on the `rankList` mount, `onDirectRate?: (rating: number) => void`, invoked when the candidate screen's direct-entry input is confirmed.

Confirmed with Keith: this is an *additional* option, not a replacement — drag-to-place and the assist comparison flow (Task 2/5) are unchanged. This gives a second path for the specific case of a brand-new, unrated candidate: type a number directly instead of dragging or comparing.

- [ ] **Step 1: Add the input to the candidate-review area**

In `web/src/ui/rankList.ts`, find where the current candidate is rendered (the drag-source card / the assist comparison UI). Add a small text input + confirm button near it — e.g. "Or rate it directly:" with a numeric input (`inputMode="decimal"`, matching the existing "Overall rank" tap-to-edit input's approach to avoiding browser number-spinners) and a button. On confirm, parse the typed value; if it's a valid number in `[1, 10]`, call `opts.onDirectRate?.(parsed)`. If invalid, show the same kind of inline validation message the "Overall rank" input already uses for its own bad-input case (matching existing UX, not inventing a new pattern).

Add `onDirectRate?: (rating: number) => void;` to this file's `mountRankList` options type, alongside the existing `onSetOverallRank`.

- [ ] **Step 2: Wire it in `main.ts`**

Add a handler near the existing `onPlace`/`onReorder`/`onSetOverallRank` for the main rank list:

```ts
onDirectRate: (rating) => {
  if (!candidate) return;
  const rated: RankedAlbum = { ...candidate, rating };
  state = { ranked: [...state.ranked, rated].sort((a, b) => b.rating - a.rating), pending: null };
  persistRankingState();
  reselectCandidate();
  rankList.render();
  renderNav();
},
```

Unlike `onPlace`, this does **not** record any pairwise atoms — no comparison actually happened, so there's no winner/loser pair to log. This is an intentional, correct difference from `onPlace`, not an oversight.

- [ ] **Step 3: Typecheck and test**

```bash
cd web && npx tsc --noEmit
npm run test
```

- [ ] **Step 4: Manual verification**

```bash
cd web && npm run dev
```

With a candidate showing, confirm the direct-rate input appears, typing a value and confirming adds the album to the ranked list at the position its rating implies (verify by checking its "Overall N/Total" display matches where a rating that high should land), and that drag-to-place still works unchanged for candidates you don't use this shortcut for.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/rankList.ts web/src/main.ts web/src/main.test.ts
git commit -m "feat(rankList): add direct rating entry as an alternative to drag-to-place"
```
