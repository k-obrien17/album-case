# Handoff

## Current task
Simplify Album Case (clear state ownership, deduplicated ranking-action logic, targeted `rankList.ts` split) per the owner's revised 6-stage plan, ahead of a separate future multi-tenant project (a second person's own ranked list, explicitly out of scope for now).

## Status
Stages 1-6 of the simplify plan are complete, verified, and committed: repo/docs cleanup + sync-engine extraction, Playwright e2e harness, ranking-snapshot state ownership (`rankingStore.ts`), deduplicated ranking-action logic (`rankingActions.ts`), the MusicBrainz search UI split (`rankListSearch.ts`), and the drag mechanics split (`rankListDrag.ts`). Only the candidate/discovery ownership + bootstrap piece of that plan remains (see Next concrete step).

Stage 5's investigation found the search UI was the only one of `rankList.ts`'s four separable concerns with zero shared mutable state with the rest of the file, and flagged a "real circular dependency" between drag mechanics and `render()`. Stage 6 re-verified that claim directly (full-file read + grep of every call site of all 12 drag functions and the `drag` variable, cross-checked by a Plan agent) and found it wasn't a true circularity: `render()` is a hoisted function declaration, so it can be forward-referenced into the new module's deps exactly the way `showStatus` already is into `createSearchSection` -- no ordering hazard. `rankList.ts` is now 905 lines (down from 1319 at the start of the split). Row rendering's `editingOverallMbid`/`editingRatingMbid` bidirectional coupling is still deliberately left unextracted (see Don't forget).

**Full-repo code audit (2026-09-20), separate from the simplify plan above:** ran `/code-audit` across all 7 areas of the repo (`web/api`, `web/src` state+`main.ts`, `web/src/ui`, `web/src/ranking`/`rating`/`audio`/`data`, `web/scripts`+`web/e2e`+config, the legacy calibration tool + `scoring/` + `reference/`, and `pipeline/`+root scripts+`archive/`+misc), via 7 parallel subagents. Found 7 High-severity, ~20 Medium, ~10 Low findings, no Critical. Fixed and committed 2 of the 7 High findings so far:
- `9adfb1b` / `e2518bd` (see Git state) fixed: (1) `atoms.ts`'s `flushAtomQueue` was dropping roughly half of all pairwise-comparison atoms on a normal placement (stale captured queue snapshot never re-read from storage across the async fetch gap -- fixed with a reproducer test that fails on the old code); (2) `main.ts`'s `blockedArtists`/`curatedSkips` bypassed the pending-sync protection `ranked`/`lists`/`artistLocks` already had, plus a follow-up adding `curatedSkipsStorage.ts` (curatedSkips had zero local persistence before this) so a pending skip actually survives a reload.

**5 High findings from that audit are still open** (full detail, plus every Medium/Low finding, exists only in that session's conversation transcript, not saved to a file in this repo -- ask Keith if he wants a written report before starting on any of these, since none of it is otherwise recoverable):
1. Assisted this-or-that placement (`web/src/ui/rankList.ts:852-865`, `web/src/ranking/assist.ts:30-31,63-66`) freezes a snapshot of the ranked list at comparison-start; editing another row mid-comparison silently misplaces the candidate on finish. Fix: also invalidate `assist` in `render()` when the ranked array's length/version differs from what was captured at assist-start, not just on candidate change.
2. Ranked-row removal (`web/src/ui/rankList.ts:41-42,296-303`) is a single unconfirmed tap that also permanently blacklists the album from future candidacy, with no undo path anywhere in the app (`backup.ts`'s `parseRankingBackup` has zero production callers, only test callers).
3. Voice rating (`web/src/rating/parseSpokenRating.ts:45-49`) takes the *first* digit-form number match in a transcript instead of the *last* (the word-form fallback already takes the last); an incidental earlier in-range number silently commits the wrong rating with no confirmation step in `speedRound.ts`.
4. `reference/app.js:14-16` can't boot at all -- it fetches `artists.json`, which doesn't exist in `reference/`.
5. `web/scripts/backfill-ratings.mjs` overwrites every album's rating in production with no dry-run flag, no confirm gate, and no pre-write backup, unlike every sibling bulk-mutation script in that directory.

## Next concrete step
Open fork, not yet discussed with Keith: keep working through the audit's remaining 5 High findings (see Status), or switch back to candidate/discovery ownership + bootstrap (the last piece of the original 6-stage simplify plan). Ask before picking.

## Open questions
- Audit fixes vs. candidate/discovery ownership -- which next? Not discussed with Keith yet.
- Does Keith want the full audit report (all 7 High + ~20 Medium + ~10 Low findings, with evidence/verification detail) written to a file in this repo, since right now it only exists in one session's conversation history?

## Don't forget
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily keithrobrien.com refresh job) -- don't fold changes to it into this task's commits.
- Row rendering (`buildRow`/`buildOverallControl`/`buildRatingControl`) has genuine bidirectional coupling: `editingOverallMbid`/`editingRatingMbid` are cross-written (each control closes the other's editor) -- can't split those two functions apart without hoisting both variables into a shared state object.
- Candidate/discovery ownership + bootstrap will hit the same `main()` bootstrap interleaving that limited stages 1 and 3's extractions -- budget extra investigation time.
- The app's default view on boot is `'backlog'` ("Find missing albums"), not `'ranked'` -- every e2e spec has to click the "Ranked list" nav tab before interacting with the drag-to-place UI.
- The full governing 6-stage plan (owner's 6 numbered points + suggested stage sequence + success metric) is recorded in this repo's git history around commit `235c568` and earlier -- re-read via `git log -p -- HANDOFF.md` if a future session needs the full detail again.
- The audit's ~20 Medium / ~10 Low findings (sync-layer gaps, e2e never runs in CI, `web/api`/`web/scripts` excluded from `tsconfig.json`'s typecheck, several duplicated helpers, dead code) are unaddressed and, again, only documented in that session's conversation, not this repo.

## Git state
- Branch: main
- Last commit: `9adfb1b` fix(web): respect pending-sync for blockedArtists/curatedSkips (preceded by `e2518bd` fix(web): stop atom-queue flush from dropping concurrently-enqueued atoms)
- Uncommitted changes: no
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-20T02:35:00Z
