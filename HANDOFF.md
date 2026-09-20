# Handoff

## Current task
Two active threads, neither in progress right now: (1) the owner's 6-stage Album Case simplify plan (5 of 6 stages done, one piece left), and (2) fixing High-severity findings from a full-repo `/code-audit` run this session.

## Status
Simplify plan: stages 1-6 done and committed; only candidate/discovery ownership + bootstrap remains, not started. Code audit: ran across all 7 areas of the repo via parallel subagents, found 7 High / ~20 Medium / ~10 Low findings, no Critical. Fixed and committed 2 of 7 High findings (atom-queue race in `atoms.ts`; pending-sync gate for `blockedArtists`/`curatedSkips` in `main.ts` plus a `curatedSkipsStorage.ts` persistence follow-up). Working tree is clean; both fixes verified (build + 341 unit tests + 6 e2e specs passing).

## Next concrete step
Ask Keith which to pick up: (a) the remaining 5 High audit findings (listed below), or (b) candidate/discovery ownership + bootstrap, the last piece of the simplify plan. This fork was already flagged in the prior handoff and still hasn't been decided.

## Open questions
- Audit fixes vs. candidate/discovery ownership -- which next?
- Does Keith want the full audit report (all 7 High + ~20 Medium + ~10 Low findings, with evidence/verification detail) written to a file in this repo? Right now it exists only in this session's conversation history and is unrecoverable once the session ends.

## Don't forget
- 5 High audit findings still open:
  1. Assisted placement (`web/src/ui/rankList.ts:852-865`, `web/src/ranking/assist.ts:30-31,63-66`) freezes a ranked-list snapshot at comparison-start; editing another row mid-comparison silently misplaces the candidate. Fix: invalidate `assist` in `render()` on a list-length/version change, not just a candidate change.
  2. Ranked-row removal (`rankList.ts:41-42,296-303`) is a single unconfirmed tap that also permanently blacklists the album, with no undo path anywhere (`backup.ts`'s `parseRankingBackup` has zero production callers).
  3. Voice rating (`web/src/rating/parseSpokenRating.ts:45-49`) takes the first digit-form match instead of the last; an earlier incidental number silently commits the wrong rating with no confirmation step.
  4. `reference/app.js:14-16` can't boot -- fetches `artists.json`, which doesn't exist in `reference/`.
  5. `web/scripts/backfill-ratings.mjs` overwrites production ratings with no dry-run/confirm/backup, unlike its sibling scripts.
- ~20 Medium / ~10 Low audit findings are also unaddressed (sync-layer gaps, e2e never runs in CI, `web/api`/`web/scripts` excluded from `tsconfig.json`'s typecheck, duplicated helpers, dead code) -- detail lives only in this session's conversation.
- `web/scripts/refresh-keithrobrien-collect.mjs` is tracked (commit `4f17298`, unrelated daily job) -- don't fold changes into unrelated commits.
- Row rendering (`buildRow`/`buildOverallControl`/`buildRatingControl`) has genuine bidirectional coupling (`editingOverallMbid`/`editingRatingMbid` cross-write each other) -- can't split without hoisting both into shared state.
- Candidate/discovery ownership + bootstrap will hit the same `main()` interleaving that limited stages 1 and 3 of the simplify plan.
- App boots to `'backlog'` view by default, not `'ranked'` -- e2e specs must click "Ranked list" nav tab first.

## Files touched this session
- web/src/ui/rankList.ts -- extracted drag mechanics out into rankListDrag.ts
- web/src/ui/rankListDrag.ts -- new, drag-to-place/reorder controller
- web/src/atoms.ts -- fixed `flushAtomQueue`'s stale-queue race
- web/src/atoms.test.ts -- added reproducer test
- web/src/main.ts -- gated `blockedArtists`/`curatedSkips` on `pendingSync`; load curated skips locally
- web/src/syncEngine.ts -- persist curated skips locally on write and on conflict-reload
- web/src/curatedSkipsStorage.ts -- new, local persistence for curated skips
- web/src/curatedSkipsStorage.test.ts -- new
- HANDOFF.md -- rewritten to reflect current state

## Git state
- Branch: main
- Last commit: `1fe3323` chore: update handoff
- Uncommitted changes: no
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-20T02:38:59Z
