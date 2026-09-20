# Handoff

## Current task
Fixing findings from full-repo audits. Picked up the prior session's 5 remaining High findings from an earlier `/code-audit`, fixed all 5, then ran a fresh full-repo `/code-audit` (8 parallel subagents) which surfaced a much larger and more precise list: 1 Critical, 7 High, 20 Medium, 16 Low. Fixed the Critical and all 7 new High findings. The 20 Medium / 16 Low findings are still open.

The other outstanding thread from before (candidate/discovery ownership + bootstrap, the last piece of the 6-stage simplify plan) has not been touched this session.

## Status
All fixes below are individually verified (reproduced before the fix where the layer supports it, confirmed passing after) and covered by the full verification suite: `tsc` clean (now including `web/api`, previously excluded), 348/348 vitest unit tests, 11/11 Playwright e2e specs, 48/48 pytest (13 legacy + 35 pipeline). Working tree has uncommitted changes -- nothing has been committed this session.

**Fixed (prior session's 5 High findings, from the earlier audit):**
1. Assisted-placement staleness (`web/src/ui/rankList.ts`) -- extracted `assistNeedsRestart()`, now also invalidates on ranked-list mutation, not just candidate change.
2. Ranked-row removal had no confirmation/recovery (`rankList.ts`) -- added `window.confirm` + a status message pointing to "Don't care."
3. Voice-rating digit-form parser took the first match instead of the last (`parseSpokenRating.ts`) -- now takes the last.
4. `reference/app.js` fetched a nonexistent `artists.json` -- pointed at root's canonical file (later superseded by the file:// fix below).
5. `backfill-ratings.mjs` had no dry-run/backup/confirm gate -- now matches `import-album-canon.mjs`'s convention (`CONFIRM_RATING_BACKFILL=yes`, pre-write backup to `web/scripts/backups/`).

**Fixed (this session's fresh audit -- Critical + all 7 High):**
1. **[Critical]** Saved-list "Remove" (`web/src/ui/savedList.ts`) had no confirmation and no recovery path at all (worse than #2 above -- no "Don't care" landing spot). Added `window.confirm` with an honest "can't be undone" message.
2. **[High]** `parseSpokenRating.ts`'s "point" branch absorbed unrelated later numbers in the sentence into the decimal (`"seven point six I've heard this nine times"` -> `7.69` instead of `7.6`). Now stops at the first non-digit-word after "point."
3. **[High]** Artist-batch view's async discovery (`artistBatchView.ts`) fired `render()` after the user navigated away, silently clobbering whatever view they'd moved to. Added an `active` flag, same pattern as `speedRound.ts`.
4. **[High]** Corrupted localStorage value (`artistBlocks.ts`'s `loadBlockedArtists`) crashed the core candidate-selection path -- valid-JSON-but-wrong-shape values (e.g. `"null"`) threw downstream. Added an `Array.isArray` guard.
5. **[High]** `web/api` and `web/scripts` shipped with zero typecheck coverage. Added `"api"` (and `"scripts"`, currently a no-op since it's all `.mjs`) to `web/tsconfig.json`'s `include`. Confirmed real by deliberately introducing and catching a type error, then reverting.
6. **[High]** E2E specs never ran in CI. Added a Playwright install + `npm run e2e` step to `.github/workflows/ci.yml`.
7. **[High]** `reference/app.js`'s `fetch()` of `artists.json` is blocked by Chrome's file:// CORS policy (confirmed with a real headless Playwright browser, not the sandboxed Chrome-extension tool). Switched to reading `window.CALIBRATION_ARTISTS` via a `<script src="../artists.js">` tag in `reference/index.html`, same pattern root's `app.js` already uses.
8. **[High]** MusicBrainz staging load (`pipeline/ingest_musicbrainz.py`) loaded its 4 tables in 4 separate transactions -- a mid-load failure left some tables holding the new run's data and others holding the previous run's, undetectable by `materialize.py`. Reproduced (mixed state after a simulated missing-file failure), then wrapped all 4 loads in one explicit `BEGIN`/`COMMIT`/`ROLLBACK` transaction. Verified: after the fix, a failure fully rolls back to the pre-call state.

**Not fixed, still open:** 20 Medium + 16 Low findings, full detail in `CODE-AUDIT-2026-09-20.md` at the repo root (this is the first time an audit report has been persisted to a file instead of living only in session history -- HANDOFF.md flagged this as unresolved for two sessions running).

## Next concrete step
Ask Keith: continue into the 20 Medium / 16 Low findings (`CODE-AUDIT-2026-09-20.md`), or switch to candidate/discovery ownership + bootstrap (the last piece of the simplify plan, untouched all session)? Nothing has been committed yet either -- that's also a decision point (commit now vs. keep going first).

## Open questions
- Commit this session's work now, or keep going into Medium/Low first?
- Medium/Low findings vs. the simplify plan's last piece -- which next?

## Don't forget
- Nothing has been committed this session -- nine modified files plus five new files (see Git state below) are all still working-tree changes.
- `CODE-AUDIT-2026-09-20.md` is the full findings detail; the 20 Medium / 16 Low sections there are unfixed and current as of this write.
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (unrelated daily job) -- don't fold changes into unrelated commits.
- App boots to `'backlog'` view by default, not `'ranked'` -- e2e specs must click "Ranked list" nav tab first; saved-list specs must open the "More" `<summary>` (`.nav-more summary`, not a `button` role) then scope the target button to `.nav-more-items` (the same-named button also exists in the backlog view).
- `web/tsconfig.json` now includes `api` and `scripts` -- both typecheck clean today, but a future `web/api` change that breaks typecheck will now be caught (it wasn't before).
- `reference/` now depends on `../artists.js` being present (loaded via `<script>` in `reference/index.html`) -- it will not boot if that file is deleted or moved without updating the reference.
- Candidate/discovery ownership + bootstrap will hit the same `main()` interleaving that limited stages 1 and 3 of the simplify plan (per the prior session's note, unverified this session).

## Files touched this session
- web/src/ui/rankList.ts -- assist-restart fix, remove-confirm fix (both from the prior audit's High findings)
- web/src/ui/rankList.assist.test.ts -- new, tests `assistNeedsRestart`
- web/src/rating/parseSpokenRating.ts -- digit-form last-match fix, "point"-branch contiguous-run fix
- web/src/rating/parseSpokenRating.test.ts -- new tests for both
- reference/app.js -- reads `window.CALIBRATION_ARTISTS` instead of fetch
- reference/index.html -- loads `../artists.js` before `app.js`
- web/scripts/backfill-ratings.mjs -- dry-run/backup/confirm gate added
- web/src/ui/savedList.ts -- remove-confirm added
- web/src/ui/artistBatchView.ts -- `active` flag guards post-await `render()`
- web/src/artistBlocks.ts -- `Array.isArray` guard in `loadBlockedArtists`
- web/src/artistBlocks.test.ts -- new test for the guard
- web/tsconfig.json -- `include` widened to `api` + `scripts`
- .github/workflows/ci.yml -- added Playwright install + e2e step
- pipeline/ingest_musicbrainz.py -- 4-table staging load wrapped in one transaction
- web/e2e/remove-confirm.spec.ts -- new
- web/e2e/saved-list-remove-confirm.spec.ts -- new
- web/e2e/artist-batch-stale-discover.spec.ts -- new
- CODE-AUDIT-2026-09-20.md -- new, full audit report (1 Critical + 7 High marked `[FIXED]`, 20 Medium + 16 Low still open)
- HANDOFF.md -- rewritten to reflect current state

## Git state
- Branch: main
- Last commit: `a513ef6` chore: update handoff
- Uncommitted changes: yes (13 modified, 5 new -- see Files touched above; nothing staged or committed)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-20T15:47:00Z
