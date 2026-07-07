---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: personal Album Case hardening
status: executing
stopped_at: Implemented stale-write protection, typed discovery outcomes, strict TS, and artist-MBID discovery
last_updated: "2026-07-07T00:00:00Z"
last_activity: 2026-07-07
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-03)

**Core value:** Turning the simplest placement (where this album belongs in Keith's list) into a durable personal album library.
**Current focus:** Personal Album Case hardening and live smoke verification

## Current Position

Phase: Personal Album Case hardening — EXECUTING
Plan: audit follow-ups in progress
Status: Core hardening implemented; live smoke pending
Last activity: 2026-07-04

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: - min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 3min | 2 tasks | 6 files |
| Phase 01 P02 | 25min | 2 tasks | 9 files |
| Phase 01 P03 | 12min | 2 tasks | 4 files |
| Phase 01 P04 | 3min | 2 tasks | 2 files |
| Phase 02 P01 | 20min | 2 tasks | 25 files |
| Phase 02 P02 | 12min | 1 tasks | 3 files |
| Phase 02 P03 | ~75min | 3 tasks | 13 files |
| Phase 02 P04 | ~45min | 2 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Current product is personal Album Case, not the older public Taste Test aggregate roadmap.
- Rankable unit = album (release-group).
- Owner-triggered MusicBrainz discovery is allowed for the personal app and uses `primary_artist_mbid`, not artist-name search.
- Drag-to-place transitive personal list, not Elo; candidate selection is randomized from eligible albums so seed order does not overexpose one era.
- Ranking snapshots are versioned on write so stale tabs/browsers cannot blindly overwrite newer Turso state.
- Mutations remain guarded by `ALBUM_CASE_WRITE_KEY`; public reads are still an accepted tradeoff.
- [Phase 01]: Serving store is single-file SQLite via stdlib sqlite3 at data/tastetest.db, gitignored — no third-party DB needed; entities PK is composite (entity_type, mbid), no surrogate id
- [Phase 01]: MB column-order constants pinned by fetching musicbrainz-server's current schema live (CreateTables.sql, InsertDefaultRows.sql) rather than from memory; release_group_primary_type id=1 confirmed as Album
- [Phase 01]: Staging tables use truncate-and-reload symmetrically for both MusicBrainz and ListenBrainz loaders (DELETE + reinsert share one transaction per table)
- [Phase 01]: NOTABILITY_MIN_LISTENERS=50 concrete default shipped; re-tune loop against real dump documented in pipeline/README.md, executed by operator
- [Phase 01]: Phase 1 real-data completion gate: mbdump.tar.bz2 confirmed live ~7G, too large to download in-session; materialize logic proven on fixtures only, status Executed (data-pending)
- [Phase 01-04]: Reworded covers.py docstring to avoid literal 'socket'/'urllib' substrings that tripped the plan's own comment-blind verify grep, without changing behavior
- [Phase 02-01]: web/ is a standalone Vite+TS product isolated from the legacy root vanilla-JS tool; te design system adopted by copying te-tokens.css/te-fonts.css/te-bridge.css + fonts/ into web/public/, not shared via symlink
- [Phase 02-01]: build-seed.py imports pipeline.covers.cover_url_for directly to guarantee the same Cover Art Archive pointer format as the pipeline; MVP seed resolved 405/422 curated albums against live MusicBrainz (temporary bootstrap, not the permanent catalog)
- [Phase 02-02]: applyPick throws on unrecognized winnerMbid instead of silently no-oping (fail loud on caller bugs)
- [Phase 02-02]: startPlacement on an empty ranked list finalizes synchronously with pending:null, avoiding a special-case empty-list branch in callers
- [Phase 02-03]: Player-facing mechanism pivoted from two-card binary insertion to text-only drag-to-place ranked list; existing binary-insertion engine remains kept and tested for future/reference use
- [Phase 02-03]: Set-aside lists (`wantToListen`, `notHeard`) are persisted under `tastetest-lists` and excluded from candidate selection
- [Phase 02-04]: Drag placements enqueue pairwise neighbor atoms to `/api/atom`; the server hardcodes `mechanism = 'drag_to_place'`, validates MBIDs against the seed allowlist, and writes to Turso with parameterized SQL
- [Phase 02-04]: Vercel project `eighth-chair-s-projects/web` has `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` set for production, preview, and development

### Pending Todos

- Run a live local smoke test with `web/.env.local` Turso credentials and `vercel dev`: unlock writes, discover an artist by MBID, place an album, reload, confirm persistence.
- Decide whether to archive/delete the remaining older public Taste Test planning material.
- Phase 1 bulk dump remains data-pending; it is not required for the current personal app.

### Blockers/Concerns

- Local Python test runner is missing `pytest` in the system Python environment.
- Name/domain/handle availability for the old "Taste Test" direction no longer blocks the current app.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-04T13:14:56.730Z
Stopped at: Completed 02-04-PLAN.md (Turso atom mailbox + retry queue)
Resume file: None
