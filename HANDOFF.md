# Handoff

## Current task
Search (local filter + MusicBrainz fallback) and the bulk-add rating-floor fix. **Built, reviewed, merged to local `main` — but NOT pushed and NOT deployed.** That's the one thing left.

## Status
All 5 planned tasks are done, reviewed on opus, and merged. 226 tests pass, `tsc --noEmit` clean, `npm run build` clean. Production was verified untouched throughout (still 376 albums, no test data leaked).

What's merged locally but **not yet live**:
- **Search box on the ranked view.** Typing filters the 376-album list by title or artist (case-insensitive substring). Each filtered row keeps its working rating editor.
- **MusicBrainz fallback.** When nothing matches locally, an explicit "Search MusicBrainz" action hits a new read-only route (`GET /api/search-album?q=`). Pick a result, type a 0-10 rating, it's added to the ranked list immediately.
- **Bulk-add unblocked.** `web/scripts/import-album-canon.mjs`'s hardcoded 8.0 rating floor is now a `RATING_FLOOR` env var, **default 0**. The type/NaN/0-10 range check stays unconditional.

Four real bugs were caught in final review and fixed before merge: a stale MusicBrainz response could render under a newer query; the rank number showed the *filtered* index (an album at global #201 displayed "1"); a test claimed to guard the saved-list invariant but didn't actually (fixed by extracting a real exported `addSearchedAlbum` and verifying red-then-green); and the new public route needed a query length cap, edge caching, and a fetch timeout so abuse couldn't get the app's MusicBrainz User-Agent throttled (which would also degrade `/api/discover-artist` and the import script).

## Next concrete step
Push and deploy — this is the only thing standing between the merged work and it being usable:
```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case && git push origin main
cd web && vercel deploy --prod --yes
```
(Push is blocked for the agent by the repo's push-to-main guard; Keith runs it with a leading `!`. Deploy needs his explicit go-ahead.)

## Open questions
- Push + deploy the search work? (merged locally, 9 commits ahead of origin, nothing live yet)
- The `/collect/albums` page for **keithrobrien.com** is still built, merged locally, and **deliberately unpushed/undeployed** per Keith's "not until I say so." Its `albums.json` already carries the real post-canon ratings. That repo is 5 commits ahead of origin, waiting on his word.

## Don't forget
- **Check the search box on a phone the first time.** `render()` rebuilds the DOM on every keystroke, destroying and recreating the focused input. Focus/caret restoration is implemented and verified on desktop (it reads `document.activeElement` at the TOP of `render()`, before teardown — a blur-listener approach was tried first and was genuinely broken, only registering the first character). But iOS Safari can dismiss the on-screen keyboard when a focused input is replaced, and mobile is this project's primary device. If it flickers, the robust fix is to build the search box once and keep it OUT of the `container.textContent = ''` teardown, rebuilding only the list.
- **Bulk-adding albums needs no new build.** Make a CSV with columns `Ranking,Album,Artist,Year,Rating` and run:
  `CANON_CSV=~/path/to.csv CONFIRM_CANON_IMPORT=yes node --env-file=web/.env.local web/scripts/import-album-canon.mjs`
  It's incremental, not destructive: albums in the file are added or re-rated; anything not in the file is left untouched. Matches the local library first (free), only hits MusicBrainz for genuinely new albums, backs up first, reports what it couldn't match. Now accepts any 0-10 rating (use `RATING_FLOOR=8` to restore the old canon-import behavior).
- **NEVER set `CONFIRM_CANON_IMPORT` casually** — it replaces Keith's entire live ranking. Without it the script is a safe dry run.
- **RESTORE POINT** for the canon import: `web/scripts/backups/RESTORE-POINT-pre-canon-import.json` (244 albums, 14 locks, pre-import saved lists). Gitignored, local-only — do not delete. A restore POST must **omit** `base_updated_at` (the backup's value is pre-import; passing it would 409).
- **Artist locks are PAUSED**, not deleted. Not enforced, UI hidden, but all **14 locks are preserved untouched** in the snapshot and still round-trip through every save. Re-enable recipe is in a header comment in `web/src/ranking/locks.ts`. Do not re-introduce `nearestValidDropIndex` / `wouldViolateLock` / `getNearestValidDrop` anywhere.
- **`Number('') === 0`, and 0 is a legal rating.** Any new rating input MUST reject empty/whitespace before calling `Number()`. An empty field silently rating an album 0.00 was a real shipped-then-caught bug. Also set `form.noValidate = true` — native HTML5 validation silently blocks submit otherwise.
- **Never append-then-sort when inserting by rating.** Use the exported `insertAtRating` (remove-then-splice). Append-then-sort breaks on ties because a stable sort strands the album behind an equal-rated incumbent. Regression test: "splice at the computed index".
- Two non-blocking review findings were left unfixed by choice: the Lucene escaping in `search-album.ts` only handles `"` (a trailing backslash yields a misleading 502, no injection surface), and `SearchResultsState` is re-declared inline in `main.ts` instead of importing the one `rankList.ts` exports.
- A stale worktree from a much earlier session still exists: `.claude/worktrees/overall-rank-edit` (branch `worktree-overall-rank-edit`). Untouched for days; unclear if still wanted.

## Files touched this session
- `web/src/search.ts` + `web/src/search.test.ts` — new: the pure `filterAlbums<T extends Album>` filter.
- `web/api/search-album.ts` + `web/api/search-album.test.ts` — new: read-only MusicBrainz proxy route (exists server-side because the browser can't set the `User-Agent` MusicBrainz requires — same reason `discover-artist.ts` is a route).
- `web/src/ui/rankList.ts` — search input, filtered rendering, grip + candidate-card suppression while filtered, MusicBrainz results UI with a 0-10 rating input.
- `web/src/main.ts` — search state, the MusicBrainz fetch with a stale-response guard, and the new exported `addSearchedAlbum` (which removes the album from all three saved lists — the API rejects an album that's both ranked and saved).
- `web/src/main.test.ts` — real test of `addSearchedAlbum` (verified red-then-green).
- `web/src/style.css` — search box + results styling.
- `web/scripts/import-album-canon.mjs` — `RATING_FLOOR` parameter (default 0), validated.
- `docs/superpowers/specs/2026-07-13-search-and-bulk-add-design.md`, `docs/superpowers/plans/2026-07-13-search-and-bulk-add.md` — new spec + plan.

## Git state
- **album-case**: branch `main`, last commit `26ac0b3 fix(search): land final code review fixes for search branch`. Uncommitted: no. Stashed: no. **9 commits ahead of `origin/main` — unpushed, undeployed.**
- **keithrobrien**: branch `main`, **5 commits ahead of origin**, unpushed by design (the `/collect/albums` page is gated on Keith's say-so). One pre-existing uncommitted file (`app/te-tokens.css`) — not mine, left alone.

## Reason for handoff
session paused

## Updated
2026-07-13T17:40:17Z
