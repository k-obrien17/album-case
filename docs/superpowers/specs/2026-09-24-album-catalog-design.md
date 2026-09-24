# Self-hosted album catalog

## Why

Album search feels laggy because every search goes to MusicBrainz live.
Measured 2026-09-24: MusicBrainz direct takes 0.7-0.9s per search, and
`/api/search-album` (MusicBrainz through Vercel) takes 0.4-0.8s uncached.
MusicBrainz also rate-limits to about 1 request per second, and nobody
sells faster access to it.

Goal: any album is one search away and results come back fast enough to
feel instant, so the app feels like every album is already in it. This is
step one of a larger streamlining effort. Button and view cleanup is a
separate, later spec.

This was the original Phase 1 plan (`.planning/ROADMAP.md`). The pipeline
was built and tested on sample data, but the real ~7GB MusicBrainz dump
was never downloaded, and a temporary 250-album seed became permanent.
This spec finishes that work and connects it to search.

## Decisions already made

- **Self-host the catalog** rather than switching search to Deezer or
  iTunes (faster, but no MusicBrainz IDs and commercial-use limits in
  their terms) or relying on caching (only helps repeat queries).
- **Keep MusicBrainz IDs** as the album identity. Nothing about how albums
  are keyed changes.
- **Live MusicBrainz stays as the fallback** for anything the catalog
  misses (new releases, obscure albums below the popularity floor).

## Scope

In:
1. Extend `pipeline/` so its output matches the app's album rule: primary
   type Album or EP, no secondary types (excludes live, compilation,
   soundtrack, remix, and so on). Today it keeps Albums only and never
   checks secondary types.
2. A new Turso table `catalog_albums` with a full-text index.
3. A load script that copies the pipeline's output into Turso.
4. `/api/search-album` searches the catalog first and falls back to live
   MusicBrainz, with the same response shape.
5. A weekly refresh job that adds newly released albums, so the catalog
   stays at most about a week behind without re-downloading the dump.
6. A "Search everywhere" link under search results that forces a live
   MusicBrainz search. This is the one client change.

Out (explicitly):
- UI and button streamlining (separate spec).
- Feeding the "next album" candidate queue from the catalog. The static
  seed and artist-gap logic stay as they are for now.
- Accounts, multi-user, or selling the app.
- Cover art rights. Covers stay as Cover Art Archive URLs built from the
  album ID, exactly as today.

## Data

### Source

MusicBrainz full export (public domain, CC0), streamed so the ~7GB
archive never lands on disk:

```
curl -s ".../fullexport/<LATEST>/mbdump.tar.bz2" \
  | tar -xjf - mbdump/release_group mbdump/release_group_meta \
      mbdump/artist_credit_name mbdump/artist \
      mbdump/release_group_secondary_type_join
```

`release_group_secondary_type_join` is new. The other four are what the
pipeline already reads. Popularity comes from the ListenBrainz
popular-releases dataset, as the pipeline already does.

The local machine has about 11GB free, so streaming is required, not
optional. Extracted tables plus the local SQLite build should fit in
about 2GB (to be confirmed at extraction).

### Filters (pipeline)

- Primary type is Album or EP. Look up the MusicBrainz primary-type IDs
  at implementation time from `InsertDefaultRows.sql` rather than
  hardcoding from memory. The pipeline already pins Album = 1 this way.
- No row in `release_group_secondary_type_join` for that release group.
- Listener count at or above `NOTABILITY_MIN_LISTENERS` (currently 50,
  in `pipeline/config.py`).

The resulting row count is unknown until the real run. It gets reported
before anything is loaded into Turso, and the floor can be tuned then.

### Turso table

```sql
CREATE TABLE IF NOT EXISTS catalog_albums (
  mbid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  primary_artist_name TEXT NOT NULL,
  primary_artist_mbid TEXT,
  release_year INTEGER,
  primary_type TEXT NOT NULL,        -- 'Album' | 'EP'
  listener_count INTEGER NOT NULL,
  loaded_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS catalog_albums_fts USING fts5(
  title, primary_artist_name,
  content='catalog_albums', content_rowid='rowid'
);
```

`cover_url` is not stored. It's derived from `mbid` on read with the same
Cover Art Archive template the app already uses.

This table has no `session_id`. It's a shared reference catalog, not
per-owner data, so it stays correct if the app ever becomes multi-user.

## Load

A new script, `web/scripts/load-catalog.mjs`, reads the pipeline's local
SQLite output and upserts into `catalog_albums` in batches, then rebuilds
the FTS index. Properties:

- Idempotent: re-running it for a newer dump updates rows in place
  (upsert on `mbid`).
- `--dry-run` by default. It prints the row count, a sample of rows, and
  the batch plan without writing. A real write needs an explicit `--write`
  flag.
- Additive only. It never touches `ranking_snapshots`, `atoms`,
  `sessions`, or `discovered_albums`.

Needs Turso credentials locally (`vercel env pull` into a gitignored
file). The production write happens only after Keith approves it at the
time, once the dry run's numbers are in front of him.

## Search endpoint

`/api/search-album?q=` keeps its current response shape
(`{ albums: DiscoveredAlbum[] }`, max 10). A new optional `live=1`
parameter skips the catalog and goes straight to MusicBrainz; the
"Search everywhere" link uses it.

1. Query `catalog_albums_fts` with the user's text (FTS-escaped, prefix
   match on the last word so "radioh" finds Radiohead). Rank by FTS
   relevance, then by `listener_count`, so the famous album wins close
   calls.
2. If the catalog returns at least 5 results, return them. No MusicBrainz
   call.
3. Otherwise, or if the catalog query fails or times out (via the
   existing `withDbTimeout`), call live MusicBrainz exactly as today,
   merge, drop duplicates by `mbid` (catalog rows win), cap at 10.

The existing edge cache header stays.

Known limit of step 2: when the catalog has 5+ matches, MusicBrainz isn't
asked, so an album released since the last refresh won't appear. The
weekly refresh keeps that window to about a week, and "Search everywhere"
covers it immediately.

## Search everywhere (client)

Under album search results, a small "Search everywhere" link re-runs the
current query with `live=1` and replaces the results. It's always shown
once results are on screen, including when there are none. No other
client change.

## Freshness: weekly refresh

A Vercel Cron job calls a new route, `/api/cron/refresh-catalog`, once a
week. The route rejects any request without Vercel's cron secret
(`Authorization: Bearer $CRON_SECRET`).

Each run:
1. Asks MusicBrainz search for release groups with a first release date
   in the last 21 days (the overlap makes a missed week harmless), primary
   type Album or EP, paged at 100 per request, no faster than 1 request
   per second.
2. Keeps only results with no secondary types whose primary artist
   already appears in `catalog_albums`. That keeps the catalog focused on
   artists with a real audience instead of every new upload.
3. Upserts them with `listener_count = 0` (no popularity data exists yet
   for a new release) and refreshes the FTS index for those rows.
4. Logs how many it added. It never deletes or edits existing rows'
   popularity.

To verify at implementation: that a run's page count fits inside the
Vercel function time limit. If it doesn't, the same script runs weekly
from the Mac instead, set up with `cron-hardened`.

Optional, not scheduled: re-run the full dump pipeline once or twice a
year to pick up corrections to old data (fixed titles, merged duplicates)
and real popularity numbers for albums the weekly job added.

## Error handling

- Catalog query error or timeout: fall through to live MusicBrainz. Search
  never gets worse than today.
- Empty catalog (not loaded yet): same fall-through, so this can ship
  before the load happens.
- MusicBrainz failure after a catalog miss: return whatever the catalog
  found (possibly empty), same as today's failure behavior.

## Verification before building

Two unknowns get checked first, before any other work:

1. **FTS5 on Turso.** Create and query a throwaway FTS5 table on the
   production database (create, insert 3 rows, query, drop). If FTS5 isn't
   available, the fallback is a normalized `search_key` column with a
   b-tree index and prefix `LIKE`. That's less forgiving with word order,
   but still fast.
2. **Row count and size.** The real pipeline run reports how many albums
   survive the filters before anything is loaded.

## Testing

- Pipeline (pytest): an EP with no secondary types is kept; an Album with
  a `Live` secondary type is dropped; a Single is dropped; the
  listener-floor boundary behaves as before.
- Endpoint (vitest, mocked DB and fetch): 5+ catalog hits returns without
  calling MusicBrainz; fewer than 5 merges and dedupes with catalog rows
  winning; a catalog error falls back to MusicBrainz; the response shape
  is unchanged.
- Endpoint: `live=1` skips the catalog and calls MusicBrainz even when
  the catalog would have matched.
- Refresh route (vitest, mocked DB and fetch): rejects a request without
  the cron secret; adds a new album by an artist already in the catalog;
  skips one by an unknown artist; skips a Live-tagged release; re-running
  the same window adds nothing new.
- Load script: a dry run against a small fixture DB reports the correct
  counts and writes nothing.
- Live check after load: uncached search latency on production, with a
  target median under 300ms (today it's 400-800ms).

## Keith's steps

1. OK to pull Turso credentials locally (`vercel env pull`).
2. Confirm the Turso plan has room for a few hundred thousand small rows.
3. Approve the production load after seeing the dry-run numbers.
4. Approve adding `CRON_SECRET` to the Vercel project's environment.
5. Approve the deploy (`vercel deploy --prod --yes`), which also turns on
   the weekly cron.

## Follow-ups (not this spec)

- UI streamlining: fewer buttons, fewer views.
- Candidate queue drawing from the catalog for artists you play, which
  would retire the per-artist "Fill in more albums" discovery step.
