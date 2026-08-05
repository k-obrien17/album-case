# Unified artist search: design

## Context

The "Add a band" feature shipped earlier this session as a separate view: a
"+ Add a band" button next to the album search box, opening
`artistSearchView.ts` with its own search-then-select flow. Keith's feedback
after using it: too much friction, two boxes doing overlapping jobs. This
spec redesigns it into a single merged search experience and removes the
extra view.

## Decisions

1. **No write-key gate on search or browse.** Only actual persistence
   (ranking placements, and the owner's discovered-albums cache) stays
   gated behind `ALBUM_CASE_WRITE_KEY`. This is unchanged from today's
   behavior for album search; it extends the same rule to artist
   browsing.
2. **One search box, not two.** The separate "+ Add a band" entry point and
   `artistSearchView.ts` are deleted. Artist search is merged into the
   existing "Search your albums" box. Results can be album hits (rate
   directly, unchanged) or band hits ("See all N albums", triggers a
   discovery fetch).

## Data flow

One search box, one `/api/search-album` + `/api/search-artist` call fired
together on input. Results merge into a single list with two kinds of rows:

- **Album hit**: clicking it rates directly, same as today.
- **Band hit**: clicking it shows "See all N albums", which triggers a
  discovery fetch (the existing `browse-artist`/`discover-artist` flow)
  before the band's albums appear as rateable rows.

No separate view, no separate button. The merge and the fetch both happen
client-side off the one box.

## Write-key branching mechanism

Grounded in the current code: `discoverArtistDetailed` in
`web/src/discovery.ts` already short-circuits to `{ status: 'locked' }`
client-side when no write key is set. `ranking.ts` confirms ranking
snapshots store full album records inline; they don't depend on
`discovered_albums` existing. This means discovery can be split into a
locked (browse-only) path and an unlocked (persisting) path without
touching how ranking works.

**Locked (no write key), browse mode:** a new unauthenticated GET route,
`/api/browse-artist`, mirrors `search-album.ts`'s pattern: no
`requireWriteKey`, no DB writes, fetches and filters from MusicBrainz and
returns the album list directly. The MusicBrainz browse-and-filter logic
currently inlined in `discover-artist.ts` as `fetchArtistLps` is extracted
into `_lp.ts` so both routes share it.

Client-side, `discoverArtistDetailed`'s locked branch changes from
"return `{ status: 'locked' }` and stop" to "call `/api/browse-artist`
instead." Same result shape (`found` / `empty` / `error`), just sourced
from browse instead of persisted discover.

**Unlocked (write key present), persist mode:** unchanged. POSTs to
`/api/discover-artist`, which fetches from MusicBrainz and writes to
`discovered_albums` as it does today.

Because the branch lives in one shared function, every caller
(`artistBatchView.ts`'s `onDiscover`, and the new merged search box's
band-hit handler) gets the locked-browse / unlocked-persist split for
free. No per-call-site branching logic.

## File-level changes

New:
- `web/api/browse-artist.ts`: unauthenticated GET route, browse-only, no
  persistence.

Modified:
- `web/api/_lp.ts`: extract the shared MusicBrainz browse-and-filter
  helper (currently `fetchArtistLps` in `discover-artist.ts`) so both
  `discover-artist.ts` and `browse-artist.ts` use it.
- `web/api/discover-artist.ts`: POST handler calls the shared browse
  helper instead of its own local copy, then persists as before.
- `web/src/discovery.ts`: `discoverArtistDetailed`'s locked branch calls
  `/api/browse-artist` instead of returning `{ status: 'locked' }`
  immediately.
- `web/src/ui/rankList.ts`: remove the "+ Add a band" button; the search
  box's result renderer merges album hits and band hits into one list.
- `web/src/artistSearch.ts`: becomes an inline client call consumed by the
  merged results renderer, not a separate view's backing data.
- `web/src/main.ts`: remove the `'artistSearch'` ViewMode/state/handlers;
  wire band-hit clicks in the unified results list through
  `discoverArtistDetailed` (browse or persist depending on write-key
  state) and render the returned albums as a rateable batch, reusing
  `artistBatchView.ts`.
- `web/src/style.css`: remove the now-unused "+ Add a band" button rule.

Deleted:
- `web/src/ui/artistSearchView.ts` (whole file).

## Error handling

**MusicBrainz proxy errors:** `browse-artist.ts` mirrors
`search-album.ts`'s existing pattern (`AbortController` + 8s timeout,
catch-all to `502 musicbrainz_unavailable`). `discover-artist.ts`'s fetch
gets the same treatment once the browse logic is shared via `_lp.ts`; this
isn't new risk, just a second call site for existing handling.

**Merged search box, partial failure:** `/api/search-album` and
`/api/search-artist` fire together. If one fails and the other succeeds,
show whichever succeeded rather than failing the whole search.
`discoverArtistDetailed`'s existing `found` / `empty` / `error` result
shape covers the band-hit branch the same way it does today; no new states
needed.

**Shared MusicBrainz rate limit:** `search-album.ts` already flags that MB
rate-limits roughly 1 req/s across `search-album`, `discover-artist`, and
the canon import script. `browse-artist` becomes a fourth consumer of that
budget and gets the same `Cache-Control: public, s-maxage=3600` treatment
`search-album.ts` uses, so repeated browses of the same artist don't
re-hit MusicBrainz.

## Testing

- New `web/api/browse-artist.test.ts`, following `search-album.test.ts`'s
  mocked-fetch pattern.
- `web/src/discovery.test.ts`: new cases for the locked branch calling
  browse instead of short-circuiting.
- `web/src/artistSearch.test.ts`: stays as-is; the client wrapper for
  `/api/search-artist` survives, just consumed differently.
- `web/src/main.test.ts`: loses the `artistSearch` ViewMode tests, gains
  merged-results-list tests (album hit rates directly, band hit triggers
  discovery).
- No new test file for the deleted `artistSearchView.ts`; its tests (if
  any) are removed with it.

## Open items deferred to planning

- Visual organization of merged results (two labeled sections vs.
  interleaved album/band hits) is not yet decided; leave to the
  implementation plan / UI pass.
- Search box placeholder/aria-label copy needs updating since it now
  searches bands too, not just albums; leave to the implementation plan.
- `artistBatchView.ts`'s "View all N albums" button (`onDiscover`) already
  gets the locked-browse/unlocked-persist split for free via the shared
  `discoverArtistDetailed` change above; no separate work needed there.
