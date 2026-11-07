# Browse-by-category views and gap-aware discovery

Date: 2026-11-07
Status: draft, pending Keith's approval

## Intent

Make Album Case feel like one combined discovery-and-ranking engine
instead of two separate tabs, and make the ranked list browsable by
artist, year/decade, and genre. The unifying move: category views of the
ranked list double as discovery surfaces. A slice page ("1994",
"Radiohead", "shoegaze") shows the owner's ranked albums in that slice
plus unranked candidates for the same slice, so browsing your own
rankings is what surfaces what's missing, and rating a candidate drops it
into the slice you are looking at.

## Why now

- The pieces already exist separately: a deterministic suggestion engine
  (`web/src/suggestions.ts`), a rating-first ranked list, per-artist and
  per-year sub-ranks (`web/src/ranking/subRank.ts`), and genre capture on
  discovery (`web/api/_lp.ts` -> `discovered_albums.genres_json`) that no
  UI ever reads.
- The ranked list has one global view only. At hundreds of albums it is
  hard to answer "what's my best of 1994" or "how do I rank this artist"
  without searching.

## Goals

1. Group the ranked list by Artist, Year, Decade, and Genre, with a
   per-slice filtered view.
2. Backfill genres for albums ranked before genre capture existed.
3. Make suggestions gap-aware: boost candidates that fill thin slices,
   and let each slice page request "more like this slice".

## Non-goals

- No LLM or ML model at runtime. Discovery stays deterministic scoring
  over MusicBrainz/ListenBrainz data. (Decided with Keith 2026-11-07.)
- No new ranking mechanism. Rating stays the source of truth; views are
  derived, read-mostly projections of the same ranked array.
- No crowd charts, no cross-user aggregation (Taste Test is dead).
- No schema redesign. `genres_json` on `discovered_albums` is already the
  storage; no new tables.

## Anti-goals

- Anything that deepens the single-owner assumption. All grouping,
  slicing, and gap logic must operate on one list passed in, never on
  the fixed owner id directly, so it survives the per-user move.
- A genre taxonomy project. MusicBrainz top genres as captured by
  `topGenres()` in `web/api/_lp.ts` are the vocabulary; do not hand-curate
  or remap genres.
- Blocking the ranked view on genre coverage. Artist and year views ship
  first and work with data already present.

## Constraints

- MusicBrainz is ~1 request/second shared; the backfill script must
  throttle and be resumable. It runs offline (laptop), never at request
  time.
- Mobile first: 360 px wide, tap targets >= 44 px, no horizontal scroll.
- Safe DOM construction, no innerHTML.
- Ranked-list mutations from a filtered view must map back to global
  indices; `web/src/ui/rankList.ts` already does this for search and
  `artistBatchView.ts` for one artist. Reuse that machinery, do not fork
  a second index-mapping scheme.
- Ratings are the single source of truth for position (`rating.ts`,
  `insertAtRating`). Slice ordering is always global rating order
  restricted to the slice; never a separately sortable order.
- No Elo, no self-contradicting picks; nothing here touches placement
  mechanics.

## Design

### Phase 1: browse-by views (artist, year, decade)

- New pure module `web/src/ranking/groups.ts` (no DOM, tested like
  `subRank.ts`): given `RankedAlbum[]` and a dimension
  (`artist | year | decade | genre`), return ordered sections
  `{ key, label, albums, count, meanRating }`.
  - Artist sections keyed by `primary_artist_mbid` falling back to name
    (same rule as `subRank.ts`'s `artistGroupKey`).
  - Section order: by best (highest-ranked) album in the section, so the
    top of each view mirrors the global top. Albums inside a section keep
    global rating order.
  - Decade derives from `release_year`; albums with null year collect in
    a trailing "Year unknown" section.
  - Genre sections: an album with N genres appears in N sections. This is
    intended browsing behavior, not a bug. Albums with no genres collect
    in a trailing "No genre yet" section (which also shows backfill
    coverage honestly).
  - Genre view only, to keep phone-length header lists sane (author's
    call): sections sort by album count descending (not by best album),
    and genres with a single album collapse into one trailing "More
    genres" section listing them. Artist/year/decade views keep the
    by-best-album order and no collapsing.
- UI: a "Browse" control on the ranked view (`My list`), alongside the
  existing search: List (today's flat view, default) / Artist / Year /
  Decade / Genre. Collapsed section headers show label, count, and mean
  rating; expanding shows the slice's rows.
- Tapping "open" on a section renders the existing filtered `rankList`
  instance for that slice (the `artistBatchView.ts` pattern generalized),
  so inline rating edits, drag, and remove all keep working against
  global indices.
- Genre option appears in the control from phase 1 but is expected to be
  sparse until phase 2 runs; the "No genre yet" section makes that state
  legible rather than broken.

### Phase 2: genre backfill

- One-time, resumable script `web/scripts/backfill-genres.mjs` (same
  operational style as `import-spotify-albums.mjs`):
  1. Read the owner snapshot and `discovered_albums`; collect mbids whose
     `genres_json` is NULL. Takes `--session <id>` (defaulting to the id
     in `web/src/owner.ts`) rather than hard-coding the owner, and uses
     the same Turso env credentials as the existing import script.
     (Author's call.)
  2. Fetch each release-group from MusicBrainz with `inc=genres`,
     throttled to 1 req/s, reusing the `topGenres` selection rule
     (import or duplicate its threshold logic; builder's call).
  3. Write results back to `discovered_albums.genres_json`. A
     release-group MusicBrainz has no genres for is written as `[]`,
     meaning "checked, none found", so reruns never re-fetch it; the
     client already drops empty genre arrays (`parseAlbum`), so `[]`
     renders as "No genre yet" like a missing value. (Author's call;
     same column, so still no schema change.)
  4. For ranked albums with no `discovered_albums` row, insert one (the
     Spotify import script already writes such rows; follow its shape).
  5. Log progress to stdout; resumable because only NULL rows are
     fetched.
- Candidate coverage (author's call): seed-pool albums
  (`web/public/seed/albums.json`) carry no genres, and the bootstrap
  merge (`web/src/bootstrap.ts`) skips discovered rows whose mbid is
  already in the pool. Two consequences and their resolutions:
  1. The bootstrap merge gains a genre overlay: when a discovered row
     matches a pool mbid, copy its `genres` onto the pool record instead
     of discarding the row.
  2. The script's default run targets ranked + discovered rows, which
     makes the ranked list's genre view complete. An optional `--pool`
     flag extends the run to seed-pool mbids (writing `discovered_albums`
     rows for them) so genre-sliced *candidates* get coverage too; at
     1 req/s this is an overnight run and can happen any time after
     phase 2 ships. Until it runs, genre-sliced suggestions draw only
     from genre-tagged candidates and fall back to the existing no-match
     messaging.
- Client-side, ranked albums get genres automatically: bootstrap merges
  pool records into ranked albums by mbid via `hydrateAlbums`
  (`web/src/syncEngine.ts:75`), which backfills optional fields
  including `genres`.
- The snapshot self-heals: the next ordinary ranking save persists the
  hydrated (genre-carrying) records into `ranking_snapshots`.

### Phase 3: gap-aware discovery

- Slice pages show candidates inline. Below a slice's ranked rows, the
  page renders a short strip (up to 3) of unranked candidates for that
  slice, each as the existing suggestion card (`backlogView.ts`'s
  `albumCard`: cover, reason, Rate now, Want to listen, Skip), so rating
  a candidate drops it into the slice being viewed via the normal
  `insertAtRating` flow. This is the "combination engine" moment and is
  in scope, not just a link out. A "Find more from <slice>" action under
  the strip opens the Find albums "Suggest one" shelf pre-constrained to
  the slice for a longer run of picks.
- Candidate selection reuses `suggestAlbum` with a new optional
  `sliceFilter` on `SuggestionOptions` restricting candidates to the
  slice (artist slices reuse the existing artist-gaps data instead; see
  below). Existing no-match fallback messaging applies when the pool has
  nothing for the slice.
- Extend `suggestAlbum` (`web/src/suggestions.ts`) with a gap bonus:
  compute slice occupancy (by decade and by genre) from the ranked list,
  and add a bounded score bonus for candidates that land in a slice that
  is thin relative to the owner's engagement with it. "Thin" is relative
  to list size, not an absolute count (author's call: friends' lists
  will be small, and a fixed "fewer than 5" either always or never fires;
  the shape is "slice share of the ranked list well below the slice's
  mean rating percentile", exact weights the builder's call). It must
  stay a bonus (ties broken toward gaps), never a filter that starves
  the familiar/discovery scheduling already in place.
- Artist is deliberately excluded from the gap bonus: the Artist gaps
  shelf in Find albums already covers per-artist gaps, and artist slice
  pages draw their candidates from that same data.
- Reasons shown on the card should name the gap ("You rate shoegaze 8.1
  on average but have only ranked 3 shoegaze albums.") in the same plain
  style as existing reasons.

## Build order

1. Phase 1 (artist/year/decade views + groups module). Pure UI + pure
   module; data already present.
2. Phase 2 (genre backfill script), can run while phase 1 is in review;
   genre view lights up when it lands.
3. Phase 3 (gap bonus + slice-constrained suggestions).

Each phase is independently shippable; stop after any of them and the app
is better than before.

## Left to the builder

- Exact visual treatment of section headers and the Browse control
  (within the te-tokens/te-bridge system; edit `te-bridge.css` only).
- Whether `groups.ts` reuses `topGenres` by import or by copied constant.
- Gap-bonus weights and thresholds, kept bounded as specified.
- Whether decade view needs its own sub-rank line in row metadata or
  reuses the existing year line.
- Test placement following existing colocated `*.test.ts` conventions.

## Acceptance (per SHIP-STANDARD lens)

- Browse views render at 360 px with no horizontal scroll; headers and
  controls are >= 44 px tap targets.
- Rating/removing an album from a slice view lands identically to doing
  it from the flat list (same global index semantics, verified by test).
- Backfill script is rerunnable without duplicating rows or re-fetching
  completed mbids, and respects the 1 req/s throttle.
- With genres absent, the genre view degrades to a labeled "No genre yet"
  section, never a blank or broken screen.
