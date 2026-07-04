---
phase: 01-album-data-foundation
plan: 04
subsystem: database
tags: [sqlite, cover-art-archive, musicbrainz, pointers-not-files, python, stdlib]

# Dependency graph
requires:
  - phase: 01-album-data-foundation
    provides: pipeline/db.py (connect, init_db, now_ms), pipeline/schema.sql (entities.cover_url column reserved in Plan 01), pipeline/materialize.py (album rows written into entities in Plan 03)
provides:
  - pipeline/covers.py cover_url_for(mbid) -- pure string template, zero network I/O
  - pipeline/covers.py apply_cover_pointers(conn) -- idempotent per-MBID UPDATE of entities.cover_url scoped to entity_type='album'
  - pipeline/covers.py CLI (python3 pipeline/covers.py --db ...) as the pipeline's final step after materialize.py
affects: [02-pick-loop, any-phase-rendering-album-art]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cover pointers are constructed by-template from an MBID already in the store, never fetched or verified via HTTP -- the same 'reference, don't copy' rule DATA-SOURCES.md applies to Deezer/TheAudioDB images applies here to the URL construction itself (zero per-row network calls, zero rate-limit surface)"
    - "Docstrings/comments in a module claiming zero network I/O must avoid literal substrings ('socket', 'urllib', etc.) that a verification grep also matches -- the module's own comments can trip its own automated check if worded carelessly"

key-files:
  created:
    - pipeline/covers.py
    - pipeline/test_covers.py
  modified: []

key-decisions:
  - "apply_cover_pointers loops per-row (one parameterized UPDATE per album mbid) rather than a single set-based UPDATE, because the pointer value itself must be computed in Python per-row (cover_url_for(mbid)) -- SQLite has no native string-templating expression to do this in one statement without falling back to string concatenation in SQL, which the plan's naming_conventions explicitly reserve for parameter binding only"
  - "Reworded the module docstring to avoid the literal words 'socket'/'urllib'/etc. after discovering the plan's own automated verify grep (grep -qiE 'urllib|requests|httpx|http\\.client|socket|urlopen') matches comments too, not just imports -- the check is byte-level, not semantic"

requirements-completed: [DATA-03]

# Metrics
duration: 3min
completed: 2026-07-03
---

# Phase 1 Plan 4: Cover Art Archive Pointers Summary

**`pipeline/covers.py` writes a per-album Cover Art Archive front-cover pointer (`https://coverartarchive.org/release-group/{mbid}/front-500`) into `entities.cover_url` via a parameterized UPDATE, performing zero network I/O -- proven by 5 passing tests including one that disables `socket.socket` entirely.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-03T22:18:13-04:00 (approx., following prior plan's commit)
- **Completed:** 2026-07-03T22:20:59-04:00
- **Tasks:** 2 completed
- **Files modified:** 2 created

## Accomplishments

- `cover_url_for(mbid)` returns the exact CAA front-500 template URL for any MBID via pure string interpolation, no network call.
- `apply_cover_pointers(conn)` selects every `entities` row with `entity_type = 'album'`, computes each row's own pointer, and writes it back with a parameterized `UPDATE entities SET cover_url = ?, updated_at = ? WHERE entity_type = 'album' AND mbid = ?`. Returns the integer count of rows updated.
- Non-album rows (`song`, etc.) are untouched by construction -- the `SELECT` and `UPDATE` are both scoped to `entity_type = 'album'`.
- Idempotent: a second call recomputes and re-sets the same deterministic URLs, no duplicate rows, no error -- proven directly by calling `apply_cover_pointers` twice and asserting identical URLs and row counts.
- Zero network I/O is proven, not just claimed: a test patches `socket.socket` to raise `AssertionError` on any call, then asserts `apply_cover_pointers` still completes and sets the correct pointer.
- Each test asserts the pointer is keyed to *that row's own* MBID (regex-extracted from the URL and compared), which would fail if `covers.py` ever hardcoded a single constant URL.
- A `if __name__ == "__main__":` CLI guard opens `DEFAULT_DB_PATH` (or `--db`), runs `apply_cover_pointers`, and prints the updated count, so it can run as the pipeline's final step after `materialize.py`.

## Task Commits

Both tasks were plain `auto`/TDD-flagged tasks; commits:

1. **Task 1: Author cover-pointer population** - `e7b2915` (feat)
2. **Task 2: Cover-pointer tests** - `a9cffe9` (test)

**Plan metadata:** (this commit, docs: complete plan)

Task 2 was written and run against the already-existing `covers.py` from Task 1 (both files were specified together in the plan's tasks, with Task 1 authoring the implementation and Task 2 authoring behavior-proving tests) -- all 5 tests passed on first run with no implementation changes needed. The full pipeline suite (34 tests across `test_covers.py`, `test_ingest.py`, `test_materialize.py`, `test_schema.py`) is green.

## Files Created/Modified

- `pipeline/covers.py` -- `cover_url_for()`, `apply_cover_pointers()`, CLI entry point; zero HTTP-client imports, zero network I/O
- `pipeline/test_covers.py` -- 5 tests: exact template match, per-MBID keying across multiple albums, non-album exclusion, idempotency, no-network-I/O proof via `socket.socket` patch

## Decisions Made

- Looped per-row parameterized `UPDATE` instead of a single set-based statement, since the pointer string must be computed in Python (`cover_url_for`) per MBID -- there is no SQL-native way to template the URL without string-formatting values into SQL, which the plan's `naming_conventions` forbid.
- Reworded the module docstring after the plan's own literal verify grep (`grep -qiE 'urllib|requests|httpx|http\.client|socket|urlopen'`) initially flagged the file -- the docstring had used the words "socket" and "urllib" in prose describing what the module does *not* do. Since the grep is byte-level and does not distinguish code from comments, the docstring was reworded to describe the zero-network-I/O guarantee without using the trigger substrings, while keeping the intent unambiguous. This is documented here because it is a small but real "the check checks the file, not the intent" gotcha future plans in this repo should watch for.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded covers.py docstring to pass the plan's own literal grep verification**
- **Found during:** Task 1, running the plan's own `<verify>` command
- **Issue:** The plan's automated verify command (`grep -qiE 'urllib|requests|httpx|http\.client|socket|urlopen' pipeline/covers.py`) is a literal, comment-blind substring search. The initial docstring, while accurately describing the "no HTTP client, no socket" guarantee in prose, used the literal words "socket" and "urllib" and so tripped the same grep meant to prove their absence as imports.
- **Fix:** Reworded the docstring to describe the zero-network-I/O behavior without using the trigger substrings (e.g., "opens no outbound connection of any kind" instead of naming `socket`/`urllib` directly).
- **Files modified:** `pipeline/covers.py`
- **Verification:** Re-ran `grep -qiE 'urllib|requests|httpx|http\.client|socket|urlopen' pipeline/covers.py && echo 'FAIL...' || echo 'ok...'` -- now prints `ok: no network client`.
- **Committed in:** `e7b2915` (Task 1 commit; fixed before the commit was made, not a follow-up)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cosmetic wording fix only; no behavior, test, or acceptance-criteria change. No scope creep.

## Issues Encountered

None blocking beyond the docstring/grep interaction documented above.

## User Setup Required

None -- no external service configuration required. `covers.py` needs no credentials or network access; it only writes computed strings to the local SQLite store.

## Next Phase Readiness

- Every album materialized by Plan 03's `materialize_albums()` now gets a well-formed, per-MBID Cover Art Archive pointer the moment `apply_cover_pointers` runs, satisfying DATA-03.
- `pipeline/covers.py` is designed to run as the pipeline's final step (`ingest_musicbrainz.py` -> `ingest_listenbrainz.py` -> `materialize.py` -> `covers.py`), though `pipeline/README.md`'s documented three-command run order (from Plan 03) does not yet mention this fourth command -- a follow-up doc touch-up, not a blocker, since the function is fully tested and callable today.
- Coverage reality (not every release-group has front art, so some CAA URLs will 404 at render time) is explicitly out of scope per the plan and deferred to Phase 2's display layer, as documented in the plan's `<cover_decision>`.
- No blockers on the code side for Phase 2. Phase 1's remaining gap is unchanged from Plan 03: the real-dump `--verify` run is still operator-pending (data volume, not logic).

---
*Phase: 01-album-data-foundation*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created files exist (`pipeline/covers.py`, `pipeline/test_covers.py`) and both cited commit hashes (`e7b2915`, `a9cffe9`) exist in git log.
