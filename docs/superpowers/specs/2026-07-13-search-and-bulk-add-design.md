# Search (local + MusicBrainz) and the bulk-add floor fix

## Problem

Two gaps, one small and one real.

**Search.** The ranked list is now 376 albums. There is no way to find one. To re-rate an album Keith has to scroll. And there is no way to add a *specific* album he has in mind — albums only arrive by surfacing randomly as a candidate, by artist-catalog discovery, or by a bulk CSV import.

**Bulk add.** `web/scripts/import-album-canon.mjs` already does incremental bulk-add correctly (albums in the CSV are added or re-rated; anything not in the CSV is left untouched). But it hard-aborts on any rating below 8.0. That guard was correct for the canon import, which was 8-to-10 by construction. It is now wrong: ratings run 0-10. A CSV containing a 7 would abort the whole run.

## Scope

In scope: a search box on the ranked view that filters the list locally and falls back to a MusicBrainz search; a new read-only API route to proxy that search; adding a searched album straight to the ranked list at a typed rating; making the import script's rating floor a parameter.

Out of scope: fuzzy/typo-tolerant matching (plain case-insensitive substring is enough for 376 albums); searching the saved lists or the candidate pool; search on any view other than `ranked`; re-enabling artist locks.

## Why MusicBrainz needs a server route

The browser cannot call MusicBrainz directly. MusicBrainz requires a meaningful `User-Agent` identifying the application, and browsers do not permit setting that header. This is exactly why the existing `web/api/discover-artist.ts` is a serverless route rather than a client fetch. The search must go through the server for the same reason.

## Local filtering (the common case)

A text input at the top of the ranked view. Typing filters the rendered rows: case-insensitive substring match against `title` **or** `primary_artist_name`. Clearing the box restores the full list.

**This is nearly free.** `mountRankList` already separates *what to render* from *the full list used for index mapping*:

- `getRanked: () => RankedAlbum[]` — the rows to render.
- `getGlobalRanked?: () => RankedAlbum[]` — the full list. `buildRatingControl` and `buildOverallControl` already resolve a filtered row back to its global index by mbid (`globalRanked.findIndex((a) => a.mbid === album.mbid)`).

This machinery was built for the artist-lock view (now paused), which rendered a filtered subset with fully working editors. Search reuses it: pass the filtered array as `getRanked` and the real `state.ranked` as `getGlobalRanked`. Every rating editor, overall-rank editor, and drag handle continues to operate on correct global indices with no further work.

Filtering is synchronous and local — the list is already in memory. No debounce needed at 376 albums; filter on every keystroke.

**Drag while filtered:** dragging within a filtered subset would compute a drop index against a partial list and produce a wrong rating. Disable drag while a filter is active (the rating and overall-rank editors remain available, and both are index-safe by construction). This mirrors how the artist-lock view already neutered drag in a filtered context.

## MusicBrainz fallback

When the query is non-empty and yields **zero** local matches, show a single action: `Search MusicBrainz for "<query>"`. It never fires automatically — only on explicit tap, so no keystroke ever hits the network.

New route, `web/api/search-album.ts`:

- `GET /api/search-album?q=<free text>`
- Read-only. **No write key** — reads are already public in this app, and this writes nothing.
- Proxies the MusicBrainz release-group search with the app's `User-Agent`, mirroring `discover-artist.ts`'s existing fetch conventions.
- Filters results through `isLpReleaseGroup` (imported from `web/api/_lp.ts` — a real TS import, unlike the scripts, which must duplicate it).
- Returns up to 10 candidates, each a full album record: `{ mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url }` — the same shape `discover-artist.ts` already produces, so it drops straight into `ranked`.
- On MusicBrainz error or zero results: return an empty list; the client shows "No albums found."

Each returned candidate renders with title, artist, year, and a rating input (0-10). Typing a rating and confirming adds the album to the ranked list at that rating, immediately.

Candidates already present in `ranked` are marked as such and are not addable again (the client has the ranked list; it filters them itself). This is a display concern, not an API one.

## Adding a searched album

Reuses the existing exported `insertAtRating(ranked, album, rating)` — remove-then-splice at the correct index. Never append-then-sort (that breaks on rating ties; there is a regression test named "splice at the computed index").

**Hard requirement, and the easiest thing to get wrong:** `web/api/ranking.ts` rejects any snapshot where an album is in `ranked` **and** in a saved list (`wantToListen` / `notHeard` / `dontCare`) with `400 ranked_album_in_saved_list`. A searched album may well be sitting in one of those lists. So adding it to `ranked` **must** also remove it from all three saved lists, exactly as the existing `onPlace` handler already does via `removeFromList`. Omitting this produces a 400 on the next save, and the failure surfaces later and confusingly. This exact bug already bit the canon import once.

No pairwise atom is recorded — no comparison happened, matching the existing `onDirectRate` precedent.

The album record is stored in full inside the ranking snapshot (snapshots carry full album records by design), so nothing needs to be written to `discovered_albums`.

## Bulk-add: make the rating floor a parameter

In `web/scripts/import-album-canon.mjs`, the guard currently rejects anything below 8.0. Change it to:

- **Always** reject a rating that is not a finite number, or is outside 0-10. This is the real invariant and must never be optional.
- **Optionally** reject below a floor, via a `RATING_FLOOR` env var. **Default: 0** (i.e. no additional floor).

So the canon import's original behavior is still available with `RATING_FLOOR=8`, and a normal bulk-add of a 0-10 CSV just works. The abort message should name the floor in effect.

Nothing else about bulk-add changes. The documented path stays:

```bash
CANON_CSV=~/path/to.csv CONFIRM_CANON_IMPORT=yes \
  node --env-file=web/.env.local web/scripts/import-album-canon.mjs
```

## Error handling

- MusicBrainz unreachable or non-OK: the route returns an empty candidate list; the client shows "Couldn't reach MusicBrainz. Try again."
- Empty or whitespace-only search query: no MusicBrainz action offered (nothing to search for).
- Rating input on a search result: same validation as every other rating input — reject empty/whitespace, reject non-finite, reject outside 0-10. (`Number('') === 0`, and 0 is a legal rating, so an empty field must be rejected explicitly or it silently rates the album 0.00. This was a real bug caught in review.)

## Testing

Pure and colocated, matching the existing convention:
- The filter predicate (title-or-artist, case-insensitive substring, empty query returns everything) — a pure function, unit tested.
- The "add a searched album" path: exercised through the already-exported `insertAtRating`, plus a test asserting the album is removed from all three saved lists.
- The import script's floor parameter: default 0 admits a 7.5; `RATING_FLOOR=8` rejects it; a NaN/out-of-range rating is rejected regardless of the floor.

The API route follows this project's existing convention for routes (`discover-artist.ts` has a thin test; match that level).

## Non-goals

- Fuzzy matching, ranking of search results by relevance, or typo tolerance.
- Debounced/as-you-type MusicBrainz queries (explicit tap only).
- Searching saved lists, the candidate pool, or blocked artists.
- Any change to artist locks (still paused).
