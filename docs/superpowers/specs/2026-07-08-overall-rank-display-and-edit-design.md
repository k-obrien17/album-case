# Overall rank: fix, display, and direct edit

## Problem

Two related gaps surfaced while checking the artist-lock view (`web/src/ui/artistLockView.ts`) live in the browser:

1. **Year-rank is wrong inside the artist-lock view.** `computeSubRanks` groups by artist and by year over whatever `ranked` array it's given. The lock view passes it `artistAlbumsFor(...).ranked` — one artist's albums only — so the year-rank always compares an artist against itself. Since an artist rarely has two ranked albums from the same year, every row trivially shows `#1/1`, which looks broken and carries no information. It should compare against the full 201-album library, same as the main list already does correctly.
2. **No "overall" rank is visible in the lock view.** The leading number on each row there is the album's position within that one artist's albums (1st, 2nd, 3rd Radiohead album), not its true position in the full ranked list. There's no way to see, or change, an album's real overall rank from inside the artist view.

## Scope

In scope:
- Fix year-rank computation so it's always against the full ranked list, everywhere.
- Add an explicit "Overall N/Total" figure to every ranked row's subtitle, in both the main list and the artist-lock view.
- Let the "Overall" figure be tapped to edit directly: type a new position, the album moves there in the global ranked list.

Out of scope:
- Editing album metadata (title, year, artist) — "edit" here only ever means repositioning.
- Any change to the existing drag-to-reorder interaction, which stays exactly as is.
- Any change to band-rank (`Band N/Total`) computation — already correct, since band rank is inherently artist-scoped.

## Data model & computation

`computeSubRanks` (`web/src/ranking/subRank.ts`) keeps grouping by artist and by year, but every call site must now pass the **full global `ranked` array**, never a filtered subset. `SubRank` gains a third figure:

```ts
export type SubRank = {
  artistRank: number;
  artistTotal: number;
  yearRank: number | null;
  yearTotal: number | null;
  overallRank: number;   // 1-based position in the full ranked array
  overallTotal: number;  // ranked.length
};
```

`overallRank`/`overallTotal` are trivial to compute (the album's index in the array passed in, since that array is always the full global list now) but living on `SubRank` keeps one lookup path for the renderer instead of two.

## Threading the global list into the lock view

`mountRankList` (`web/src/ui/rankList.ts`) currently takes one `getRanked()` — the array it renders and drags within. The lock view needs that to stay the *filtered* per-artist list (so drag-reorder within the artist view keeps working unchanged), but also needs the *global* list to compute correct year-rank and overall-rank.

Add one new option:

```ts
export type RankListOptions = {
  getRanked: () => Album[];         // unchanged: what's rendered/dragged here
  getGlobalRanked?: () => Album[];  // new, optional: full list for subRank computation
  ...
};
```

- Main list call site (`main.ts`): omits `getGlobalRanked` — falls back to `getRanked()`, since there they're already the same array.
- Lock view call site (`artistLockView.ts`): passes `getGlobalRanked: opts.getRanked` (the lock view's own `opts.getRanked` is already the true global list — only the nested `mountRankList` call was seeing the filtered one).

`rankList.ts`'s `render()` calls `computeSubRanks(opts.getGlobalRanked?.() ?? opts.getRanked())` instead of `computeSubRanks(ranked)`, then looks up each displayed row's `SubRank` by `mbid` same as today.

## Rendering

Subtitle line changes from the current terse form to explicit labels, on every ranked row, both views:

```
Portishead
Dummy · 1994 · Band 1/1 · Year 3/6 · Overall 14/201
```

(Replaces `A1/1 · #3/6` with `Band 1/1 · Year 3/6 · Overall 14/201`.)

Candidate cards and the drag-ghost (albums with no rank yet) are unaffected — they keep using the plain `subtitle()` with no sub-rank figures, same as today.

## Editing overall rank

Tapping the **"Overall N/Total"** text (not the leading row number, and not Band/Year, which stay read-only) swaps it for an inline form: a number input pre-filled with the current overall rank, bounded `1`–`overallTotal`, plus a small "Set" submit button — same visual pattern as the existing candidate-placement number input (`buildNumberPlace`). Only one row can be in edit mode at a time (local closure state in `mountRankList`, alongside the existing `assist`/`drag` state).

- **Submit:** `rankList.ts` resolves the album's current global index via `opts.getGlobalRanked()`, converts the typed 1-indexed rank to a post-removal target index (`typed - 1`), and calls a new option with the *same shape as the existing `onReorder`* — **unclamped**:
  ```ts
  onSetOverallRank?: (from: number, to: number) => void;
  ```
  `rankList.ts` deliberately does not reuse `opts.getNearestValidDrop` here: in the lock view, that option is scoped to *within-artist* drag clamping (it's wired as `locked ? (from) => from : undefined` — i.e. "block all within-artist drag while locked"), which has nothing to do with the cross-artist move an overall-rank edit performs. Lock-safety for this action is the caller's job (see below), using the real global lock check.
  - **Main list** wires `onSetOverallRank` to clamp via the same `nearestValidDropIndex(state.ranked, artistLocks, from, to)` `main.ts` already imports for drag, then `moveItem`, persist, re-render.
  - **Lock view** gets a new `ArtistLockViewOptions.onSetOverallRank?: (from: number, to: number) => void`, wired in `main.ts`'s `renderArtistLockView()` alongside the existing `onReorder` — same clamp-then-`moveItem`-then-persist body, calling `renderArtistLockView()` to refresh. `artistLockView.ts`'s nested `mountRankList` passes its own `onSetOverallRank` straight through to this new option (not through `opts.onReorder`, which stays reserved for the existing within-artist-drag path and its filtered-to-global index translation).
- **Invalid input** (non-integer, out of range): `showStatus` with the same style of message already used elsewhere (`Enter 1-${overallTotal}.`), input stays open for another try.
- **Cancel:** clicking/tapping away (blur without submit) reverts to the static "Overall N/Total" text with no change.

## Edge cases

- **Single-album ranked list:** `Overall 1/1`, editable in principle but moving is a no-op (clamped to the only valid position).
- **Editing to the album's current position:** no-op move, harmless (`moveItem` handles `from === to` cleanly via splice).
- **Lock view + locked artist:** an artist's relative order is locked, but moving one album's *overall* position (keeping the artist's internal relative order intact) is still allowed — this only changes where the artist's block sits among other artists, not the order within it. Within-artist drag already blocks itself entirely while locked (`getNearestValidDrop: locked ? (from) => from : undefined` on the lock view's nested list). The overall-rank edit is a different action against a different index space (global, not filtered) and is allowed even while locked: its handler (see Editing overall rank) clamps `to` through `nearestValidDropIndex(state.ranked, artistLocks, from, to)` before moving, so a typed rank that would split *any* locked block (this artist's or another's) silently snaps to the nearest valid position instead of being rejected outright.

## Testing

- `web/src/ranking/subRank.test.ts`: extend for `overallRank`/`overallTotal`, and add a case proving year-rank is computed correctly when the input array is artist-filtered upstream but `computeSubRanks` itself just trusts whatever full array it's given (i.e., the test asserts the contract, the fix is in *always passing the global array in*, not in `subRank.ts` itself, which was never wrong).
- `web/src/ui/rankList.test.ts` (if present) or new test: submitting a valid overall-rank edit calls `onSetOverallRank` with the expected clamped 1-indexed target; invalid input shows a status message and does not call it.

## Non-goals

- No change to how band-rank is computed or displayed.
- No new album metadata editing (title/year/artist correction) — tracked separately if ever needed.
- No change to the main list's leading row number, which continues to double as its overall rank there (unambiguous in that view already).
