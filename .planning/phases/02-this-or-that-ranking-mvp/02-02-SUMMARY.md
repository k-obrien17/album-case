---
phase: 02-this-or-that-ranking-mvp
plan: 02
subsystem: algorithm
tags: [typescript, vitest, binary-insertion, ranking, tdd]

# Dependency graph
requires:
  - phase: 02-this-or-that-ranking-mvp
    provides: "web/ Vite+TS scaffold, vitest wired via npm test (plan 02-01)"
provides:
  - "Pure, DOM-free binary-insertion ranking engine (web/src/ranking/insertion.ts)"
  - "RankingState/Comparison/Album/Pending types (web/src/ranking/types.ts)"
  - "Property-tested transitivity proof: any pick sequence reproduces a hidden total order exactly"
affects: [02-03, 02-04, pick-loop-ui, persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ranking engine is pure functions over plain-data state (no classes, no DOM/localStorage/fetch imports) so it is unit-testable in isolation and trivially JSON-serializable for refresh persistence"
    - "TDD RED->GREEN commit pairs: test(02-02) failing-test commit followed by feat(02-02) implementation commit"

key-files:
  created:
    - web/src/ranking/types.ts
    - web/src/ranking/insertion.ts
    - web/src/ranking/insertion.test.ts
  modified: []

key-decisions:
  - "applyPick throws on a winnerMbid that is neither the candidate nor the current opponent, rather than silently ignoring it — a stale/mismatched comparison is a caller bug and should fail loudly instead of corrupting the ranked list"
  - "startPlacement on an empty ranked list finalizes synchronously (no pending state) so callers can always chain startPlacement -> nextComparison without a special-case empty-list branch"

patterns-established:
  - "Fuzz/property tests use a seeded PRNG (mulberry32) instead of Math.random so failures are reproducible across runs"

requirements-completed: [RANK-02, RANK-03]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 2 Plan 2: Binary-Insertion Ranking Engine Summary

**Pure TypeScript binary-insertion state machine (startPlacement/nextComparison/applyPick) that inserts each pick into a transitive personal ranked list via deterministic midpoint comparisons, proven by a seeded-PRNG property test across 25 randomized insertion sequences over a 40-album pool**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-04T13:00:00Z (approx)
- **Completed:** 2026-07-04T13:12:00Z
- **Tasks:** 1 TDD feature (RED then GREEN; no REFACTOR commit needed, implementation was clean on first pass)
- **Files modified:** 3 (all created)

## Accomplishments

- `web/src/ranking/insertion.ts`: pure, DOM-free binary-insertion engine — `startPlacement`, `nextComparison`, `applyPick` — with zero imports of `document`, `localStorage`, `fetch`, or `window` (verified by grep, count 0)
- `web/src/ranking/types.ts`: `Album`, `Pending`, `RankingState`, `Comparison` — plain-data shapes matching the plan's interface contract exactly
- 14 vitest tests, all green, including:
  - Empty-list immediate-finalize behavior
  - Deterministic `floor((lo+hi)/2)` midpoint pairing (never random)
  - lo/hi narrowing on candidate-win vs opponent-win
  - Exact splice-index finalize scenario (`[A,B,C,D]` + insert `X` between B and C -> `[A,B,X,C,D]`)
  - Comparison-count bound (`<= ceil(log2(k+1))`) checked at k in {0,1,2,3,4,5,8,16,31,32,100}
  - **Transitivity property test:** 25 seeded-random iterations over a 40-album pool, each with an independently shuffled hidden preference order and insertion order — every run's final `ranked` list exactly equals the hidden order, with zero self-contradicting recorded picks
  - JSON round-trip resumability of an in-progress `pending` placement, then successful continuation to finalize

## Task Commits

TDD RED/GREEN pair (single plan-level feature, per `type: tdd` frontmatter):

1. **RED — failing tests for the ranking engine** - `c76da60` (test)
2. **GREEN — implement the binary-insertion engine** - `4a72eb1` (feat)

No REFACTOR commit: the GREEN implementation required no cleanup pass to stay readable/DRY.

## Files Created/Modified

- `web/src/ranking/types.ts` - `Album`, `Pending`, `RankingState`, `Comparison` type definitions
- `web/src/ranking/insertion.ts` - `startPlacement`, `nextComparison`, `applyPick`; pure, immutable state transitions
- `web/src/ranking/insertion.test.ts` - 14 tests covering every behavior in the plan's `<behavior>` block plus a seeded-PRNG transitivity property test

## Decisions Made

- `applyPick` throws on an unrecognized `winnerMbid` instead of silently no-oping, so a UI bug (stale comparison object, race condition) surfaces immediately rather than corrupting the ranked list — an unplanned but low-risk defensive addition (Rule 2: missing critical validation), covered by its own test.
- `startPlacement` on an empty list returns `pending: null` immediately (per the plan's explicit edge-case note), so the calling loop (`startPlacement` -> `nextComparison` -> loop until null) never needs a special branch for "first album ever."

## Deviations from Plan

**1. [Rule 2 - Missing Critical] Threw on invalid `winnerMbid` in `applyPick`**
- **Found during:** writing the RED test suite for `applyPick`
- **Issue:** the plan's contract doesn't specify behavior for a `winnerMbid` that matches neither the candidate nor the current opponent (e.g., a stale comparison from before a refresh, or a UI bug passing the wrong id)
- **Fix:** `applyPick` throws a descriptive `Error` in that case instead of silently doing nothing or narrowing incorrectly
- **Files modified:** `web/src/ranking/insertion.ts`
- **Verification:** dedicated test `"throws if the winner is neither the candidate nor the current opponent"` passes
- **Committed in:** `4a72eb1` (GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical validation)
**Impact on plan:** Defensive addition only; no scope creep, no change to the documented public contract's happy-path behavior.

## Issues Encountered

The verification grep (`grep -Ec 'document|localStorage|fetch|window' insertion.ts` must equal 0) initially matched a doc comment that used the words "DOM-free", "document", "localStorage", and "fetch" as prose describing what the module avoids. Reworded the comment to avoid those literal tokens while preserving the same explanation; re-ran the grep and confirmed 0.

## User Setup Required

None - no external services, no environment variables, no manual configuration.

## Next Phase Readiness

- `web/src/ranking/insertion.ts` is ready to be wired into the pick-loop UI (plan 02-03): the UI only needs to call `startPlacement`/`nextComparison`/`applyPick` and render whatever `Comparison` (or `null`) comes back — it never needs to know about lo/hi internals.
- `RankingState` is plain JSON-serializable data, so plan 02-03's `localStorage` persistence layer can `JSON.stringify(state)` directly with no adapter, satisfying the refresh-resume requirement already proven by this plan's round-trip test.
- No blockers. RANK-02 and RANK-03 are fully proven by unit tests; RANK-01, RANK-04, RANK-05 and the PLAY-0x requirements remain for later plans in this phase.

---
*Phase: 02-this-or-that-ranking-mvp*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created files verified present (`types.ts`, `insertion.ts`, `insertion.test.ts`, this SUMMARY.md); both task commits (`c76da60`, `4a72eb1`) verified present in git log.
