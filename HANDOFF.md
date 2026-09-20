# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stage 1 (repo/docs cleanup + sync-engine extraction) and stage 2 (Playwright e2e harness) are complete and committed. Stage 3 (state ownership) is implemented and verified but **not yet committed**.

Stage 3 extracted the five closure-local variables that form "the ranking snapshot" (`state`, `lists`, `artistLocks`, `blockedArtists`, `curatedSkips`) out of `main()` into a new `web/src/rankingStore.ts`, mirroring exactly how stage 1 extracted the sync/retry/banner domain into `syncEngine.ts`: a `createRankingStore(initial)` factory with a get/set API, bootstrap's server/cache resolution left inline (same reasoning as stage 1), pure functions (`reRate`/`insertAtRating`/`setRating`/`addSearchedAlbum`/`restoreFromCode`) left untouched in `main.ts`. An Explore agent catalogued every one of the ~90 read/write sites across `main.ts` first; all were converted. No deduplication of the ~19 near-identical `state = {...}` write sites yet -- that's deliberately the next stage.

Verified: `tsc --noEmit` clean, 337/337 vitest tests unchanged, `npm run build` succeeds (47 modules, one more than before for the new file), and **all 6 Playwright e2e specs pass** (`npm run e2e`, also re-verified with `--workers=1`) -- this is the first stage where the stage-2 harness actually caught what it was built for: real browser-driven coverage of the exact `state`/`lists` mutation paths this refactor touched.

The "faulty premise" open thread from two sessions ago is resolved for now: Keith confirmed it's a separate conversation, not something that changes stage 3's scope.

## Next concrete step
Get Keith's review/approval on stage 3, then commit it, then start stage 4 (deduplicated ranking-action logic -- collapsing the ~19 duplicated `state = {...}; lists = ...; persistRankingState(); ...` call sites main.ts still has, now that they all go through `rankingStore`).

## Open questions
- Does Keith want stage 3 as one commit or split?

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- don't fold changes to it into this task's commits.
- Stage 4 (dedup the ranking-action call sites) has a full site-by-site inventory already done this session (see the plan file referenced below) -- reuse it rather than re-deriving.
- Stage 5/6 (candidate/discovery ownership + bootstrap, `rankList.ts` split) will hit the same `main()` bootstrap interleaving that limited stage 1's and stage 3's extractions -- budget extra investigation time.
- `blockedArtists`/`curatedSkips` already have a real owning concern (the moderation screen `renderBlockedArtists`), don't let a future candidate-selection extraction absorb ownership of them.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI.
- `loadSeedPool()` (`web/src/seed.ts`) throws if `/seed/albums.json` comes back empty, which crashes `main()`'s boot before `#app` renders anything. The e2e mock harness (`web/e2e/support/mockApi.ts`) defaults to a non-empty seed pool for exactly this reason.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.
- This session's stage-3 plan (with the full read/write-site inventory) is at `~/.claude/plans/scalable-gliding-backus.md` -- useful reference for stage 4's scoping even after it's been overwritten for a later stage.

## Files touched this session
- `web/src/rankingStore.ts` (new) -- the ranking-snapshot domain store
- `web/src/main.ts` -- ~90 read/write sites repointed at `rankingStore`; `ArtistLock` import dropped (no longer referenced directly)
- `HANDOFF.md` -- this file

## Git state
- Branch: main
- Last commit: `356830b` chore: update handoff (stage 2)
- Uncommitted changes: yes -- stage 3 (`web/src/rankingStore.ts` new, `web/src/main.ts` modified), plus this handoff update
- Stashed: no

## Reason for handoff
stage complete, awaiting review/commit decision

## Updated
2026-09-19T22:20:00Z
