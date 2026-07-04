---
phase: 01-album-data-foundation
plan: 01
subsystem: database
tags: [sqlite, schema, python, stdlib]

# Dependency graph
requires: []
provides:
  - Polymorphic entities table keyed by (entity_type, mbid)
  - Generic mechanism-tagged atoms table for pairwise picks
  - Anonymous sessions table (no account/user concept)
  - pipeline/db.py connect() + init_db() + now_ms() helpers
affects: [01-02, 01-03, 01-04, phase-02-pick-loop]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Polymorphic entity via composite PK (entity_type, mbid)"
    - "Generic pairwise atom table, mechanism-tagged, no FK to entities"
    - "Idempotent schema via CREATE TABLE/INDEX IF NOT EXISTS + executescript"

key-files:
  created:
    - pipeline/__init__.py
    - pipeline/schema.sql
    - pipeline/db.py
    - pipeline/test_schema.py
    - data/.gitkeep
  modified:
    - .gitignore

key-decisions:
  - "SQLite via stdlib sqlite3, single file at data/tastetest.db, gitignored"
  - "entities PK is composite (entity_type, mbid); no separate surrogate id"
  - "atoms has no foreign key to entities, keeping it entity-type agnostic"

patterns-established:
  - "entity_type discriminator column lets song/artist rows slot in later with zero DDL change"

requirements-completed: [SCHEMA-01, SCHEMA-02, SCHEMA-03]

# Metrics
duration: 3min
completed: 2026-07-03
---

# Phase 1 Plan 1: Serving Store Schema Summary

**SQLite serving store with a polymorphic `entities(entity_type, mbid)` table, a generic mechanism-tagged `atoms` table, and an anonymous `sessions` table, all proven by 7 passing pytest tests.**

## Performance

- **Duration:** ~3 min (schema authoring through GREEN)
- **Started:** 2026-07-03T21:50:00-04:00
- **Completed:** 2026-07-03T21:52:03-04:00
- **Tasks:** 2 completed
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments
- `entities` table proven polymorphic: an `'album'` row and a `'song'` row coexist under the identical schema, differentiated only by the `entity_type` column in the composite PK.
- `atoms` table proven entity-type agnostic: a `mechanism='this_or_that'` pick inserts and reads back with no entity_type column or foreign key required.
- `sessions` table proven as the sole anonymous grouping key: two atoms rows group under one `session_id` with no account/user row anywhere in the schema.
- `init_db()` proven idempotent: calling it twice on the same connection leaves exactly three tables, no errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the polymorphic schema DDL** - `9c0cfa0` (feat)
2. **Task 2: Connection helper + schema-init + polymorphism tests** - `7d81078` (test, RED) then `a61d7d5` (feat, GREEN)

**Plan metadata:** (this commit, docs: complete plan)

_Task 2 was TDD: failing tests committed first (7d81078), then db.py implementation made them pass (a61d7d5). No refactor commit was needed — the implementation was already minimal and clean on first pass._

## Files Created/Modified
- `pipeline/__init__.py` - empty package marker
- `pipeline/schema.sql` - DDL for entities, atoms, sessions, and four indexes
- `pipeline/db.py` - `connect()`, `init_db()`, `now_ms()`, `DEFAULT_DB_PATH`
- `pipeline/test_schema.py` - 7 pytest tests proving polymorphism, generic atoms, session grouping, integrity, idempotency
- `data/.gitkeep` - keeps the store directory tracked
- `.gitignore` - added `data/*.db` and `data/*.db-*` so the generated store file and WAL/SHM sidecars are never committed

## Decisions Made
- SQLite via Python stdlib `sqlite3`, single file at `data/tastetest.db`, created on demand and gitignored (per plan's `<store_decision>`, no third-party DB).
- `entities` uses a composite PK `(entity_type, mbid)` rather than a surrogate integer id, so the row's identity is inseparable from its type and MBID and no separate uniqueness constraint is needed.
- `atoms` carries no foreign key to `entities` and no entity_type column, keeping the pairwise-pick substrate generic across current and future comparison mechanisms.
- Ran tests via the repo's existing `.venv` (matches CLAUDE.md "Python tooling runs in the local `.venv`"); confirmed identical pass results with `.venv` activated so plain `python3 -m pytest` works as documented in the plan's verify command.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met on first implementation pass; no auto-fixes, no architectural questions, no auth gates.

## Issues Encountered

None.

## Next Phase Readiness

- The schema is stable and ready for Plan 02 (MusicBrainz ingestion) to populate `entities` with `entity_type='album'` rows.
- `atoms` and `sessions` are ready for Phase 2's pick loop to write into without any further DDL change.
- `data/tastetest.db` does not exist yet — it materializes on first `connect()`/`init_db()` call by a later plan or the app itself.

---
*Phase: 01-album-data-foundation*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created files verified present on disk; all three task commit hashes (9c0cfa0, 7d81078, a61d7d5) verified present in git log.
