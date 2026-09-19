# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stage 1 (repo/docs cleanup) is complete, committed, and verified (`tsc --noEmit` clean, 337/337 tests, build bundle hash unchanged). Stage 2 (isolated, fixture-backed, API-intercepting Playwright verification harness, required before any interaction-touching work) was designed and proposed in chat but not yet approved. No stage-2 dependency or test code has been added. The session paused on an unresolved clarifying question before stage 2 could start.

## Next concrete step
Resolve the open question below with Keith, then get explicit approval on the stage-2 design before adding `@playwright/test` or writing any test code.

## Open questions
- Keith said "I think it just started from a faulty premise, and I am not sure if I ever corrected it" in response to a discussion of the app's candidate-selection priorities (smart recommendation, artist-hiding, LP-prioritization). What "it" refers to is unresolved, the app's candidate-selection design, the simplification plan itself, or something else. Ask directly before proceeding; don't guess.
- Has Keith approved the stage-2 verification design (Playwright, `web/e2e/`, route interception with a catch-all that fails unexpected requests, coverage for placement/reorder/rating-across-views/stale-search/sync-retry-conflict)?

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is untracked, pre-existing, and unrelated. Never sweep it into a commit for this task.
- Stage 4 (candidate/discovery ownership + bootstrap) will hit the same `main()` bootstrap interleaving that limited the stage-1 sync-engine extraction, budget extra investigation time.
- `blockedArtists`/`curatedSkips` already have a real owning concern (the moderation screen `renderBlockedArtists`), don't let a future candidate-selection extraction absorb ownership of them.
- The full governing plan (owner's 6 numbered points + suggested stage sequence + success metric) and the three investigation findings behind it are recorded in this repo's git history (commit `235c568`'s predecessor conversation) — re-read the prior HANDOFF.md via `git log -p -- HANDOFF.md` if the summary above isn't enough detail.

## Files touched this session
- `archive/elo-demo.html`, `archive/pairwise-demo.html`, `archive/poc/`, `archive/PRODUCT.md`, `README.md`, `CLAUDE.md`, `DATA-SOURCES.md`, `.planning/PROJECT.md` — repo cleanup, commit `0bd5357`
- `web/src/syncEngine.ts` (new), `web/src/main.ts` — sync-engine domain extraction, commit `baa1a5a`
- `web/.gitignore`, `web/scripts/spotify-import-report.json` (untracked, kept on disk), `README.md`, `web/src/main.ts`, `web/src/main.test.ts`, `web/src/backlog.test.ts` — stage-1 cleanup finish, commit `235c568`
- `HANDOFF.md` — this file

## Git state
- Branch: main
- Last commit: `235c568` chore(web): finish repo/docs cleanup stage
- Uncommitted changes: yes (`HANDOFF.md` only, about to be committed)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-19T20:54:52Z
