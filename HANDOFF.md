# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stages 1-3 (repo/docs cleanup + sync-engine extraction, Playwright e2e harness, ranking-snapshot state ownership) are complete and committed. Stage 4 (deduplicated ranking-action logic) is implemented and verified but **not yet committed**.

Stage 4 collapsed `main.ts`'s ~18 near-identical `rankingStore.setState`/`setLists` call sites into six named action functions in a new `web/src/rankingActions.ts`: `rateAlbum` (6 sites), `reRateAt` (4 sites), `setRatingAt` (2 sites), `directRate` (2 sites), `setAside` (3 sites), and `placeAt` (1 site, kept mostly for naming clarity since `onPlace`'s pairwise-atom logging makes it a genuine one-off). The four pure functions (`reRate`/`insertAtRating`/`addSearchedAlbum`/`setRating`) moved into the same file (to avoid a circular import with `main.ts`), with `main.ts` re-exporting them so `main.test.ts`/`backlog.test.ts` didn't need to change. Also did a small in-place dedup: `renderBacklog`'s `onArtist`/`onDecide` now share a local `setCurrentArtistId` closure (`onFinish` stays separate since it changes a second field at the same time). No change to what gets persisted, when, or in what order, anywhere.

Verified: `tsc --noEmit` clean, 337/337 vitest tests unchanged, `npm run build` succeeds (48 modules), all 6 Playwright e2e specs pass (also re-verified with `--workers=1`). `main.ts` dropped from 1558 to 1473 lines; `rankingActions.ts` is 143 lines.

## Next concrete step
Get Keith's review/approval on stage 4, then commit it, then start stage 5/6 (candidate/discovery ownership + bootstrap, and the `rankList.ts` split -- order between these two not yet decided).

## Open questions
- Does Keith want stage 4 as one commit or split?
- Order for stages 5 and 6 -- candidate/discovery ownership first, or the `rankList.ts` split first? Not discussed yet.

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- don't fold changes to it into this task's commits.
- Stage 5 (candidate/discovery ownership + bootstrap) will hit the same `main()` bootstrap interleaving that limited stages 1 and 3's extractions -- budget extra investigation time.
- `blockedArtists`/`curatedSkips` already have a real owning concern (the moderation screen `renderBlockedArtists`), don't let a future candidate-selection extraction absorb ownership of them.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI.
- `loadSeedPool()` (`web/src/seed.ts`) throws if `/seed/albums.json` comes back empty, which crashes `main()`'s boot before `#app` renders anything. The e2e mock harness (`web/e2e/support/mockApi.ts`) defaults to a non-empty seed pool for exactly this reason.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.

## Files touched this session
- `web/src/rankingActions.ts` (new) -- the four pure ranking-mutation functions plus six store-aware action functions
- `web/src/main.ts` -- ~18 call sites collapsed to action-function calls; unused imports (`RankedAlbum`, `ratingForDropIndex`, `removeFromAllLists`, `setAsideAlbum`) dropped
- `HANDOFF.md` -- this file

## Git state
- Branch: main
- Last commit: `74be5e2` chore: update handoff (stage 3)
- Uncommitted changes: yes -- stage 4 (`web/src/rankingActions.ts` new, `web/src/main.ts` modified), plus this handoff update
- Stashed: no

## Reason for handoff
stage complete, awaiting review/commit decision

## Updated
2026-09-19T22:55:00Z
