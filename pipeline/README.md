# Pipeline: materializing the Album Case album universe

Four CLIs, run in order, turn the CC0 MusicBrainz + ListenBrainz bulk
dumps into `data/tastetest.db`'s `entities` table: `ingest_musicbrainz.py`
and `ingest_listenbrainz.py` stream the dumps into staging tables,
`materialize.py` joins staging into the notability-floored album
universe, and `covers.py` fills in the Cover Art Archive pointer column.
`build.py` wraps those steps into one end-to-end command. All are
stdlib-only Python 3 (no pip install needed) and stream line-by-line, so
memory stays bounded regardless of dump size.

Every command below is something an **operator** runs locally — nothing
here calls out to a paid API, and no credentials are required. The
dumps are large (the MusicBrainz core dump alone is ~7 GB compressed);
budget disk space and time accordingly (see "Disk and time budget"
below).

## 1. Download the dumps

### MusicBrainz (identity spine: release-groups, artists, years)

```bash
# Find the current export directory.
curl -s https://data.metabrainz.org/pub/musicbrainz/data/fullexport/LATEST
# -> e.g. 20260701-002146

MB_DUMP_DIR="20260701-002146"   # substitute the value LATEST printed
curl -O "https://data.metabrainz.org/pub/musicbrainz/data/fullexport/${MB_DUMP_DIR}/mbdump.tar.bz2"

# Extract ONLY the four release-group-scoped tables this pipeline reads
# (never `release`, edit history, or cover-art tables -- see
# ingest_musicbrainz.py's module docstring). tar -x with explicit member
# names extracts just those files, not the whole multi-GB archive.
tar -xjf mbdump.tar.bz2 \
    mbdump/release_group \
    mbdump/release_group_meta \
    mbdump/artist_credit_name \
    mbdump/artist
```

This produces an `mbdump/` directory containing the four extension-less
table files `ingest_musicbrainz.py --mbdump-dir` expects.

### ListenBrainz (popularity floor)

```bash
# Human-browsable index + JSON download link:
#   https://datasets.listenbrainz.org/popular-releases-by-listeners
curl -o popularity.json \
    "https://datasets.listenbrainz.org/popular-releases-by-listeners/json"
```

`ingest_listenbrainz.py` is JSONL-only by design (keeps the ingest path
stdlib-only, no pandas/pyarrow dependency). If the dataset hoster instead
serves a single JSON array or parquet, convert it first:

```bash
# If it's a JSON array, not one-object-per-line:
python3 -c "
import json
with open('popularity.json') as f:
    records = json.load(f)
with open('popularity.jsonl', 'w') as out:
    for r in records:
        out.write(json.dumps(r) + '\n')
"
```

Verify the record shape matches the pinned keys in
`ingest_listenbrainz.py` (`release_group_mbid`/`release_group_gid`,
`total_listen_count`/`listen_count`, `total_listener_count`/
`listener_count`) before running the loader -- a key-name mismatch will
silently skip every record (counted, not silent-failed, but worth a
spot check with `head -1 popularity.jsonl`).

## 2. Run the pipeline, in order

```bash
python3 pipeline/build.py \
    --mbdump-dir mbdump/ \
    --popularity popularity.jsonl \
    --db data/tastetest.db
```

Each lower-level CLI still exists if you want to run the steps manually:

```bash
python3 pipeline/ingest_musicbrainz.py --mbdump-dir mbdump/ --db data/tastetest.db
python3 pipeline/ingest_listenbrainz.py --popularity popularity.jsonl --db data/tastetest.db
python3 pipeline/materialize.py --db data/tastetest.db
python3 pipeline/covers.py --db data/tastetest.db
```

`build.py` reports per-step counts as JSON. `materialize.py` still
reports inserted/updated counts for this run and the total album count
in `entities`.

## 3. Confirm the universe shape

```bash
python3 pipeline/build.py --verify --mbdump-dir mbdump/ --popularity popularity.jsonl --db data/tastetest.db
```

Prints a JSON report:

```json
{
  "total_albums": 47213,
  "all_required_columns_populated": 47213,
  "release_year_min": 1900,
  "release_year_max": 2026,
  "listener_bound": 50,
  "below_listener_bound": 0,
  "above_listener_bound": 47213
}
```

`total_albums` should land in the **~20,000-100,000** range (Phase 1
success criterion 1: tens of thousands, not millions).
`all_required_columns_populated` should equal `total_albums` -- every
materialized row must carry a non-null MBID, title, primary artist name,
and primary artist MBID (DATA-02). `below_listener_bound` should be 0
against the same `--min-listeners` value used at materialize time (the
floor is applied at insert, so nothing below it should already be in the
table); it exists as a sanity check.

## Re-tuning `NOTABILITY_MIN_LISTENERS`

`pipeline/config.py` ships `NOTABILITY_MIN_LISTENERS = 50` as a concrete
starting default, not a guess left blank -- but it MUST be re-tuned
against the real dump, because the actual surviving count depends on the
real ListenBrainz listener distribution, which fixtures can't predict.
Loop:

1. Run `python3 pipeline/materialize.py --db data/tastetest.db` (or
   `--min-listeners N` to try a value without touching `config.py` yet).
2. Read the printed total album count (or run `--verify` for the full
   report).
3. If the count is too high (approaching or past ~100,000) or too low
   (well under ~20,000), adjust `NOTABILITY_MIN_LISTENERS` in
   `pipeline/config.py` and re-run. Raising the floor shrinks the
   universe; lowering it grows it.
4. Once the count lands in the target band, re-run
   `python3 pipeline/materialize.py --db data/tastetest.db` one more time
   with the final constant so `entities` reflects it (an earlier
   `--min-listeners` trial run may have inserted rows at a looser floor;
   re-running with the final, stricter value does not retroactively
   delete those -- see "Known limitation" below).

## Bi-weekly refresh cadence

MusicBrainz publishes full dumps twice weekly; ListenBrainz publishes
full dumps twice monthly (1st and 15th) with daily incrementals. This
pipeline is built around **full dumps only** (see `DATA-SOURCES.md`);
the practical refresh cadence is bi-weekly, driven by the slower
ListenBrainz cycle. On each refresh:

```bash
# Re-download both dumps (steps 1 above), then:
python3 pipeline/build.py --mbdump-dir mbdump/ --popularity popularity.jsonl --db data/tastetest.db
```

Staging tables truncate-and-reload on every ingest run (DATA-05 at the
staging layer, see `pipeline/staging.sql`), and `materialize.py` upserts
on `(entity_type, mbid)` with `created_at` excluded from the update path
(DATA-05 at the `entities` layer) -- so re-running the exact three
commands above against a refreshed dump is always safe: existing albums
update in place, newly-notable albums insert, nothing duplicates.

**Known limitation:** `materialize.py` only ever inserts/updates; it
never deletes a row that no longer clears the floor in a newer dump (an
album that drops below the notability floor on refresh stays in
`entities` from its prior run). This is an accepted staleness for a
single-operator pipeline (see `<threat_model>` T-01-09 in
`01-03-PLAN.md`); revisit only if stale below-floor rows prove to matter
in practice.

## Disk and time budget

- `mbdump.tar.bz2`: ~7 GB compressed (full export, 20260701 snapshot).
  Only 4 of its member tables are extracted; the extracted
  `release_group`/`release_group_meta`/`artist_credit_name`/`artist`
  files are far smaller than the full 7 GB but still substantial
  (release_group alone spans MusicBrainz's ~4M release-groups).
- ListenBrainz popularity dataset: size varies by snapshot; the popular
  releases dataset covers ListenBrainz's own listener base, not all
  MusicBrainz release-groups.
- Both ingest loaders stream line-by-line and batch-insert at 10k rows,
  so peak memory stays low regardless of file size; wall-clock time is
  dominated by download + disk I/O, not memory pressure.

## Real-data completion status

This pipeline's join/floor/upsert logic is proven against the small
deterministic fixtures in `pipeline/fixtures/` (`pipeline/test_materialize.py`,
7 passing tests). The **real multi-GB dump download and full
materialize + `--verify` run has not been executed in this build
environment** -- the MusicBrainz core dump alone is ~7 GB, well past
what this session's environment can reasonably download. Run the exact
commands in this README on a machine with normal internet + disk access
to produce the real `data/tastetest.db` and confirm the tens-of-thousands
album count. See `01-03-SUMMARY.md` for the recorded status.
