# Rating as the organizing principle

## Problem

Album Case's ranked list is currently ordinal-only: an album's position comes purely from being placed via binary-search comparison against its current neighbors (`web/src/ranking/insertion.ts`), and the array itself is the only record of order — there is no numeric value anywhere. This was a deliberate choice (`insertion.ts`'s own doc comment: *"transitive by construction... NOT Elo... only ordinal position"*), and the site-export feature shipped earlier this session was built specifically to respect it: score is computed only at export time, from position, never stored (`docs/superpowers/specs/2026-07-11-album-score-export-design.md`).

Keith has since decided, explicitly and repeatedly, to reverse this: ratings become the primary, stored, organizing value for every album, and the list's order is a byproduct of sorting by rating — not the other way around. This is driven by wanting to bulk-adopt externally-rated lists (a 396-album ChatGPT-generated canon, see the companion spec `2026-07-12-album-canon-import-design.md`) directly, without forcing every album through a comparison walk first.

## Scope

In scope: adding a persisted `rating` field to every album, changing the ranked list to always be sorted by rating, changing what dragging/dropping an album does (recalculate its rating, not just splice its position), changing how a brand-new album gets its first rating (still via the existing comparison flow, but the result becomes a rating instead of just a position), and reconciling the existing artist-lock feature with rating-driven order.

Out of scope: the specific 396-album import script (separate spec, depends on this one), any change to the site-export feature (still just reads whatever the current top-N ratings are — this spec doesn't change its formula or output, since ratings are now real stored numbers instead of derived-only ones, but the export script's own logic barely changes: `score(rank, total)` becomes largely unnecessary since the real `rating` field can be exported directly, but that's a small follow-up, not core to this spec).

## Data model

`Album` (`web/src/ranking/types.ts`) gains one field:

```ts
export type Album = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  primary_artist_mbid?: string;
  release_year: number | null;
  cover_url: string;
  rating: number;   // 1.00-10.00, 2 decimal places. Single source of truth for order.
};
```

`rating` is required, not optional — every album in `ranked` always has one (see Migration below for how existing albums get their starting value, and New albums for how freshly-placed ones get theirs). Albums in `lists` (want-to-listen/not-heard/don't-care) and the unranked candidate pool do **not** need a rating — it's only meaningful for albums actually in `ranked`, since it only exists to drive that list's order.

No schema migration needed on the Turso side: `ranking_snapshots.ranking_json` is already a JSON blob of `Album[]` with no fixed column-level schema, so adding a field to the objects it contains is just a matter of what the client reads/writes — the same pattern the export-script work already established (add a field, no `ALTER TABLE`).

## Sort order

`ranked` is always kept sorted by `rating` descending. This replaces the current model where the array's order *is* the data — now the array is a derived view, and `rating` is the data.

Practically: `web/src/ranking/order.ts`'s `insertAt`/`moveItem` (currently: splice at a given index) get replaced by a single operation — set an album's rating, then re-sort the whole array by rating. There's no more "insert at index 7"; there's only "this album's rating is now 8.43," and index 7 is wherever that lands after sorting. `web/src/ranking/subRank.ts`'s `computeSubRanks` needs no change at all — it already derives `overallRank`/`overallTotal` purely from array position, and since the array is now always rating-sorted, "Overall rank" continues to mean exactly what it always meant (1 = your highest-rated album), just computed on data that's now sorted by rating instead of manually spliced.

## Dragging: recalculating a rating from a drop position

Today, dropping an album at index `i` in the UI calls `moveItem`/`insertAt` (or, for the "Overall rank" tap-to-edit box, `nearestValidDropIndex` then `moveItem` — see `web/src/main.ts:570-572,687-689` and `web/src/ui/rankList.ts:418`) to splice it into that exact array position. All of these call sites change to: **compute a new rating from the drop position, don't splice.**

New pure function, `web/src/ranking/rating.ts`:

```ts
/**
 * The rating a newly-dropped album should get to land at `index` in
 * `ranked` (an array already sorted by rating descending, and NOT
 * containing the album being placed -- remove it first if it's already
 * present). Interpolates between the ratings immediately above and below
 * the target index; clamps to the 1.00-10.00 range at the ends.
 */
export function ratingForDropIndex(ranked: Album[], index: number): number {
  const clamped = Math.max(0, Math.min(index, ranked.length));
  const above = ranked[clamped - 1]?.rating;
  const below = ranked[clamped]?.rating;

  if (above == null && below == null) return 10; // empty list
  if (above == null) return Math.min(10, round2(below! + 0.5));   // dropped at the very top
  if (below == null) return Math.max(1, round2(above - 0.5));    // dropped at the very bottom
  return round2((above + below) / 2);                            // between two existing albums
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

Every existing call site that currently does "compute target index, then `moveItem`/`insertAt`" changes to "compute target index (same as today, including `nearestValidDropIndex` for artist-lock clamping — see below), call `ratingForDropIndex`, assign the new rating to that album, re-sort `ranked` by rating." The UI-facing behavior (drag an album, see it land roughly where you dropped it) is unchanged from the user's perspective — what changes is that a real number is now attached, not just a position.

**Known, accepted limitation:** repeatedly dropping albums into the exact same narrow gap will eventually exhaust the 0.01 precision available between two neighbors (interpolating a midpoint of two ratings 0.01 apart rounds back to one of them, producing a tie). At a 1-10 range and 2 decimals, there are 900 distinct values — far more than this app's realistic album count needs, so this isn't a near-term problem, and it's the same category of limitation this session already found and accepted for the site-export formula's precision. Not solved here; noted as a known edge case, not a defect.

## New albums: comparison flow produces a rating, not just a position

`web/src/ranking/insertion.ts`'s `startPlacement`/`nextComparison`/`applyPick` binary-search flow is **unchanged** as the mechanism for placing a brand-new, never-rated album — it's still the best way to find a rough spot with zero prior information, and Keith explicitly chose to keep it for exactly this case. What changes is the very last step: `applyPick`'s current behavior (splice the album into `ranked` at the resolved index) becomes "compute `ratingForDropIndex` at the resolved index, attach that rating to the album, insert it, re-sort" — mechanically the same change as the dragging case above, just triggered by the comparison flow's resolution instead of a manual drag.

## Artist locks: reconciling with rating-driven order

`web/src/ranking/locks.ts`'s `nearestValidDropIndex`/`wouldViolateLock`/`isValidOrder` operate on array positions today (does moving an item from index A to B preserve every lock's relative order?). These stay **structurally the same** — they still answer "would this arrangement violate a lock" by checking relative order in the (now rating-sorted) array, which is a index-based question regardless of why the array is in that order. The one change: since the array is always rating-sorted now, "moving an item" really means "changing its rating enough to change its sort position" — so the drag/drop call sites run `nearestValidDropIndex` first (exactly as today) to find a lock-safe target index, then feed that index into `ratingForDropIndex` instead of `moveItem`. No change to the lock-checking logic itself.

## Migration: backfilling the existing 244 albums

One-time script, run once when this ships (`web/scripts/backfill-ratings.mjs`): loads the current ranking snapshot via the existing `/api/ranking` GET path, computes `rating = score(index+1, ranked.length)` for every album using the same rank→rating formula already built for the site-export script (`web/scripts/export-collect-albums.mjs`'s `score(rank, total)`) — reimplemented as a small duplicated function in this script, the same duplication-over-cross-import pattern already established for `OWNER_ID` and for this exact formula across scripts, not a literal import between two standalone `.mjs` files — and writes the updated snapshot back via the existing `/api/ranking` POST path (write-key gated, respecting `base_updated_at` versioning, same as any other client write). This exactly preserves today's order as the starting point — after backfill, sorting by the new `rating` field reproduces the identical order that existed before this feature shipped.

## UI display

The existing "Overall N/Total" display (`web/src/ui/rankList.ts`) needs no structural change — it's still index-derived and still means the same thing. What's worth adding (not required, but the obvious payoff of this whole change): showing the actual `rating` value somewhere in the row, since it now exists as real data rather than only being computable at export time. Exact placement/styling is an implementation-time UI decision, not a design fork worth blocking on here.

## Testing

Existing tests to update, not rewrite from scratch: `web/src/ranking/insertion.test.ts` (assert `applyPick`'s result carries a correctly-interpolated rating, not just a spliced position), `web/src/ranking/order.test.ts` (if `insertAt`/`moveItem` are removed/replaced, their tests move to cover `ratingForDropIndex` instead), `web/src/ranking/locks.test.ts` (unchanged logic, but fixtures now need a `rating` field on fixture albums), `web/src/ranking/subRank.test.ts` (should need zero changes — it never referenced position-setting, only reads).

New test file: `web/src/ranking/rating.test.ts` — covers `ratingForDropIndex`'s interpolation math (midpoint between two neighbors, clamping at both ends of an empty/single-item list, the 1.00/10.00 boundary clamps).

## Non-goals

- Any change to the site-export script's formula or output shape in this spec (a real `rating` field existing makes the export simpler, but that's a small, separate follow-up).
- Solving rating-precision exhaustion from repeated same-gap insertions (noted as a known, accepted limitation above).
- A UI for directly typing a rating number (the existing "Overall rank" tap-to-edit box already provides an index-based way to set one indirectly; a direct numeric-rating input is a reasonable future addition, not required by this spec).
- Any change to how `lists` (want-to-listen/etc.) or the candidate pool work — rating only applies to `ranked`.
