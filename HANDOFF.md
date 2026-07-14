# Handoff

## Current task
EP support in free-text search — **built, reviewed, merged to local `main`. Not yet pushed/deployed.**

## Status
`/api/search-album` now returns clean EPs (e.g. Pixies' "Come On Pilgrim") alongside clean albums, previously excluded entirely. Scope was deliberately narrow per Keith's calls during brainstorming: search only (artist-MBID bulk discovery via `discover-artist.ts` stays LP-only, untouched), clean EPs only (an EP still needs zero secondary-types — a "Live EP" or "Remix EP" stays excluded), no visual distinction once added (an EP renders and stores exactly like an album, no schema/type changes anywhere).

Full subagent-driven-development cycle: brainstormed → spec written (`docs/superpowers/specs/2026-07-14-ep-search-support-design.md`) → plan written (`docs/superpowers/plans/2026-07-14-ep-search-support.md`) → 2 tasks implemented by fresh Haiku subagents in an isolated worktree → each task reviewed clean by a Sonnet task reviewer → final whole-branch review by Opus (verdict: ready to merge, only two optional cosmetic notes) → merged locally, worktree and branch cleaned up. 250/250 tests pass on merged `main`.

## Next concrete step
**Push to origin and let Vercel deploy**, then have Keith search "Come On Pilgrim" (or any known EP) in the live app to confirm it surfaces. Local `main` is 6 commits ahead of `origin/main` — nothing has been pushed this session, so production still runs the pre-EP behavior.

## Don't forget
- Two Minor, non-blocking notes from the final review, left as-is per the reviewer's own recommendation ("no change required to merge"):
  - `isAlbumOrEpReleaseGroup` (`web/api/_lp.ts:19`) duplicates `isLpReleaseGroup`'s secondary-types rule rather than sharing it. Deliberate per the spec (sibling predicates, not a parameterized shared function) — but if the LP rule ever changes, the EP rule won't follow automatically. Only worth revisiting if the two rules need to diverge or converge later.
  - The predicate's test suite doesn't separately assert `Compilation`/`Broadcast` as *primary* types return false (only `Single` is tested as a non-Album/non-EP case) — immaterial since the predicate is a simple `===` check, `Single` already proves the branch.
- Everything else from the prior handoff (similarity-scores-skew-popular, artist locks paused, `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, RESTORE-POINT backup location, `keithrobrien`'s pre-existing `te-tokens.css` edit) still stands — nothing in this session touched those areas.

## Files touched this session
- `web/api/_lp.ts` — added `isAlbumOrEpReleaseGroup` predicate (sibling to unchanged `isLpReleaseGroup`).
- `web/api/_lp.test.ts` — 6 new test cases for the predicate.
- `web/api/search-album.ts` — swapped the filter from `isLpReleaseGroup` to `isAlbumOrEpReleaseGroup`.
- `web/api/search-album.test.ts` — new test proving a clean EP is admitted and a Live-secondary EP is still excluded.
- `docs/superpowers/specs/2026-07-14-ep-search-support-design.md`, `docs/superpowers/plans/2026-07-14-ep-search-support.md` — spec + plan.
- `HANDOFF.md` — this file, full rewrite.

## Git state
- Branch: `main`
- Last commit: `dc93e2f Merge branch 'worktree-ep-search-support'`
- Uncommitted changes: no (before this handoff commit)
- Stashed: no
- **6 commits ahead of `origin/main`, not pushed.**

## Reason for handoff
session paused

## Updated
2026-07-14T16:57:00Z
