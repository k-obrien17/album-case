# Rank Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each ranked album's position within its own artist's ranked albums and within its own release year's ranked albums, inline in the existing subtitle text.

**Architecture:** A new pure function computes both rankings in one pass over the ranked list; the existing row-rendering code looks up the precomputed result per album and appends it to the subtitle string it already builds.

**Tech Stack:** TypeScript, Vite, Vitest. No new dependencies.

## Global Constraints

- File size cap: 300 lines per file. `web/src/ui/rankList.ts` is already 436 lines — new logic goes in a new file, not appended to it.
- No comments except where they explain non-obvious WHY, not WHAT.
- Colocate tests as `<name>.test.ts` next to the source file (this project's existing convention; see `web/src/ranking/order.test.ts`).
- Render via `document.createElement`/`textContent`, never `innerHTML`.
- Badge format: `A{artistRank}/{artistTotal}` then `#{yearRank}/{yearTotal}`, separated by ` · ` (matching the existing artist/year separator), appended to the existing subtitle text.
- Always show both badges, including `1/1` (no suppression for solo artist/year) — confirmed product decision.
- No `#` badge when `release_year` is `null` (not reachable in the current 115-album seed, but the `Album` type permits it).
- Spec: `docs/superpowers/specs/2026-07-05-rank-badges-design.md`.

---

### Task 1: `computeSubRanks` pure function

**Files:**
- Create: `web/src/ranking/subRank.ts`
- Test: `web/src/ranking/subRank.test.ts`

**Interfaces:**
- Produces: `export type SubRank = { artistRank: number; artistTotal: number; yearRank: number | null; yearTotal: number | null }` and `export function computeSubRanks(ranked: Album[]): Map<string, SubRank>` (keyed by `Album.mbid`), imported by Task 2 from `web/src/ranking/subRank.ts`.

- [ ] **Step 1: Write the failing test**

Create `web/src/ranking/subRank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Album } from './types';
import { computeSubRanks } from './subRank';

function album(overrides: Partial<Album> & { mbid: string }): Album {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Artist X',
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

describe('computeSubRanks', () => {
  it('ranks albums by the same artist in overall ranked order', () => {
    const ranked = [
      album({ mbid: 'a', primary_artist_name: 'Radiohead' }),
      album({ mbid: 'b', primary_artist_name: 'Other' }),
      album({ mbid: 'c', primary_artist_name: 'Radiohead' }),
    ];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toMatchObject({ artistRank: 1, artistTotal: 2 });
    expect(ranks.get('c')).toMatchObject({ artistRank: 2, artistTotal: 2 });
    expect(ranks.get('b')).toMatchObject({ artistRank: 1, artistTotal: 1 });
  });

  it('ranks albums from the same year in overall ranked order', () => {
    const ranked = [
      album({ mbid: 'a', release_year: 2007 }),
      album({ mbid: 'b', release_year: 2000 }),
      album({ mbid: 'c', release_year: 2007 }),
    ];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toMatchObject({ yearRank: 1, yearTotal: 2 });
    expect(ranks.get('c')).toMatchObject({ yearRank: 2, yearTotal: 2 });
    expect(ranks.get('b')).toMatchObject({ yearRank: 1, yearTotal: 1 });
  });

  it('excludes a null-year album from year grouping but still ranks it by artist', () => {
    const ranked = [album({ mbid: 'a', release_year: null })];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toEqual({
      artistRank: 1,
      artistTotal: 1,
      yearRank: null,
      yearTotal: null,
    });
  });

  it('always includes an entry for a solo artist/year, no suppression', () => {
    const ranked = [album({ mbid: 'a' })];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toEqual({ artistRank: 1, artistTotal: 1, yearRank: 1, yearTotal: 1 });
  });

  it('returns an empty map for an empty ranked list', () => {
    expect(computeSubRanks([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/ranking/subRank.test.ts`
Expected: FAIL — `Cannot find module './subRank'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/ranking/subRank.ts`:

```ts
import type { Album } from './types';

export type SubRank = {
  artistRank: number;
  artistTotal: number;
  yearRank: number | null;
  yearTotal: number | null;
};

/**
 * Per-album rank within its own artist's ranked albums and within its own
 * release year's ranked albums, both 1-based and both counted in overall
 * ranked order (position 1 = the group member closest to #1 overall).
 */
export function computeSubRanks(ranked: Album[]): Map<string, SubRank> {
  const byArtist = new Map<string, Album[]>();
  const byYear = new Map<number, Album[]>();

  for (const album of ranked) {
    const artistGroup = byArtist.get(album.primary_artist_name) ?? [];
    artistGroup.push(album);
    byArtist.set(album.primary_artist_name, artistGroup);

    if (album.release_year != null) {
      const yearGroup = byYear.get(album.release_year) ?? [];
      yearGroup.push(album);
      byYear.set(album.release_year, yearGroup);
    }
  }

  const result = new Map<string, SubRank>();
  for (const album of ranked) {
    const artistGroup = byArtist.get(album.primary_artist_name) as Album[];
    const artistRank = artistGroup.indexOf(album) + 1;
    const artistTotal = artistGroup.length;

    let yearRank: number | null = null;
    let yearTotal: number | null = null;
    if (album.release_year != null) {
      const yearGroup = byYear.get(album.release_year) as Album[];
      yearRank = yearGroup.indexOf(album) + 1;
      yearTotal = yearGroup.length;
    }

    result.set(album.mbid, { artistRank, artistTotal, yearRank, yearTotal });
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/ranking/subRank.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/ranking/subRank.ts web/src/ranking/subRank.test.ts
git commit -m "feat: compute per-album artist/year sub-ranks"
```

---

### Task 2: Wire badges into the ranked-row subtitle

**Files:**
- Modify: `web/src/ui/rankList.ts:1` (imports)
- Modify: `web/src/ui/rankList.ts:64-67` (add a ranked-row subtitle function alongside the existing `subtitle`)
- Modify: `web/src/ui/rankList.ts:234-263` (`buildRow` — accept the sub-ranks map, use the new subtitle function)
- Modify: `web/src/ui/rankList.ts:374-421` (`render` — compute the map once, pass it to `buildRow`)

**Interfaces:**
- Consumes: `computeSubRanks(ranked: Album[]): Map<string, SubRank>` and `type SubRank` from Task 1 (`web/src/ranking/subRank.ts`).
- Produces: no new exports; `buildRow`'s signature changes from `(album: Album, index: number)` to `(album: Album, index: number, subRanks: Map<string, SubRank>)` — internal to this file, no other file calls `buildRow` directly.

No dedicated unit test for this step: `rankList.ts` is DOM-wiring code with no existing test file (consistent with this project's pattern — only pure logic modules get colocated tests; see `web/src/seed.ts` vs `web/src/main.ts`, both similarly untested at the DOM-wiring layer). Verified instead by the build step and a manual check.

- [ ] **Step 1: Add the import**

In `web/src/ui/rankList.ts`, change line 1 from:

```ts
import type { Album } from '../ranking/types';
```

to:

```ts
import type { Album } from '../ranking/types';
import { computeSubRanks, type SubRank } from '../ranking/subRank';
```

- [ ] **Step 2: Add the ranked-row subtitle function**

In `web/src/ui/rankList.ts`, immediately after the existing `subtitle` function (currently lines 64-67):

```ts
function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}
```

add:

```ts
/** Ranked-row subtitle: the existing artist/year line plus rank badges. Only
 * used for rows already in the ranked list -- an unranked candidate has no
 * rank to report, so the candidate card and drag-ghost keep using `subtitle`. */
function rankedSubtitle(album: Album, subRank: SubRank | undefined): string {
  const base = subtitle(album);
  if (!subRank) return base;

  const parts = [`A${subRank.artistRank}/${subRank.artistTotal}`];
  if (subRank.yearRank != null && subRank.yearTotal != null) {
    parts.push(`#${subRank.yearRank}/${subRank.yearTotal}`);
  }
  return `${base} · ${parts.join(' · ')}`;
}
```

- [ ] **Step 3: Use it in `buildRow`**

In `web/src/ui/rankList.ts`, `buildRow` currently reads (lines 234-263):

```ts
  function buildRow(album: Album, index: number): HTMLLIElement {
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
    sub.textContent = subtitle(album);
    meta.append(title, sub);
```

Change the function signature and the `sub.textContent` line:

```ts
  function buildRow(album: Album, index: number, subRanks: Map<string, SubRank>): HTMLLIElement {
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
```

(The rest of `buildRow` — the grip button and `li.append(num, meta, grip)` — is unchanged.)

- [ ] **Step 4: Compute the map once per render and pass it through**

In `web/src/ui/rankList.ts`, `render()` currently builds rows like this (inside the function that starts at line 374):

```ts
    // Rebuild rows in place.
    listEl.textContent = '';
    const ranked = opts.getRanked();
    if (ranked.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'rank-empty';
      empty.textContent = 'Your ranked list is empty. Drag the next album in, or tap it to start.';
      listEl.append(empty);
    } else {
      ranked.forEach((album, i) => listEl.append(buildRow(album, i)));
    }
```

Change to:

```ts
    // Rebuild rows in place.
    listEl.textContent = '';
    const ranked = opts.getRanked();
    if (ranked.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'rank-empty';
      empty.textContent = 'Your ranked list is empty. Drag the next album in, or tap it to start.';
      listEl.append(empty);
    } else {
      const subRanks = computeSubRanks(ranked);
      ranked.forEach((album, i) => listEl.append(buildRow(album, i, subRanks)));
    }
```

- [ ] **Step 5: Run the build to verify type-correctness**

Run: `cd web && npm run build`
Expected: succeeds with no TypeScript errors (this is a type-checked change — a wrong `buildRow` call site or signature mismatch fails here).

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `cd web && npm run test`
Expected: PASS, all existing suites plus the 5 new `subRank.test.ts` cases (90 + 5 = 95 tests, no failures).

- [ ] **Step 7: Manual verification**

Run: `cd web && npm run dev`, open the printed local URL, switch to the ranked-list view.
Expected: each ranked row's second line reads e.g. `Radiohead · 2000 · A2/4 · #1/3` — badges present on every row, `#` badge absent only if a row somehow has a null year (not expected with the current seed). Check at a narrow viewport (~360px) that the line wraps acceptably rather than overflowing horizontally.

- [ ] **Step 8: Commit**

```bash
git add web/src/ui/rankList.ts
git commit -m "feat: show artist/year rank badges on ranked rows"
```

---

## Self-Review Notes

- **Spec coverage:** data/computation (Task 1), rendering/format (Task 2 steps 1-3), always-show-1/1 behavior (Task 1 test 4 + Task 2's `rankedSubtitle` unconditionally appending both parts), null-year exclusion (Task 1 test 3, Task 2's conditional `#` push), candidate/drag-ghost untouched (Task 2 only modifies `buildRow`, not `buildDragBody`/`buildCandidate`/`buildAssisted`, all of which keep calling the original `subtitle`). No spec section without a task.
- **Placeholder scan:** none found.
- **Type consistency:** `SubRank` defined once in Task 1, imported (not redefined) in Task 2; `computeSubRanks` signature matches its one call site in Task 2 Step 4.
