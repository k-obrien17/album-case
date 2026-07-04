---
phase: 01-album-data-foundation
plan: 02
subsystem: pipeline
tags: [musicbrainz, listenbrainz, sqlite, ingest, python, stdlib]

# Dependency graph
requires: [01-01]
provides:
  - pipeline/staging.sql staging DDL (stg_release_group, stg_release_group_meta, stg_artist_credit_name, stg_artist, stg_popularity)
  - pipeline/ingest_musicbrainz.py load_musicbrainz_staging()
  - pipeline/ingest_listenbrainz.py load_listenbrainz_staging()
  - Deterministic mb_*/lb_* fixtures joined on shared release-group MBIDs
affects: [01-03, 01-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Truncate-and-reload staging: DELETE + reinsert share one transaction per table, so a refreshed dump reloads without accumulating stale/duplicate rows"
    - "Streaming line-by-line file parsing, never a whole-file .read(), batched executemany at 10k rows"
    - "Skip-and-count malformed input lines rather than aborting the whole load"
    - "Pinned column-index / key-name constants at module top, verified by a fixture-backed test so schema drift fails loudly"
    - "sys.path bootstrap at top of CLI scripts so `python3 pipeline/foo.py` and `python3 -m pipeline.foo` both resolve `pipeline.db`"

key-files:
  created:
    - pipeline/staging.sql
    - pipeline/ingest_musicbrainz.py
    - pipeline/ingest_listenbrainz.py
    - pipeline/fixtures/mb_release_group.sample.tsv
    - pipeline/fixtures/mb_release_group_meta.sample.tsv
    - pipeline/fixtures/mb_artist_credit_name.sample.tsv
    - pipeline/fixtures/mb_artist.sample.tsv
    - pipeline/fixtures/lb_popularity.sample.jsonl
    - pipeline/test_ingest.py
  modified: []

key-decisions:
  - "MB column-order constants verified live against musicbrainz-server's current admin/sql/CreateTables.sql and admin/sql/InsertDefaultRows.sql (fetched 2026-07-04), not recalled from memory, per the plan's column-order warning; release_group_primary_type id=1 confirmed as 'Album'"
  - "load_musicbrainz_staging(conn, mbdump_dir, table_filenames=None) takes an optional filename-override dict so the test suite points at mb_*.sample.tsv fixtures while the CLI/operator path uses real unbaffixed mbdump filenames by default"
  - "stg_popularity has release_group_mbid as PRIMARY KEY; the LB loader uses INSERT OR REPLACE so a duplicate mbid within one load still yields one row per unique mbid"
  - "Missing listener_count in a popularity record defaults to 0 rather than NULL, keeping the column numeric for downstream notability-floor comparisons in Plan 03"

patterns-established:
  - "Every ingest CLI module inserts the project root onto sys.path at import time, so both direct script invocation (`python3 pipeline/x.py`) and package import (`python3 -m pipeline.x` / `from pipeline.x import ...`) resolve `pipeline.db` correctly"

requirements-completed: [DATA-01]

# Metrics
duration: 25min
completed: 2026-07-04
---

# Phase 1 Plan 2: CC0 Dump Ingestion to Staging Summary

**MusicBrainz release-group tables (release_group, release_group_meta, artist_credit_name, artist) and the ListenBrainz popularity dump both stream line-by-line into SQLite staging tables, truncate-and-reload on every run, tolerate malformed input, and join cleanly on shared release-group MBIDs — proven by 15 passing pytest tests.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-04T01:56:00Z (approx.)
- **Completed:** 2026-07-04T02:06:26Z
- **Tasks:** 2 completed
- **Files modified:** 9 created

## Accomplishments

- `load_musicbrainz_staging()` streams the four release-group-scoped mbdump table files (never `release`, edits, or cover-art tables) line-by-line into `stg_release_group`, `stg_release_group_meta`, `stg_artist_credit_name`, `stg_artist`, batching inserts at 10k rows, with the truncate and reinsert for each table sharing one transaction.
- Column-index constants (`RG_COL_*`, `RGM_COL_*`, `ACN_COL_*`, `ARTIST_COL_*`) were pinned by fetching the current `musicbrainz-server` schema live (`admin/sql/CreateTables.sql`, `admin/sql/InsertDefaultRows.sql`) rather than from memory, per the plan's column-order warning. `release_group_primary_type` id 1 = 'Album' was confirmed from `InsertDefaultRows.sql`, not assumed.
- A malformed `release_group` line (wrong field count) is skipped and counted; the load completes without raising.
- Various Artists (gid `89ad4ac3-39f7-470e-963a-56509c546377`) loads as a normal artist row and its compilation release-group is not dropped, proven by a dedicated test.
- Re-running `load_musicbrainz_staging` over the same fixtures leaves row counts unchanged (3 release groups each run) — truncate-before-reload proven by a re-run test.
- `load_listenbrainz_staging()` streams the JSONL popularity dump into `stg_popularity`, tolerating a malformed JSON line and a record missing `listener_count` (defaults to 0), deduping on `release_group_mbid` via `INSERT OR REPLACE` against the table's primary key.
- The LB fixture MBIDs (`6ccb60c2-...` OK Computer, `f4a5da2f-...` VA compilation, `6c771d78-...` Abbey Road) match the MB fixture albums exactly, proven by a join test that reads back all three titles through `stg_release_group JOIN stg_popularity`.
- Both loaders expose a CLI (`--mbdump-dir`/`--db` and `--popularity`/`--db`) that works both as `python3 pipeline/x.py` and `python3 -m pipeline.x`, via a `sys.path` bootstrap at the top of each module.

## Task Commits

Each task was TDD (RED then GREEN), committed atomically:

1. **Task 1: Stream MusicBrainz release-group tables into SQLite staging**
   - `f5400e8` (test, RED) — failing tests + `mb_*.sample.tsv` fixtures, `pipeline.ingest_musicbrainz` did not exist yet
   - `cbf9407` (feat, GREEN) — `pipeline/staging.sql` + `pipeline/ingest_musicbrainz.py`, all 9 musicbrainz-scoped tests pass
2. **Task 2: Stream ListenBrainz popularity into SQLite staging**
   - `e88e9bd` (test, RED) — failing tests + `lb_popularity.sample.jsonl` fixture, `pipeline.ingest_listenbrainz` did not exist yet
   - `9495a46` (feat, GREEN) — `pipeline/ingest_listenbrainz.py`, all 15 tests (MB + LB) pass

**Plan metadata:** (this commit, docs: complete plan)

RED was verified honestly: for each task, the implementation module was temporarily moved out of the working tree, `pytest` was run to confirm collection failure (`ModuleNotFoundError`), then the module was restored and `pytest` re-run to confirm GREEN before either commit was made.

## Files Created/Modified

- `pipeline/staging.sql` — DDL for `stg_release_group`, `stg_release_group_meta`, `stg_artist_credit_name`, `stg_artist`, `stg_popularity`, plus join-key indexes
- `pipeline/ingest_musicbrainz.py` — `load_musicbrainz_staging(conn, mbdump_dir, table_filenames=None)`, pinned column-index constants, CLI with `--mbdump-dir`/`--db`
- `pipeline/ingest_listenbrainz.py` — `load_listenbrainz_staging(conn, popularity_path)`, pinned key-name constants with tolerated alternates, CLI with `--popularity`/`--db`
- `pipeline/fixtures/mb_release_group.sample.tsv` — 3 valid release-group rows (OK Computer, VA compilation, Abbey Road) + 1 malformed line
- `pipeline/fixtures/mb_release_group_meta.sample.tsv` — first-release-year rows for the 3 release groups
- `pipeline/fixtures/mb_artist_credit_name.sample.tsv` — primary-artist-credit rows (position 0) for the 3 release groups
- `pipeline/fixtures/mb_artist.sample.tsv` — Radiohead, Various Artists, The Beatles artist rows
- `pipeline/fixtures/lb_popularity.sample.jsonl` — popularity rows for the 3 MB fixture MBIDs (one missing `listener_count`) + 1 malformed JSON line
- `pipeline/test_ingest.py` — 15 tests covering both loaders

## Decisions Made

- Verified MusicBrainz column order live against the current `musicbrainz-server` GitHub source rather than relying on training-data recall, per the plan's explicit column-order warning — schema drift risk is real (MB has reordered columns across versions before).
- Added an optional `table_filenames` override parameter to `load_musicbrainz_staging()` so the fixture files can keep the plan-specified `mb_*.sample.tsv` naming (for readability/discoverability in `pipeline/fixtures/`) while the real operator path defaults to the exact unprefixed mbdump filenames (`release_group`, `artist`, etc.).
- `stg_popularity.release_group_mbid` is a `PRIMARY KEY` (the only staging table with one), enabling `INSERT OR REPLACE` for LB's dedup requirement, versus the other four staging tables which stay unconstrained per the plan's literal column list.
- Missing `listener_count` defaults to `0` (not `NULL`) so downstream notability-floor math in Plan 03 never has to null-check it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `python3 pipeline/ingest_musicbrainz.py --help` failed with `ModuleNotFoundError: No module named 'pipeline'`**
- **Found during:** Task 1, verifying the CLI acceptance criterion
- **Issue:** Running a script directly (`python3 pipeline/x.py`) puts the script's own directory on `sys.path[0]`, not the project root, so `from pipeline.db import ...` failed.
- **Fix:** Added a `sys.path.insert(0, str(Path(__file__).resolve().parent.parent))` bootstrap at the top of both `ingest_musicbrainz.py` and `ingest_listenbrainz.py`, before the `pipeline.db` import.
- **Files modified:** `pipeline/ingest_musicbrainz.py`, `pipeline/ingest_listenbrainz.py`
- **Commit:** `cbf9407`, `9495a46`

No other deviations — plan executed as written, including the exact staging table shape, truncate-before-reload symmetry, and pinned-index requirement.

## Issues Encountered

None blocking. One live network check was made (fetching `musicbrainz-server`'s public `CreateTables.sql`/`InsertDefaultRows.sql` from GitHub raw, and a `HEAD`-only probe of `datasets.listenbrainz.org`'s popularity dataset page) to verify schema facts — no bulk dump was downloaded, per the plan's explicit instruction to build against fixtures only in this run.

## Next Phase Readiness

- Staging holds everything Plan 03 needs for a set-based join: release-group MBID/title/primary-type/artist-credit in `stg_release_group`, first-release year in `stg_release_group_meta`, primary-artist name/MBID reachable via `stg_artist_credit_name` (position 0) joined to `stg_artist`, and popularity counts in `stg_popularity` keyed by the same release-group MBID.
- The join test (`test_listenbrainz_fixture_mbids_match_musicbrainz_fixture_mbids`) already proves the fixture data joins end-to-end, giving Plan 03 a working small dataset to build its notability-floor query against before running on the real dumps.
- The real multi-GB dump download and full load is deferred to Plan 03's operator step, as instructed.

---
*Phase: 01-album-data-foundation*
*Completed: 2026-07-04*

## Self-Check: PASSED
