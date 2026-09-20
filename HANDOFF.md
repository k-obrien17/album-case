# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stages 1-6 are complete, verified, and committed: repo/docs cleanup + sync-engine extraction, Playwright e2e harness, ranking-snapshot state ownership (`rankingStore.ts`), deduplicated ranking-action logic (`rankingActions.ts`), the MusicBrainz search UI split (`rankListSearch.ts`), and now the drag mechanics split (`rankListDrag.ts`). Working tree is clean, nothing uncommitted.

Stage 5's investigation found the search UI was the only one of `rankList.ts`'s four separable concerns with zero shared mutable state with the rest of the file, and flagged a "real circular dependency" between drag mechanics and `render()`. Stage 6 re-verified that claim directly (full-file read + grep of every call site of all 12 drag functions and the `drag` variable, cross-checked by a Plan agent) and found it wasn't a true circularity: `render()` is a hoisted function declaration, so it can be forward-referenced into the new module's deps exactly the way `showStatus` already is into `createSearchSection` -- no ordering hazard. `rankList.ts` is now 905 lines (down from 1319 at the start of the split). Row rendering's `editingOverallMbid`/`editingRatingMbid` bidirectional coupling is still deliberately left unextracted (see Don't forget).

## Next concrete step
Candidate/discovery ownership + bootstrap -- the other remaining piece of the original 6-stage plan, not yet started. Expect it to hit the same `main()` bootstrap interleaving that limited stages 1 and 3 (see Don't forget); budget extra investigation time before committing to an extraction shape.

## Open questions
None open right now.

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- don't fold changes to it into this task's commits.
- Row rendering (`buildRow`/`buildOverallControl`/`buildRatingControl`) has genuine bidirectional coupling: `editingOverallMbid`/`editingRatingMbid` are cross-written (each control closes the other's editor) -- can't split those two functions apart without hoisting both variables into a shared state object.
- Candidate/discovery ownership + bootstrap will hit the same `main()` bootstrap interleaving that limited stages 1 and 3's extractions -- budget extra investigation time.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.

## Git state
- Branch: main
- Last commit: `e4ae3ba` refactor(web): extract drag mechanics out of rankList.ts
- Uncommitted changes: no
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-20T01:55:00Z
