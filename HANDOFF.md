# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stages 1-5 are complete, verified, and committed: repo/docs cleanup + sync-engine extraction, Playwright e2e harness, ranking-snapshot state ownership (`rankingStore.ts`), deduplicated ranking-action logic (`rankingActions.ts`), and the first cut of the `rankList.ts` split (MusicBrainz search UI extracted into `rankListSearch.ts`). Working tree is clean, nothing uncommitted.

Stage 5's investigation (an Explore agent mapped every closure-scoped mutable variable and `RankListOptions` field's usage across the whole 1319-line `rankList.ts`) found the search UI was the only one of the file's four separable concerns with zero shared mutable state with the rest of the file. Drag mechanics has a real circular dependency with `render()`; row rendering has genuine bidirectional coupling between the overall-rank and rating tap-to-edit controls (`editingOverallMbid`/`editingRatingMbid` cross-write each other). Both were deliberately left for later.

## Next concrete step
Decide what's next -- this was an open question when the session ended, not yet put to Keith: another `rankList.ts` cut (drag mechanics is the next-cleanest candidate, though riskier than stage 5 -- see Don't forget), or candidate/discovery ownership + bootstrap (the other remaining piece of the original 6-stage plan). Ask Keith before picking; it's a real fork, not an obvious call.

## Open questions
- Drag mechanics vs. candidate/discovery ownership -- which next? Not discussed with Keith yet.

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- don't fold changes to it into this task's commits.
- Drag mechanics (`positionGhost` through `startDrag`, ~230 lines, in `rankList.ts`) is the next-best extraction candidate, but has a real circular dependency with `render()` (tap-fallback/no-op-reorder branches in `onPointerUp` call `render()` directly) that needs a forward-reference pattern to extract safely -- budget extra care.
- Row rendering (`buildRow`/`buildOverallControl`/`buildRatingControl`) has genuine bidirectional coupling: `editingOverallMbid`/`editingRatingMbid` are cross-written (each control closes the other's editor) -- can't split those two functions apart without hoisting both variables into a shared state object.
- Candidate/discovery ownership + bootstrap will hit the same `main()` bootstrap interleaving that limited stages 1 and 3's extractions -- budget extra investigation time.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.

## Git state
- Branch: main
- Last commit: `4f3a144` chore: update handoff
- Uncommitted changes: no
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-19T23:25:00Z
