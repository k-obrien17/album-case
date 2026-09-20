# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stages 1-4 (repo/docs cleanup + sync-engine extraction, Playwright e2e harness, ranking-snapshot state ownership, deduplicated ranking-action logic) are complete and committed. Stage 5 (first cut of the `rankList.ts` split) is implemented and verified but **not yet committed**.

Stage 5 extracted the MusicBrainz search UI (search box, result rows, artist rows, empty/fallback states -- 7 functions, ~250 lines) out of `rankList.ts`'s `mountRankList` closure into a new `web/src/ui/rankListSearch.ts`. This was the cleanest of the file's four separable concerns (drag mechanics, row rendering, candidate card, search UI) -- an Explore agent mapped every closure-scoped mutable variable and `RankListOptions` field's usage first, and confirmed the search cluster shares zero mutable state with the rest of the file (unlike drag mechanics, which has a real circular dependency with `render()`, or row rendering, which has genuine bidirectional coupling between the overall-rank and rating tap-to-edit controls). Drag mechanics and row rendering are deliberately left for future stages -- one concern at a time, same discipline as stages 1-4.

Verified: `tsc --noEmit` clean, 337/337 vitest tests unchanged, `npm run build` succeeds (49 modules), all 6 Playwright e2e specs pass (also re-verified with `--workers=1`) -- `stale-search.spec.ts` exercises the extracted code directly. `rankList.ts` dropped from 1319 to 1074 lines; `rankListSearch.ts` is 300 lines.

## Next concrete step
Get Keith's review/approval on stage 5, then commit it, then decide the next cut of the `rankList.ts` split (drag mechanics vs. row rendering) or move to candidate/discovery ownership + bootstrap -- three remaining pieces of the original 6-stage plan, order not yet decided.

## Open questions
- Does Keith want stage 5 as one commit or split?
- What's next: another `rankList.ts` cut (drag mechanics is the next-cleanest, per this session's investigation) or candidate/discovery ownership + bootstrap? Not discussed.

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- don't fold changes to it into this task's commits.
- Drag mechanics (`positionGhost` through `startDrag`, ~230 lines) is the next-best `rankList.ts` extraction candidate, but has a real circular dependency with `render()` (tap-fallback/no-op-reorder branches in `onPointerUp` call `render()` directly) that needs a forward-reference pattern to extract safely -- budget extra care.
- Row rendering (`buildRow`/`buildOverallControl`/`buildRatingControl`) has genuine bidirectional coupling: `editingOverallMbid`/`editingRatingMbid` are cross-written (each control closes the other's editor) -- can't split those two functions apart without hoisting both variables into a shared state object.
- Candidate/discovery ownership + bootstrap (mentioned in earlier handoffs) will hit the same `main()` bootstrap interleaving that limited stages 1 and 3's extractions -- budget extra investigation time.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.

## Files touched this session
- `web/src/ui/rankListSearch.ts` (new) -- `SearchResultsState` type, `subtitle` helper, and `createSearchSection` (the MusicBrainz search UI, previously inline in `rankList.ts`)
- `web/src/ui/rankList.ts` -- the 7 search functions replaced with one `createSearchSection(...)` call; re-exports `SearchResultsState` so `main.ts`'s import is unchanged
- `HANDOFF.md` -- this file

## Git state
- Branch: main
- Last commit: `9e9243a` chore: update handoff (stage 4)
- Uncommitted changes: yes -- stage 5 (`web/src/ui/rankListSearch.ts` new, `web/src/ui/rankList.ts` modified), plus this handoff update
- Stashed: no

## Reason for handoff
stage complete, awaiting review/commit decision

## Updated
2026-09-19T23:15:00Z
