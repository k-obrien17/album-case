# Handoff

## Current task
Curated list header is built but not deployed. Rating sessions write to production immediately (standing OK from Keith, 2026-11-21).

## Status
- Production serves `index-Bq_V9xb0.js` (`c517c7b`): `rated_at` on ranked albums, More > Recently ranked, real source URLs on Indie Rock 100 and Spin 300.
- Committed, NOT deployed: `0baf7cf` curated list header (dropdown picker, "N ranked · M to go · K skipped or hidden" line with progress bar, Source link, collapsed "Already ranked (N)" with your ratings). tsc clean, 480 tests pass, checked at 390/900/1280 against a read-only copy of live data (Spin 300 only). Row buttons unchanged.
- Local commits `18a8a94`, `301dad7`, `0baf7cf` are not pushed (Keith runs `! git push origin main`).
- Batch 2 is written (2026-11-21). Live counts: 980 ranked / 108 want / 61 notHeard / 43 dontCare / 6 blocked. Only batch 2's 19 albums have a `rated_at`; older ones have no date. Decisions applied: Trans Europa Express 9.33, Deftones blocked, The Verve's A Storm in Heaven in Don't care (album only), minor Nas albums not wanted.
- Backups on `~/Desktop`: `album-case-server-before-batch2-2026-11-21.json`, `album-case-server-before-batch2-write-1795129721828.json`, `album-case-server-before-decisions-1795129721828.json`. Plan file: `album-case-batch2-plan-2026-11-21.json`.
- Recently ranked view has not been opened in a browser on production.

## Next concrete step
Ask Keith to OK `vercel deploy --prod --yes` from `web/`, verify the live bundle hash matches the local build, then open More > Recently ranked and Curated lists on production and check them.

## Don't forget
- Write each rating to production as Keith gives it: back up, fresh fetch, `insertAtRating` splice, assert no mbid in both ranked and any list (backlog is an object: use `allSavedAlbums`), POST with `base_updated_at`, read back. Run scripts via `web/node_modules/.bin/vite-node --root web` (extensionless imports). Save a running tally to a file, never only in chat. Rating queue continues with Beck, Prodigy, Autechre, Boards of Canada and others.
- Do NOT run `web/scripts/resolve-curated-list-mbids.mjs --write` (rewrites older lists; privacy hook blocks it).
- Filter rule: skip artists already in wantToListen/notHeard/dontCare/blocked_artists when recommending.
- Keith still needs to re-hide hidden artists/curated entries made since Nov 8, plus Sam Smith and Christina Aguilera albums.
- Spin 300 notes: rank 296 "Total 4" matched by title only; mixtapes/EP/live/compilations kept on purpose. Stereolab "Switched On" resolved to the 1992 compilation; Yeah Yeah Yeahs to the 2002 EP.
- Optional UX follow-up: move "No more X" into an overflow on curated rows; bundle is 465 kB because list data ships in main JS (consider lazy-loading).
- Check the Want to listen view after the `.saved-meta` CSS change.
- Still open: UX-teardown slices 5-6, gap-bonus shrinkage in `suggestions.ts`, splitting `main.ts`, CSP, friend accounts, virtualizing the 112,000px list.
- Hooks: the pre-commit hook rejects compound `git add && git commit`; run them as separate Bash calls.

## Files touched this session
- `web/src/curatedListMatch.ts`, `web/src/ui/curatedListView.ts`, `web/src/ui/curatedListView.test.ts`, `web/src/main.ts`, `web/src/style.css`: curated list header (committed)
- `web/src/recentlyRanked.ts` (+ test), `web/src/rankingActions.ts`, `web/src/album.ts`, `web/api/ranking.ts`, `web/src/ranking/types.ts`: `rated_at` and Recently ranked (committed, deployed)
- `web/src/data/curatedLists.ts`: real source URLs (committed, deployed)

## Git state
- Branch: main, 3 commits ahead of origin
- Last commit: 0baf7cf feat(curated): list header with progress, source link, dropdown picker and collapsed Already ranked
- Uncommitted changes: only untracked `.playwright-mcp/` (pre-existing, leave out); HANDOFF.md once committed
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-11-21T15:11:18Z
