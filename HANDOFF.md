# Handoff

## Current task
Just finished brainstorming a **search feature** (design agreed, not yet spec'd or built). Everything before it — the rating-primary architecture pivot, the 396-album canon import, editable ratings, and pausing artist locks — is **built, merged, deployed, and live**.

## Status
Album Case is live at https://album-case.vercel.app with **376 ranked albums**, all rated 8.0–10.0, sorted by rating. Everything below shipped this session and is verified against production. No known bugs, no half-finished work, working tree clean.

What shipped:
- **Rating is now the primary organizing value.** An album's position is derived from its rating (list is always rating-sorted descending), not from array position. `RankedAlbum = Album & { rating: number }` — kept as a *separate* type from plain `Album`, because the seed pool and discovery pipeline legitimately have no rating.
- **The 396-album canon import ran successfully.** Keith's 244 existing albums were re-rated from a ChatGPT-generated CSV and ~132 new albums added. 20 CSV rows couldn't be matched to MusicBrainz and were skipped (reported by name). 2 albums (Untrue/Burial, Things Fall Apart/The Roots) were promoted out of "Haven't heard" into the ranked list, per Keith's explicit call.
- **Ratings are directly editable.** Tap any row's rating → type a new number → the album re-sorts. Range is **0–10** (widened from 1–10 at Keith's request; the 8.0 floor was import-only).
- **Artist locks are PAUSED.** Not enforced anywhere, UI hidden — but the **14 real locks are preserved untouched** in the snapshot and still round-trip through every save. Fully reversible; a re-enable recipe is documented in a header comment in `web/src/ranking/locks.ts`. `locks.ts`, its tests, and `artistLockView.ts` are all intact on disk (dead-but-preserved, they tree-shake out).
- **The site export now publishes real ratings**, not a score re-derived from rank position (it was inventing numbers that drifted — publishing 9.98 for an album actually rated 9.99).

## Next concrete step
Write the spec for the search feature (design already agreed with Keith — see below), then build it. Keith had just been asked "does this match what you're picturing?" and had not yet answered when the session paused, so **confirm the design before writing the spec**.

Agreed search design (one box, two modes, no mode switch):
- Type → live-filters the 376 ranked albums by title **and** artist; results show rank + rating.
- Tap a result → jumps to that album in the list, ready to edit its rating.
- Nothing matches → a "Search MusicBrainz for *[query]*" option appears. Pick a result, type a rating, it's ranked immediately.
- Local filtering is instant (list is already in memory). The MusicBrainz call only fires when explicitly asked for — never on every keystroke.
- Reuses existing machinery: the MusicBrainz release-group search + `isLpReleaseGroup` studio-LP filter from `web/scripts/lib/canon-import.mjs`, and the rating input from `buildRatingControl` in `web/src/ui/rankList.ts`.

## Open questions
- Confirm the search design above before spec'ing it (Keith hadn't answered yet).
- **Bulk-add blocker:** `web/scripts/import-album-canon.mjs` hard-aborts on any rating below 8.0. That guard was correct for the canon import but is now wrong — ratings run 0–10. It must become a parameter (default off) before Keith can bulk-add a CSV containing anything under 8. Nothing else about bulk-add needs building (see below).
- The `/collect/albums` page for keithrobrien.com is built, merged locally, and **deliberately unpushed/undeployed** per Keith's "not until I say so." Its `albums.json` is already refreshed with the real post-canon ratings. `keithrobrien` main is 5 commits ahead of origin, waiting on his word.

## Don't forget
- **Bulk-adding albums already works** — no new build needed. Make a CSV with the same 5 columns (`Ranking,Album,Artist,Year,Rating`) and run:
  `CANON_CSV=~/path/to.csv CONFIRM_CANON_IMPORT=yes node --env-file=web/.env.local web/scripts/import-album-canon.mjs`
  It's incremental, not destructive: albums in the file are added or re-rated; anything *not* in the file is left untouched. It matches the local library first (free), only hits MusicBrainz for genuinely new albums, backs up first, and reports what it couldn't match. Only the 8.0 floor (above) blocks it.
- **RESTORE POINT** for the canon import: `web/scripts/backups/RESTORE-POINT-pre-canon-import.json` (244 albums, 14 locks, the pre-import saved lists). Gitignored, so it's local-only — do not delete it. A restore POST must **omit** `base_updated_at` (the backup's value is the pre-import one; passing it would 409).
- `web/scripts/backups/` and `canon-import-report.json` are gitignored (they contain personal ranking data). Never commit them.
- The rating floor guard in the import script is import-specific and is the *only* remaining 8.0 constraint. The app itself allows 0–10 everywhere.
- `ALBUM_CASE_WRITE_KEY` was **rotated** this session (the old one was a Vercel Sensitive var and unreadable by anyone, including Keith). The new value is in `web/.env.local` and in Vercel Production + Preview. Not stored anywhere else.
- An unrelated, pre-existing uncommitted edit sits in `keithrobrien`'s `app/te-tokens.css` — not mine, left alone.
- Beware: `Number('') === 0`. Now that 0 is a legal rating, any new numeric rating input must reject empty/whitespace explicitly — an empty field silently rating an album 0.00 was a real bug caught in review this session.

## Files touched this session
Far too many to list individually (rating pivot + canon import + editable ratings + paused locks). The load-bearing ones:
- `web/src/ranking/types.ts` — added `RankedAlbum`; `RankingState.ranked` is now `RankedAlbum[]`.
- `web/src/ranking/rating.ts` — `ratingForDropIndex` (interpolation); floor clamp is now 0.
- `web/src/main.ts` — exported `reRate`, `insertAtRating`, `setRating`; all placement/reorder handlers compute ratings instead of splicing positions; lock enforcement removed.
- `web/src/ui/rankList.ts` — `buildRatingControl` (the new tap-to-edit rating); direct-rate candidate input; lock UI removed.
- `web/src/ranking/locks.ts` — untouched functionally, but carries the PAUSED header comment + re-enable recipe.
- `web/api/ranking.ts`, `web/src/album.ts`, `web/src/rankingSync.ts`, `web/src/backup.ts` — ranked-specific parsing that requires a rating (kept separate from plain `parseAlbum`, which still serves pool/lists/discovery).
- `web/scripts/import-album-canon.mjs` + `web/scripts/lib/canon-import.mjs` (+ tests) — the canon importer.
- `web/scripts/backfill-ratings.mjs` — one-time backfill (already run; don't re-run).
- `web/scripts/export-collect-albums.mjs` — now publishes real ratings.

## Git state
- **album-case**: branch `main`, last commit `12a691c fix(rank-list): close the sibling editor, correct the stale 0-10 comment`. Uncommitted: no. Stashed: no. **In sync with origin/main** (pushed and deployed).
- **keithrobrien**: branch `main`, **5 commits ahead of origin**, unpushed by design (the `/collect/albums` page is gated on Keith's say-so). One pre-existing uncommitted file (`app/te-tokens.css`, not mine).
- 214 tests pass, `tsc --noEmit` clean, `npm run build` clean.
- One stale worktree remains from a much earlier session: `.claude/worktrees/overall-rank-edit` (branch `worktree-overall-rank-edit`). Untouched all session; unclear if still wanted.

## Reason for handoff
session paused

## Updated
2026-07-13T16:35:24Z
