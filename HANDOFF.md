# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stage 1 (repo/docs cleanup) is complete and committed. Stage 2 (Playwright e2e verification harness) is implemented and verified, but **not yet committed** -- Keith approved the design in chat this session; the code itself hasn't been reviewed or committed yet. `tsc --noEmit` clean (now covers `web/e2e/` too), 337/337 vitest tests still pass (vitest is configured to exclude `e2e/**` so it doesn't try to collect Playwright's `test()` calls), `npm run build` unaffected (46 modules, same as before), and all 6 e2e specs pass reliably across repeated runs (`npm run e2e`, also re-verified with `--workers=1`).

Keith's answer to the "faulty premise" open question from last session was "Everything" -- broad and still not fully resolved (candidate-selection design vs. the simplification plan vs. something else). He approved stage 2 immediately after answering it, so stage 2 proceeded, but this is a live thread that hasn't been closed out. Don't let it get lost before stage 3 (state-ownership work) starts.

## Next concrete step
Get Keith's review/approval on the stage-2 harness, then commit it (or split into logical commits if he prefers), then start stage 3. Before stage 3 begins, circle back on "Everything" from the faulty-premise question -- it may bear on how stage 3+ should be scoped.

## Open questions
- What did Keith mean by "Everything" (see Status above)? Not yet clarified further. Ask directly rather than assuming it only affects candidate selection.
- Does Keith want stage 2 as one commit or split (e.g. dependency/config vs. specs)?

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` was picked up and committed separately this session's predecessor (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- it is no longer untracked, but it's still unrelated to the simplification effort; don't fold future changes to it into this task's commits.
- Stage 4 (candidate/discovery ownership + bootstrap) will hit the same `main()` bootstrap interleaving that limited the stage-1 sync-engine extraction, budget extra investigation time.
- `blockedArtists`/`curatedSkips` already have a real owning concern (the moderation screen `renderBlockedArtists`), don't let a future candidate-selection extraction absorb ownership of them.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI. Worth remembering for any future UI work/tests too.
- `loadSeedPool()` (`web/src/seed.ts`) throws if `/seed/albums.json` comes back empty, which crashes `main()`'s boot before `#app` renders anything. The e2e mock harness (`web/e2e/support/mockApi.ts`) defaults to a non-empty seed pool for exactly this reason -- don't remove that default.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.

## Files touched this session
- `web/package.json`, `web/package-lock.json` -- added `@playwright/test` devDependency + `e2e` script
- `web/playwright.config.ts` (new) -- chromium-only project, `webServer` builds + serves `dist/` via `vite preview`
- `web/tsconfig.json` -- `include` now covers `e2e` and `playwright.config.ts`
- `web/vite.config.ts` -- vitest `test.exclude` extended with `e2e/**` so vitest doesn't collect Playwright specs
- `web/.gitignore` -- added `test-results/`, `playwright-report/`
- `web/e2e/support/fixtures.ts`, `web/e2e/support/mockApi.ts` (new) -- deterministic album/snapshot fixtures and the full `/seed/**` + `/api/**` route-interception harness (catch-all fails any unmocked request)
- `web/e2e/placement.spec.ts`, `web/e2e/reorder.spec.ts`, `web/e2e/rating-across-views.spec.ts`, `web/e2e/stale-search.spec.ts`, `web/e2e/sync-retry-conflict.spec.ts` (new) -- the five approved coverage areas
- `HANDOFF.md` -- this file
- Playwright's chromium browser binary was installed locally (`npx playwright install chromium`, not a repo file)

## Git state
- Branch: main
- Last commit: `4f17298` feat(scripts): add daily keithrobrien.com album-data refresh job
- Uncommitted changes: yes -- all of stage 2 (see Files touched above), nothing else
- Stashed: no

## Reason for handoff
stage complete, awaiting review/commit decision

## Updated
2026-09-19T21:58:00Z
