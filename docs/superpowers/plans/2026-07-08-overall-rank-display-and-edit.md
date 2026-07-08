# Overall Rank Display and Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken year-rank computation in the artist-lock view, add a visible "Overall N/Total" figure to every ranked row (main list and artist-lock view), and let that figure be tapped to type a new overall rank that repositions the album in the global ranked list.

**Architecture:** `computeSubRanks` gains an `overallRank`/`overallTotal` field and must always receive the full global ranked array (never a filtered subset) — a new optional `getGlobalRanked` option on `mountRankList` supplies this for the artist-lock view, which otherwise renders a filtered per-artist list. The "Overall" figure becomes a small tappable control with local (component-level) edit-mode state; on submit it resolves the album's true global index and calls a new `onSetOverallRank(from, to)` option with the *same shape* as the existing `onReorder`, but always in global index space. Lock-safety is the caller's responsibility (clamped via the existing `nearestValidDropIndex`), never the rendering component's — the lock view's own `getNearestValidDrop` is scoped to a different, incompatible purpose (blocking within-artist drag while locked) and must not be reused here.

**Tech Stack:** TypeScript, Vite, Vitest — no new dependencies.

## Global Constraints

- Mobile is the primary device: tap targets ≥ 44px, usable at 360px width, no horizontal scroll (project `CLAUDE.md`).
- Render with safe DOM construction (`createElement`/`textContent`), never `innerHTML` (project `CLAUDE.md`).
- Match existing code style: no comments explaining *what* code does, only non-obvious *why* (this repo's inline comments are sparse and purposeful — follow that density).
- `web/src/ui/rankList.ts` is already 565 lines, over this project's 300-line file-size guideline; this plan grows it further. No split is included in this plan (out of scope — flagged, not fixed, per project convention of not bundling unrelated refactors into a feature change).
- No new test files for DOM-heavy `web/src/ui/*` modules — this project has no test coverage for that layer today (only pure logic under `web/src/ranking/*` is colocated-tested). Follow that existing pattern; verification for the UI pieces is manual (build + browser check), not a new test framework.

---

### Task 1: Add `overallRank`/`overallTotal` to `computeSubRanks`

**Files:**
- Modify: `web/src/ranking/subRank.ts`
- Modify: `web/src/ranking/subRank.test.ts`

**Interfaces:**
- Produces: `SubRank` type gains `overallRank: number` and `overallTotal: number`. `computeSubRanks(ranked: Album[]): Map<string, SubRank>` signature is unchanged — callers already passing the array they consider authoritative get the new fields for free.

- [ ] **Step 1: Write the failing test**

Add this test to `web/src/ranking/subRank.test.ts`, inside the existing `describe('computeSubRanks', ...)` block (after the `'ranks albums from the same year...'` test):

```ts
  it('ranks albums by their overall position in the full list', () => {
    const ranked = [album({ mbid: 'a' }), album({ mbid: 'b' }), album({ mbid: 'c' })];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toMatchObject({ overallRank: 1, overallTotal: 3 });
    expect(ranks.get('b')).toMatchObject({ overallRank: 2, overallTotal: 3 });
    expect(ranks.get('c')).toMatchObject({ overallRank: 3, overallTotal: 3 });
  });
```

Also update the two existing `toEqual` (exact-match) assertions in the same file, since they'll now fail on missing keys once Step 3 lands. Replace:

```ts
    expect(ranks.get('a')).toEqual({
      artistRank: 1,
      artistTotal: 1,
      yearRank: null,
      yearTotal: null,
    });
```

with:

```ts
    expect(ranks.get('a')).toEqual({
      artistRank: 1,
      artistTotal: 1,
      yearRank: null,
      yearTotal: null,
      overallRank: 1,
      overallTotal: 1,
    });
```

and replace:

```ts
    expect(ranks.get('a')).toEqual({ artistRank: 1, artistTotal: 1, yearRank: 1, yearTotal: 1 });
```

with:

```ts
    expect(ranks.get('a')).toEqual({
      artistRank: 1,
      artistTotal: 1,
      yearRank: 1,
      yearTotal: 1,
      overallRank: 1,
      overallTotal: 1,
    });
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `cd web && npx vitest run src/ranking/subRank.test.ts`
Expected: the new "ranks albums by their overall position" test FAILS (`overallRank`/`overallTotal` undefined); the two edited `toEqual` tests also FAIL (extra keys don't yet exist to match).

- [ ] **Step 3: Implement `overallRank`/`overallTotal`**

Replace the full contents of `web/src/ranking/subRank.ts` with:

```ts
import type { Album } from './types';

export type SubRank = {
  artistRank: number;
  artistTotal: number;
  yearRank: number | null;
  yearTotal: number | null;
  overallRank: number;
  overallTotal: number;
};

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
  ranked.forEach((album, index) => {
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

    result.set(album.mbid, {
      artistRank,
      artistTotal,
      yearRank,
      yearTotal,
      overallRank: index + 1,
      overallTotal: ranked.length,
    });
  });

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/ranking/subRank.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/ranking/subRank.ts src/ranking/subRank.test.ts
git commit -m "feat(ranking): add overallRank/overallTotal to computeSubRanks"
```

---

### Task 2: Thread the global ranked array into `mountRankList`, relabel the subtitle

**Files:**
- Modify: `web/src/ui/rankList.ts`

**Interfaces:**
- Consumes: `SubRank` from Task 1 (`overallRank`, `overallTotal` fields now present).
- Produces: `RankListOptions.getGlobalRanked?: () => Album[]` — a new optional option later tasks (3, 4, 5) rely on. When omitted, callers are asserting `getRanked()` is already the full global list.

- [ ] **Step 1: Add `getGlobalRanked` to `RankListOptions`**

In `web/src/ui/rankList.ts`, in the `RankListOptions` type (currently lines 22–56), add this field directly after `getRanked: () => Album[];`:

```ts
  /** The full global ranked array, for computing correct year-rank and
   *  overall-rank when this instance renders a filtered subset (e.g. the
   *  artist-lock scoped view). Omit when `getRanked` already returns the
   *  full global list -- the main ranked-list view does. */
  getGlobalRanked?: () => Album[];
```

- [ ] **Step 2: Relabel the subtitle and drop "Overall" from it**

Replace the `rankedSubtitle` function (currently lines 92–101):

```ts
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

with:

```ts
function rankedSubtitle(album: Album, subRank: SubRank | undefined): string {
  const base = subtitle(album);
  if (!subRank) return base;

  const parts = [`Band ${subRank.artistRank}/${subRank.artistTotal}`];
  if (subRank.yearRank != null && subRank.yearTotal != null) {
    parts.push(`Year ${subRank.yearRank}/${subRank.yearTotal}`);
  }
  return `${base} · ${parts.join(' · ')}`;
}
```

(The "Overall" figure moves to its own tappable control in Task 3 — it's intentionally no longer part of this plain-text subtitle.)

- [ ] **Step 3: Use the global array for `computeSubRanks`**

In `render()` (currently lines 484–545), find:

```ts
    } else {
      const subRanks = computeSubRanks(ranked);
      const lockedArtists = new Set(opts.getLockedArtistMbids?.() ?? []);
      ranked.forEach((album, i) => listEl.append(buildRow(album, i, subRanks, lockedArtists)));
    }
```

and replace with:

```ts
    } else {
      const subRanks = computeSubRanks(opts.getGlobalRanked?.() ?? ranked);
      const lockedArtists = new Set(opts.getLockedArtistMbids?.() ?? []);
      ranked.forEach((album, i) => listEl.append(buildRow(album, i, subRanks, lockedArtists)));
    }
```

- [ ] **Step 4: Verify the project still builds**

Run: `cd web && npm run build`
Expected: builds cleanly (this step only changes internal wiring and copy — no behavior change yet for the main list, since it never passes `getGlobalRanked` and falls back to `ranked` exactly as before).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/ui/rankList.ts
git commit -m "feat(ui): thread global ranked array into mountRankList, relabel Band/Year"
```

---

### Task 3: Tappable "Overall" control with inline edit

**Files:**
- Modify: `web/src/ui/rankList.ts`
- Modify: `web/src/style.css`

**Interfaces:**
- Consumes: `RankListOptions.getGlobalRanked` (Task 2), `SubRank.overallRank`/`overallTotal` (Task 1).
- Produces: `RankListOptions.onSetOverallRank?: (from: number, to: number) => void` — both indices always in **global** ranked-array space, regardless of what `getRanked()` returns for this instance. Tasks 4 and 5 wire this.

- [ ] **Step 1: Add `onSetOverallRank` to `RankListOptions`**

In `web/src/ui/rankList.ts`, in `RankListOptions`, add this field directly after `onReorder: (from: number, to: number) => void;`:

```ts
  /** Move the album currently at global index `from` to post-removal global
   *  index `to`. Unlike `onReorder`, both indices are always in the full
   *  global ranked array's space, never a filtered subset's -- this powers
   *  the tap-to-edit "Overall" rank control, never drag. The caller is
   *  responsible for any lock-safety clamping before acting on this; this
   *  component does not clamp it (this instance's own `getNearestValidDrop`,
   *  when present, is scoped to a different, incompatible purpose). Omit to
   *  render the "Overall" figure as plain non-interactive text. */
  onSetOverallRank?: (from: number, to: number) => void;
```

- [ ] **Step 2: Add edit-mode closure state**

In `mountRankList`, directly after the existing `let assist: AssistPlacement | null = null;` line (currently line 117), add:

```ts
  // mbid of the row whose "Overall" rank is being typed, if any. Only one
  // row can be in edit mode at a time.
  let editingOverallMbid: string | null = null;
```

- [ ] **Step 3: Add the `buildOverallControl` function**

Directly after the closing brace of `buildRow` (currently line 339, right before `function actionButton`), add:

```ts
  function buildOverallControl(album: Album, subRank: SubRank | undefined): HTMLElement | null {
    if (!subRank) return null;

    if (editingOverallMbid === album.mbid) {
      const form = document.createElement('form');
      form.className = 'candidate-place rank-overall-edit';

      const input = document.createElement('input');
      input.className = 'candidate-place-input';
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(subRank.overallTotal);
      input.value = String(subRank.overallRank);
      input.setAttribute('aria-label', `Overall rank for ${album.title}`);

      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'candidate-place-button';
      btn.textContent = 'Set';

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const rank = Number(input.value);
        if (!Number.isInteger(rank) || rank < 1 || rank > subRank.overallTotal) {
          showStatus(`Enter 1-${subRank.overallTotal}.`);
          return;
        }
        editingOverallMbid = null;
        const globalRanked = opts.getGlobalRanked?.() ?? opts.getRanked();
        const from = globalRanked.findIndex((a) => a.mbid === album.mbid);
        if (from === -1) return;
        opts.onSetOverallRank?.(from, rank - 1);
      });

      // Cancel on blur, unless focus just moved from the input to this same
      // form's own submit button (a deferred check lets that focus change
      // land first).
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (editingOverallMbid === album.mbid && !form.contains(document.activeElement)) {
            editingOverallMbid = null;
            render();
          }
        }, 0);
      });

      form.append(input, btn);
      return form;
    }

    if (!opts.onSetOverallRank) {
      const span = document.createElement('span');
      span.className = 'rank-overall';
      span.textContent = `Overall ${subRank.overallRank}/${subRank.overallTotal}`;
      return span;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rank-overall';
    btn.textContent = `Overall ${subRank.overallRank}/${subRank.overallTotal}`;
    btn.setAttribute('aria-label', `Edit overall rank for ${album.title}`);
    btn.addEventListener('click', () => {
      editingOverallMbid = album.mbid;
      render();
    });
    return btn;
  }
```

- [ ] **Step 4: Append the control in `buildRow`**

In `buildRow` (currently lines 277–339), find:

```ts
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = rankedSubtitle(album, subRanks.get(album.mbid));
    meta.append(title, sub);

    li.append(num, meta);
```

and replace with:

```ts
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = rankedSubtitle(album, subRanks.get(album.mbid));
    meta.append(title, sub);

    const overallControl = buildOverallControl(album, subRanks.get(album.mbid));
    if (overallControl) meta.append(overallControl);

    li.append(num, meta);
```

- [ ] **Step 5: Add CSS for the control**

In `web/src/style.css`, directly after the `.rank-sub { ... }` block (currently lines 355–360), add:

```css
.rank-overall {
  display: block;
  margin: 2px 0 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  text-align: left;
}

button.rank-overall {
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  min-height: 32px;
}

button.rank-overall:hover {
  color: var(--color-fg);
}

.rank-overall-edit {
  margin-top: 4px;
}
```

(`.candidate-place`, `.candidate-place-input`, `.candidate-place-button` are reused as-is from the existing candidate-placement styles a few blocks above — no new input/button styling needed, they already meet the 44px touch-target minimum.)

- [ ] **Step 6: Verify the project builds and existing tests still pass**

Run: `cd web && npm run build && npx vitest run`
Expected: builds cleanly, all existing tests pass (no test yet exercises this new interaction — see Global Constraints on why no new UI test is added here).

- [ ] **Step 7: Commit**

```bash
cd web
git add src/ui/rankList.ts src/style.css
git commit -m "feat(ui): add tappable Overall rank control with inline edit"
```

---

### Task 4: Wire the main ranked list

**Files:**
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `RankListOptions.onSetOverallRank` (Task 3), existing `moveItem` (`./ranking/order`) and `nearestValidDropIndex` (`./ranking/locks`) imports (already present in this file — no new imports needed).

- [ ] **Step 1: Add `onSetOverallRank` to the main list's `mountRankList` call**

In `web/src/main.ts`, inside the `const rankList = mountRankList(stage, { ... })` call, find the existing `onReorder` entry:

```ts
    onReorder: (from, to) => {
      state = { ranked: moveItem(state.ranked, from, to), pending: null };
      persistRankingState();
      rankList.render();
    },
```

and add this directly after it:

```ts
    onSetOverallRank: (from, to) => {
      const clamped = nearestValidDropIndex(state.ranked, artistLocks, from, to);
      state = { ranked: moveItem(state.ranked, from, clamped), pending: null };
      persistRankingState();
      rankList.render();
    },
```

(No `getGlobalRanked` needed on this call site — the main list's `getRanked: () => state.ranked` is already the full global array, so `buildOverallControl`'s `opts.getGlobalRanked?.() ?? opts.getRanked()` falls back correctly.)

- [ ] **Step 2: Verify the project builds**

Run: `cd web && npm run build`
Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
cd web
git add src/main.ts
git commit -m "feat(main): wire overall-rank edit for the main ranked list"
```

---

### Task 5: Wire the artist-lock view

**Files:**
- Modify: `web/src/ui/artistLockView.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `RankListOptions.getGlobalRanked`, `RankListOptions.onSetOverallRank` (Task 3); existing `ArtistLockViewOptions.onReorder`, `getRanked` (unchanged, already global in this scope).
- Produces: `ArtistLockViewOptions.onSetOverallRank?: (from: number, to: number) => void` — new option, wired by `main.ts`'s `renderArtistLockView()`.

- [ ] **Step 1: Add `onSetOverallRank` to `ArtistLockViewOptions`**

In `web/src/ui/artistLockView.ts`, in the `ArtistLockViewOptions` type, find:

```ts
  onReorder: (from: number, to: number) => void;
```

and add directly after it:

```ts
  /** Move the album at global index `from` to post-removal global index
   *  `to`. Always global-space, regardless of this view's filtered
   *  rendering -- distinct from `onReorder`, which exists for the
   *  within-artist drag path and its filtered-to-global index translation. */
  onSetOverallRank?: (from: number, to: number) => void;
```

- [ ] **Step 2: Wire the nested `mountRankList` call**

In `web/src/ui/artistLockView.ts`, in `render()`, find the nested `mountRankList` call:

```ts
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
      getNearestValidDrop: locked ? (from: number) => from : undefined,
    });
```

and replace with:

```ts
    ranklistController = mountRankList(rankedCol, {
      getRanked: () => artistAlbumsFor(artistMbid, opts.getRanked(), opts.getLists(), opts.getPool()).ranked,
      getGlobalRanked: () => opts.getRanked(),
      getCandidate: () => null,
      hideCandidateColumn: true,
      emptyRankedMessage: `None of ${artistName}'s albums are ranked yet.`,
      onPlace: () => {},
      onReorder: (from, to) => {
        const mapped = mapFilteredReorderToGlobal(opts.getRanked(), artistMbid, from, to);
        if (mapped) opts.onReorder(mapped.from, mapped.to);
      },
      onSetOverallRank: (from, to) => {
        opts.onSetOverallRank?.(from, to);
      },
      onSetAside: () => {},
      onSkip: () => {},
      onBlockArtist: () => {},
      getNearestValidDrop: locked ? (from: number) => from : undefined,
    });
```

- [ ] **Step 3: Implement `onSetOverallRank` in `main.ts`'s `renderArtistLockView`**

In `web/src/main.ts`, inside `renderArtistLockView()`, find the existing `onReorder` entry passed to `mountArtistLockView`:

```ts
      onReorder: (from, to) => {
        state = { ranked: moveItem(state.ranked, from, to), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
```

and add this directly after it:

```ts
      onSetOverallRank: (from, to) => {
        const clamped = nearestValidDropIndex(state.ranked, artistLocks, from, to);
        state = { ranked: moveItem(state.ranked, from, clamped), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
```

- [ ] **Step 4: Verify the project builds**

Run: `cd web && npm run build`
Expected: builds cleanly.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/ui/artistLockView.ts src/main.ts
git commit -m "feat(lock-view): wire overall-rank edit, fix year-rank to use global list"
```

(This commit is also what fixes the original year-rank bug — Task 2's `getGlobalRanked` wiring, landed here for the lock view specifically, is what makes `computeSubRanks` finally see the full library instead of one artist's own albums.)

---

### Task 6: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests PASS (including the Task 1 additions).

- [ ] **Step 2: Run the production build**

Run: `cd web && npm run build`
Expected: builds cleanly, no TypeScript errors.

- [ ] **Step 3: Manual browser check**

Start the dev server (`cd web && npm run dev`), open the app, and check:
- Main ranked list: every row shows `Band X/Y · Year X/Y` in the subtitle and a separate `Overall N/Total` line below it.
- Tap `Overall N/Total` on any main-list row → becomes a number input + "Set" button. Enter a different valid number → row moves to that position, list re-renders, banner/list counts stay consistent.
- Enter an out-of-range number (e.g. `0` or a number larger than the list) → status message appears, input stays open.
- Open the artist-lock view (⚷) for an artist with multiple ranked albums that don't all share a release year with each other elsewhere in the library → confirm `Year X/Y` is no longer always `1/1` (this is the original bug fix).
- In the lock view, tap `Overall N/Total` on one of the artist's albums, set a new number → album moves in the *global* list (confirm by going back to the main ranked list and checking its new position), while the artist's own internal relative order among its other albums is unaffected.
- Repeat the lock-view edit on a **locked** artist → still works (moves the whole block), and confirm it does not let the typed position land inside another locked artist's block (snaps to the nearest valid spot instead).

- [ ] **Step 4: Report back**

Confirm to Keith that both the original bug (year-rank always `1/1` in the lock view) and the new feature (Overall rank display + direct edit) check out, or report anything that didn't match the above.
