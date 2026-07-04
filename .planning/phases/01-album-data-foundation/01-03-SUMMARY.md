---
phase: 01-album-data-foundation
plan: 03
subsystem: database
tags: [sqlite, sql-join, upsert, musicbrainz, listenbrainz, python, stdlib]

# Dependency graph
requires:
  - phase: 01-album-data-foundation
    provides: pipeline/db.py (connect, init_db, now_ms), pipeline/schema.sql (entities), pipeline/staging.sql + ingest_musicbrainz.py + ingest_listenbrainz.py (staging loaders + fixtures)
provides:
  - pipeline/materialize.py materialize_albums() -- set-based join of staging -> entities with notability floor + idempotent upsert on (entity_type, mbid)
  - pipeline/materialize.py verify_universe() + --verify CLI flag -- reports universe shape (total, required-column coverage, year range, floor bounds)
  - pipeline/config.py NOTABILITY_MIN_LISTENERS = 50 tunable constant
  - pipeline/README.md -- documented end-to-end download + three-command run, re-tune loop, bi-weekly refresh cadence
affects: [02-pick-loop, any-phase-querying-entities]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single parameterized INSERT...SELECT...ON CONFLICT(pk) DO UPDATE statement for the whole join+floor+upsert, rather than a row-by-row Python loop -- keeps the operation set-based in SQLite and the floor bound a parameter, never interpolated (T-01-07)"
    - "created_at deliberately excluded from the ON CONFLICT DO UPDATE SET list so it is set once on insert and preserved forever after -- the mechanism that makes refreshed-dump re-runs idempotent (DATA-05) without extra bookkeeping"
    - "verify_universe() as a small dict-returning helper, exposed via a --verify CLI flag, so an operator can confirm a phase success criterion (tens-of-thousands universe, required columns populated) with one command instead of hand-written SQL"

key-files:
  created:
    - pipeline/config.py
    - pipeline/materialize.py
    - pipeline/test_materialize.py
    - pipeline/README.md
  modified: []

key-decisions:
  - "NOTABILITY_MIN_LISTENERS ships as a concrete default of 50 (not blank/TBD) per the plan's explicit instruction, filtering on stg_popularity.listener_count (steadier than raw listen_count) -- re-tuning against the real dump is documented as an operator loop in pipeline/README.md, not resolved in this plan"
  - "ALBUM_PRIMARY_TYPE_ID = 1 pinned as a named constant in materialize.py, citing the same live musicbrainz-server InsertDefaultRows.sql confirmation Plan 02 already made, rather than a bare literal in the join"
  - "Insert/update counts computed via before/after COUNT(*) plus a separate candidate-count SELECT using the same WHERE clause, since sqlite3's cursor.rowcount is unreliable for INSERT...ON CONFLICT DO UPDATE statements"
  - "The real multi-GB dump download was not attempted after confirming live that mbdump.tar.bz2 is ~7G compressed (fullexport/LATEST -> 20260701-002146) -- per the plan's real-data gate, this is documented as Executed (data-pending), not silently skipped or falsely marked Complete"

patterns-established:
  - "verify_universe()-style helper + --verify CLI flag as the standard way to let an operator confirm a roadmap success criterion against the real store with one command"

requirements-completed: [DATA-01, DATA-02, DATA-04, DATA-05]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 1 Plan 3: Materialize the Notability-Floored Album Universe Summary

**A single parameterized `INSERT...SELECT...ON CONFLICT(entity_type, mbid) DO UPDATE` statement joins the five staging tables into `entities`, gates on `stg_popularity.listener_count >= NOTABILITY_MIN_LISTENERS` (default 50) and `primary_type = Album`, and preserves `created_at` across refreshes -- proven by 7 passing fixture tests; the real 7 GB MusicBrainz dump was confirmed too large to download in this build environment, so Phase 1 completion stays explicitly data-pending on an operator run.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-03T22:05:00-04:00 (approx.)
- **Completed:** 2026-07-03T22:14:43-04:00
- **Tasks:** 2 completed
- **Files modified:** 4 created

## Accomplishments

- `materialize_albums(conn, min_listeners=NOTABILITY_MIN_LISTENERS)` joins `stg_release_group` to `stg_popularity` (floor), `stg_artist_credit_name` (position 0, primary credit), `stg_artist` (primary artist identity), and `stg_release_group_meta` (first release year), filtering `primary_type = 1` (Album) AND `listener_count >= min_listeners`, and upserts into `entities` on `(entity_type, mbid)`.
- `created_at` is excluded from the `ON CONFLICT DO UPDATE SET` list, so re-running over identical staging leaves row counts unchanged, preserves each row's original `created_at`, and still advances `updated_at` -- proven directly by patching `now_ms()` across two runs and asserting both fields.
- A below-floor fixture album (Abbey Road, whose ListenBrainz fixture record omits `total_listener_count` and so defaults to `listener_count = 0` per Plan 02's loader) is excluded from `entities` without needing a synthetic fixture row.
- A non-Album primary-type release-group (inserted directly into staging for this test) with a high listener count is still excluded, proving the type gate is independent of the floor (DATA-04).
- Various Artists compilation ("Now That's What I Call Music") materializes with `primary_artist_name = 'Various Artists'` and its correct MBID -- not dropped.
- Adding one new above-floor release-group to staging and re-running inserts exactly one new row while leaving every existing row's `created_at` untouched (refresh test).
- `verify_universe(conn)` and the `materialize.py --verify` CLI flag report total album count, required-column coverage, release-year range, and floor bounds as a JSON dict, runnable against an empty/fresh DB without error.
- `pipeline/README.md` documents the exact operator commands: download `mbdump.tar.bz2` and extract only the four needed member tables, download the ListenBrainz `popular-releases-by-listeners` JSON dataset (with a JSONL-conversion snippet if it arrives as a JSON array), the three-command run order, the `NOTABILITY_MIN_LISTENERS` re-tune loop, the bi-weekly refresh cadence, and a documented known limitation (no delete-on-refresh for albums that drop below the floor).

## Task Commits

Task 1 was TDD (RED then GREEN), committed atomically; Task 2 was a single docs commit:

1. **Task 1: Materialize the notability-floored album universe with idempotent upsert**
   - `a9c6aaa` (test, RED) — `pipeline/test_materialize.py`, `pipeline.materialize` did not exist yet
   - `56d408c` (feat, GREEN) — `pipeline/config.py` + `pipeline/materialize.py`, all 7 tests pass
2. **Task 2: End-to-end run doc + full-dump ingest verification**
   - `5f0f2e4` (docs) — `pipeline/README.md`; live-confirmed `mbdump.tar.bz2` is ~7G, too large to download in this environment, so the real-dump `--verify` run is left to the operator

**Plan metadata:** (this commit, docs: complete plan)

RED was verified honestly: `pipeline/materialize.py` was temporarily moved out of the working tree, `pytest` was run to confirm collection failure (`ModuleNotFoundError: No module named 'pipeline.materialize'`), then the module was restored and `pytest` re-run to confirm GREEN (all 7 tests) before either commit was made. The full pipeline suite (29 tests across `test_ingest.py`, `test_materialize.py`, `test_schema.py`) is green.

## Files Created/Modified

- `pipeline/config.py` — `NOTABILITY_MIN_LISTENERS = 50`, concrete starting default with a re-tune-against-real-dump comment
- `pipeline/materialize.py` — `materialize_albums()`, `verify_universe()`, `ALBUM_PRIMARY_TYPE_ID = 1` constant, CLI with `--db`/`--min-listeners`/`--verify`
- `pipeline/test_materialize.py` — 7 tests: floor exclusion, required columns, Various Artists, primary-type gate, idempotent re-run, refresh-adds-one, `verify_universe` shape
- `pipeline/README.md` — full download + run + re-tune + refresh documentation (new file, no prior version)

## Decisions Made

- `NOTABILITY_MIN_LISTENERS = 50` shipped as a concrete integer default per the plan's explicit instruction, not left blank; the re-tune loop against the real dump is documented but not executed here (no real dump available in-environment).
- Insert/update counts are computed via before/after `COUNT(*)` on `entities` plus a separate candidate-count query sharing the join's `WHERE` clause, rather than trusting `cursor.rowcount` (unreliable for `INSERT ... ON CONFLICT DO UPDATE` in sqlite3).
- Primary-type and floor exclusion tests insert directly into staging tables via SQL rather than adding new fixture files, since the Plan 02 fixtures don't carry a non-Album-type row or a second above-floor album needed for the refresh test — this avoids modifying Plan 02's existing fixture files and their already-passing tests.
- Confirmed live (HEAD/GET on public listing pages only, no bulk download) that MusicBrainz's `fullexport/LATEST` points to `20260701-002146` and `mbdump.tar.bz2` is ~7G compressed, and that ListenBrainz's `popular-releases-by-listeners/json` endpoint exists — enough to document exact, current, working operator commands in the README without downloading the actual multi-GB payloads in this session.

## Deviations from Plan

None — plan executed as written, including the exact join shape, the `ON CONFLICT(entity_type, mbid)` upsert with `created_at` excluded from the update path, and the real-data completion gate handling.

## Issues Encountered

None blocking. As instructed by the plan's real-data gate, the actual multi-GB dump download was not attempted after confirming (via lightweight directory-listing/HEAD checks, not bulk download) that the MusicBrainz core dump is ~7 GB compressed — consistent with Plan 02's prior finding that the full dumps are not fetchable in this build environment.

## User Setup Required

None — no external service configuration required. The pipeline needs no credentials; it only needs disk space and time to download the public CC0/open dumps documented in `pipeline/README.md`.

## Real-Data Status: Executed (data-pending)

**Phase 1 is NOT marked Complete by this plan.** Per the plan's explicit completion gate:

- All join/floor/upsert/verify LOGIC is built and proven green against fixtures (7/7 tests, plus the full 29-test pipeline suite).
- The real-data run (download real dumps, run all three CLIs, confirm `--verify` reports a tens-of-thousands album count with 100% required-column coverage) has **not** been executed here. The MusicBrainz `mbdump.tar.bz2` was confirmed live to be ~7 GB compressed — too large to download within this session's environment, matching the pattern already established in `01-02-SUMMARY.md`.
- **Operator commands to close this gap** (also documented in `pipeline/README.md`):

  ```bash
  # 1. Download + extract (see pipeline/README.md "Download the dumps" for full detail)
  curl -s https://data.metabrainz.org/pub/musicbrainz/data/fullexport/LATEST
  curl -O "https://data.metabrainz.org/pub/musicbrainz/data/fullexport/<LATEST-DIR>/mbdump.tar.bz2"
  tar -xjf mbdump.tar.bz2 mbdump/release_group mbdump/release_group_meta mbdump/artist_credit_name mbdump/artist
  curl -o popularity.json "https://datasets.listenbrainz.org/popular-releases-by-listeners/json"
  # convert to JSONL if needed (see README)

  # 2. Run the pipeline
  python3 pipeline/ingest_musicbrainz.py --mbdump-dir mbdump/ --db data/tastetest.db
  python3 pipeline/ingest_listenbrainz.py --popularity popularity.jsonl --db data/tastetest.db
  python3 pipeline/materialize.py --db data/tastetest.db

  # 3. Confirm success criterion 1
  python3 pipeline/materialize.py --verify --db data/tastetest.db
  ```

- Phase 1 completion is blocked on that `--verify` run confirming a total album count in the ~20,000-100,000 band with `all_required_columns_populated` equal to `total_albums`. If the count lands outside that band, adjust `NOTABILITY_MIN_LISTENERS` in `pipeline/config.py` per the re-tune loop in `pipeline/README.md` and re-run `materialize.py` before re-checking `--verify`.

## Next Phase Readiness

- All Phase 1 logic (staging ingest + materialize + verify) is complete and tested; Phase 2 (pick loop) can build against the `entities` table shape immediately once an operator runs the real-data steps above.
- No blockers on the code side. The only remaining gap before Phase 1 can be marked Complete is the operator-run real-dump `--verify` confirmation described above.

---
*Phase: 01-album-data-foundation*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created files exist (`pipeline/config.py`, `pipeline/materialize.py`, `pipeline/test_materialize.py`, `pipeline/README.md`) and all cited commit hashes (`a9c6aaa`, `56d408c`, `5f0f2e4`) exist in git log.
