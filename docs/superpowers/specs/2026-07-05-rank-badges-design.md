# Artist/year rank badges

## Problem

The ranked list shows each album's overall position, artist, and year, but gives no sense of how an album stacks up within its own artist's catalog or its release year. Add that context inline, per row, without cluttering the list on a 360px-wide phone screen.

## Scope

In scope: artist-rank and year-rank badges on ranked rows.
Out of scope (deferred): genre rank. Genre is not in the `Album` data model today (only `mbid`, `title`, `primary_artist_name`, `release_year`, `cover_url`); it's designated in `DATA-SOURCES.md` as coming from Discogs in the not-yet-built Phase 1 pipeline. A quick stopgap (MusicBrainz community genre tags, fetched during seed resolution) was scoped at a rough hour of work but explicitly deferred — ship artist+year first, revisit genre as a follow-up.

## Data model & computation

New pure module `web/src/ranking/subRank.ts`, colocated with a `.test.ts`, matching the existing pattern of small single-purpose modules under `web/src/ranking/` (`order.ts`, `insertion.ts`, `assist.ts`, `setAside.ts`).

```ts
export type SubRank = {
  artistRank: number;   // 1-based position among ranked albums by same artist
  artistTotal: number;
  yearRank: number;     // 1-based position among ranked albums from same year
  yearTotal: number;
};

export function computeSubRanks(ranked: Album[]): Map<string /* mbid */, SubRank>
```

`computeSubRanks` groups the `ranked` array (already ordered, index 0 = most preferred) by `primary_artist_name` and by `release_year` in a single pass, then assigns each album its 1-based position within each group, preserving overall rank order (position 1 = the group member closest to #1 overall).

`release_year === null` (not reachable with the current seed data — verified 0 of 115 seed albums have a null year — but allowed by the `Album` type) excludes that album from year grouping entirely: no `#` badge renders for it. Same "only show it if we have it" treatment genre will eventually get.

This is a pure, synchronous, O(n) computation (single pass to build two grouping maps, single pass to assign positions) with no caching or memoization — the ranked list is currently ~115 albums and the design target is hundreds, not thousands, so recomputing once per `render()` call is not a performance concern worth engineering around.

## Rendering

`rankList.ts` calls `computeSubRanks(ranked)` once per `render()`, then each row does an O(1) `Map.get(album.mbid)` lookup. The badge text is appended inline to the existing subtitle line (`rank-sub`), not rendered as a separate element:

```
Kid A
Radiohead · 2000 · A2/4 · #1/3
```

Format: `A{artistRank}/{artistTotal}` then `#{yearRank}/{yearTotal}`, separated by the same ` · ` used between artist and year today.

This only changes the **ranked-row** rendering path (`buildRow`, via a new ranked-row-specific subtitle function). The candidate card and the drag-ghost — both of which show an album that has no rank yet — keep using the existing plain `subtitle()` unchanged.

## Edge cases

- **Solo albums** (only ranked album by that artist, or only one from that year): shown as `A1/1` / `#1/1` rather than suppressed. Explicit product decision — see Open questions/Known tradeoff below.
- **`release_year === null`:** no `#` badge. Currently unreachable in seed data; handled defensively since the type permits it.
- **Empty or single-item ranked list:** badges still compute correctly (trivially `1/1` for everything present).

## Known tradeoff

Of the 115 current seed albums, 84 are by artists with only one album in the set (max 4 by one artist). With "show 1/1 anyway," the majority of rows will display an always-true, low-information `A1/1` badge. Years are less lopsided (46 distinct years, max 7 in one year), so `#` badges will vary more meaningfully row to row. This was flagged during design and the always-show behavior was confirmed as the intended choice.

## Testing

`web/src/ranking/subRank.test.ts`: grouping correctness (by artist, by year), ordering (rank 1 = highest overall position within the group, not insertion order), and null-year exclusion from year grouping.

## Non-goals

- Genre badges (deferred, see Scope).
- Any change to the underlying `Album` data model, seed generation, or backend allowlist.
- Any change to the candidate/drag-ghost rendering paths.
