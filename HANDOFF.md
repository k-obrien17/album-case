# Handoff

## Current task
Close the last 2 Highs from the 2026-08-25 ship-check backlog: unit-test the
sync/conflict-resolution state machine, and add a delete affordance on saved
lists.

## Status
Done, committed, and deployed to production.

- **Sync state machine**: extracted `performRankingSync` as a top-level,
  dependency-injectable async function in `web/src/main.ts` (mirrors the
  existing `resolveInitialState`/`restoreFromCode` testable-export pattern).
  `syncRankingSnapshot` is now a thin wrapper that calls it and applies the
  result to closure state. Added 6 unit tests in `web/src/main.test.ts`
  covering: success, 409-conflict-refetch, two-tab-race, first-ever-save
  (missing snapshot), refetch failure, and the error-vs-conflict distinction
  (a plain save error leaves the base version unchanged; a conflict clears it
  to force a refetch).
- **Saved-list Remove**: added a "Remove" button next to "Mark as heard" on
  Want to listen / Haven't heard / Don't care rows (`web/src/ui/savedList.ts`
  + `.saved-remove` in `style.css`). Wired to a new `removeFromSavedList` in
  `main.ts` that reuses the existing `skippedAlbums` persistent-exclusion set
  (already used by `reselectCandidate`) so a removed album never resurfaces
  as a ranking candidate -- unlike "Mark as heard", which intentionally
  re-queues it.

Typecheck clean, build clean, 312/312 tests passing (306 + 6 new). Manually
verified in a browser (`npm run dev`): added an album to Don't care, clicked
Remove, confirmed the row disappeared and the album did NOT reappear as the
next ranking candidate; separately confirmed Mark as heard still works
unchanged (regression check).

Committed as `915b2eb`. Deployed via `vercel deploy --prod --yes` from
`web/`; production bundle hash (`assets/index-C90-0qdq.js`) confirmed to
match the local build via `curl -s https://album-case.vercel.app/`.

## Next concrete step
The ship-check backlog's 10 Mediums are still untriaged. Full report at
`~/.claude/ship-check-reports/2026-08-25-1245-album-case.md`. Also still
open from the original 5 Highs (explicitly deferred, not part of this
session's 2): confirm/undo on the ranked-row "×" remove button, primary
comparison card buried below nav chrome, unvirtualized 769-row ranked list.

## Don't forget
- This project's standing check going forward is `/regression-smoke`, not a
  full `/ship-check`.
- Write-key enforcement (`ALBUM_CASE_WRITE_KEY`) stays dropped. One-function
  revert if that changes: `requireWriteKey()` in `web/api/_writeKey.ts`.
- Past incident (an earlier session): an audit subagent wrote a real test
  rating to production data without authorization; self-reported, reverted,
  independently verified clean. Scope any future audit subagents to
  read-only explicitly, and be cautious about live-testing against
  production Turso data.
- 13 commits ahead of `origin/main`, not pushed (not asked to this session --
  this repo doesn't auto-deploy from git anyway; `vercel deploy --prod --yes`
  from `web/` is the actual deploy step and WAS run this session, so
  production is current with `main` regardless of the push status).

## Files touched this session
- `web/src/main.ts` -- new exported `performRankingSync` (+ `SyncSnapshotInput`/
  `SyncSnapshotResult`/`SyncSnapshotDeps` types); `syncRankingSnapshot` rewired
  to call it; new `removeFromSavedList`; `renderCurrentSavedList` passes the
  new `onRemove` callback.
- `web/src/main.test.ts` -- 6 new tests under `describe('performRankingSync ...')`.
- `web/src/ui/savedList.ts` -- `renderSavedList` takes a new `onRemove` param;
  renders a "Remove" button per row.
- `web/src/style.css` -- new `.saved-remove` / `.saved-remove:hover` (mirrors
  `.saved-mark`).

## Git state
- Branch: main
- Last commit: 915b2eb fix(web): add saved-list remove affordance, test sync state machine
- Uncommitted changes: no (this session's work is committed)
- Untracked: pre-existing scratch files from an earlier session's ship-check
  visual audit (`.playwright-mcp/`, `ac-*.png`), left alone -- not part of
  this session
- Pushed to origin: no, 13 commits ahead of origin/main
- Deployed to production: yes, this session, bundle hash verified
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-26T14:10:00Z
