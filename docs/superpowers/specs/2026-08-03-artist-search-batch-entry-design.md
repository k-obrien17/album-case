# Artist search: "Add a band" entry into the batch-rank view

## Problem

Batch-ranking a whole band's discography only works if you already have one
of their albums surfaced. `handleOpenArtistBatch` (`web/src/main.ts`) requires
an `Album` you already own (ranked, in a saved list, or already in `pool`)
before the "View all N albums" action appears. There is no way to start from
a band name you have in mind and go straight to ranking their catalog. You
have to wait for one of their albums to show up as a candidate, or get lucky
with the existing MusicBrainz album-title search surfacing one of their
records by text match.

## Scope

In scope: a dedicated artist-name search ("Add a band") that lets the owner
type a band, disambiguate between same-named artists, and land directly in
the existing artist-batch view with the full studio discography already
loaded.

Out of scope: changing `artistBatchView.ts` itself, `discover-artist.ts`, the
DB schema, or the existing album-title search (`search-album.ts` /
`buildSearchBox`'s MusicBrainz fallback). Both searches coexist; this adds a
second, artist-first entry point next to the existing album-first one.

## New API route: `web/api/search-artist.ts`

- `GET /api/search-artist?q=<free text>`
- Read-only, no write key (reads are already public in this app).
- Proxies MusicBrainz's `/artist/?query=...&fmt=json&limit=10`, mirroring
  `search-album.ts`'s existing conventions: same `User-Agent`, an
  `AbortController` with an 8s timeout, `MAX_QUERY_LENGTH` guard (400
  `query_too_long`), 400 `missing_query` on empty, 405 on non-GET,
  `Cache-Control: public, s-maxage=3600` so repeat queries don't hammer
  MusicBrainz or this route's own downstream calls.
- Maps each MusicBrainz artist hit to:
  ```
  { mbid: string; name: string; disambiguation: string | null; type: string | null; country: string | null }
  ```
  `disambiguation`, `type` (e.g. "Group", "Person"), and `country` are
  MusicBrainz-native fields carried straight through, `null` when MB omits
  them. Response body: `{ artists: ArtistResult[] }`, capped at 10.
- On a MusicBrainz error: propagate a 502-style failure the same way
  `search-album.ts` does today; the client turns that into its `error` state.

## New client module: `web/src/artistSearch.ts`

Thin fetch wrapper, same shape as `discovery.ts`:

```
export type ArtistSearchResult =
  | { status: 'found'; artists: ArtistResult[] }
  | { status: 'empty' }
  | { status: 'error' };

export async function searchArtists(query: string): Promise<ArtistSearchResult>
```

A blank/whitespace-only query short-circuits to `{ status: 'empty' }` without
a fetch. Network failure, non-OK response, or malformed JSON all map to
`{ status: 'error' }`, matching `discovery.ts`'s existing failure handling.

## New view: `web/src/ui/artistSearchView.ts`

Same mount/teardown controller pattern as `artistBatchView.ts` and
`speedRound.ts`:

```
mountArtistSearchView(container, opts): { render(): void; teardown(): void }
```

`opts`:
- `getQuery: () => string`, `onQueryChange: (q: string) => void`
- `getResults: () => ArtistSearchResultsState` (`idle | loading | error | done`,
  same discriminated-union shape as `rankList.ts`'s existing
  `SearchResultsState`)
- `onSelectArtist: (artist: ArtistResult) => void`
- `onClose: () => void`

Renders: a text input (autofocus), and below it whichever of idle / loading /
error+retry / results-list / no-matches applies. Each result row shows the
artist name as the primary line and, when present, `disambiguation`
alongside `type` and `country` as a subtitle. This is the only way to tell
same-named artists apart (e.g. multiple bands called "Genesis"), so it's not
optional. The whole row is the click target ("Rank all of {name}'s albums").
A visible cancel/back control calls `onClose`.

## Wiring into `rankList.ts`

Add `onOpenArtistSearch?: () => void` to `RankListOptions`. In
`buildSearchBox()`, append an "+ Add a band" button next to the existing
`.rank-search-input`, calling `opts.onOpenArtistSearch?.()`. This sits beside
the current album search box, not inside it. The two searches stay visually
and functionally distinct.

## Orchestration in `main.ts`

- `ViewMode` gains `'artistSearch'`.
- New state: `artistSearchQuery: string`, `artistSearchResults:
  ArtistSearchResultsState`, plus a debounce timer handle.
- `handleOpenArtistSearch()`: reset query/results to idle, `showView('artistSearch')`.
- `handleArtistSearchQueryChange(query)`: store the query; debounce ~400ms
  (min 2 characters) before calling `searchArtists`. Guard stale responses
  the same way `onSearchMusicBrainz` already does today: capture the query
  the fetch is *for*, discard the result if the live input has since moved
  on.
- `handleSelectSearchedArtist(artist: ArtistResult)`:
  1. Show a loading status ("Loading {name}'s albums…").
  2. Call `discoverArtistDetailed(session.session_id, artist.name, artist.mbid, [])`,
     the existing discovery call, with an empty `knownMbids` since this is
     a brand-new artist to the pool.
  3. `'locked'` → status message "Unlock writes to add a band." (same wording
     convention as `handleDiscoverArtist`'s locked branch); stay on the
     artist-search view.
  4. `'error'` → status message "Could not load {name}'s albums."; stay on
     the artist-search view so the owner can retry or pick a different
     result.
  5. `'empty'` → status message "No albums found for {name}."; stay on the
     artist-search view.
  6. `'found'` → merge new albums into `pool` (dedup by mbid, identical to
     `handleDiscoverArtist`'s `newToPool` filter), set `batchArtistMbid =
     artist.mbid`, `showView('artistBatch')`. This reuses
     `renderArtistBatchView` / `findAlbumByArtist` unchanged: `pool` now has
     an entry for that mbid, so the existing lookup chain resolves it.
- `renderArtistSearchView()`: mounts/tears down an `artistSearchController`,
  mirroring the existing `renderArtistBatchView`/`renderSpeedRound`
  conventions (teardown-on-leave in the `showView` transition).
- Pass `onOpenArtistSearch: handleOpenArtistSearch` into `mountRankList(...)`.

## Data flow (summary)

Tap "+ Add a band" → type "Radiohead" → debounced `GET /api/search-artist`
→ pick "Radiohead (English rock band)" from disambiguated results →
`discoverArtistDetailed` pulls the full studio discography from MusicBrainz
→ new albums merge into `pool` → view switches straight into the existing
artist-batch screen, fully populated → rate/reorder using that view's
existing controls. No changes to what happens once you're in the batch view.

## Error handling

- Query under 2 characters: no request, idle state, no message.
- Query over the length cap: same 400 guard as `search-album.ts`, surfaces
  as the generic error state client-side.
- MusicBrainz down/timeout: `error` state with a retry action.
- No artist matches: `done` with an empty array → "No bands found matching
  '{query}'." Stays on the search view.
- Selected artist resolves to zero discoverable albums (a sparse or
  mis-tagged MusicBrainz entry): `empty` status message, stays on the search
  view so a different match can be tried.
- Writes locked: covered by `discoverArtistDetailed`'s existing `'locked'`
  branch, message reused verbatim from the `handleDiscoverArtist` /
  `handleBulkDiscover` convention.
- Stale in-flight search response: guarded identically to the existing
  album-search stale-response check in `main.ts`.

## Testing

- `web/api/search-artist.test.ts`: mirrors `search-album.test.ts`, rejects
  non-GET, rejects missing/too-long query, maps a MusicBrainz artist search
  response to `ArtistResult[]`, surfaces a MusicBrainz failure as an error
  status.
- `web/src/artistSearch.test.ts`: mirrors `discovery.test.ts`, successful
  response, network failure, non-OK response, malformed JSON, blank-query
  short-circuit.
- No new pure-function unit tests for the select → discover → merge →
  open-batch orchestration in `main.ts` beyond what `handleDiscoverArtist`
  already gets today (none currently). Parity with the existing bar, not a
  new coverage obligation invented for this feature.
