# Handoff

## Current task
Rating sessions: ratings go to production immediately (standing OK from Keith, 2026-11-21). Recently ranked view shipped.

## Status
- Live 2026-11-21: bundle `index-Bq_V9xb0.js` (`c517c7b`: `rated_at` on ranked albums + More > Recently ranked; real source URLs on Indie Rock 100 and Spin 300). Pushed to origin/main through `c517c7b`.
- Batch 2 written to production 2026-11-21: 18 new ratings, Pharcyde 9.04, 4 moved out of wantToListen, 37 wants added. Live counts: 980 ranked / 108 want / 61 notHeard / 43 dontCare / 6 blocked artists. Only these 19 albums have a `rated_at`; the older ones have no date and cannot get one.
- Backups: `~/Desktop/album-case-server-before-batch2-2026-11-21.json` and `~/Desktop/album-case-server-before-batch2-write-1795129721828.json`. Plan file: `~/Desktop/album-case-batch2-plan-2026-11-21.json`.
- Not yet opened in a browser: the Recently ranked view (row styling reuses saved-list CSS).
- Do NOT run `web/scripts/resolve-curated-list-mbids.mjs --write` (rewrites older lists; privacy hook blocks it).

## Next concrete step
Open More > Recently ranked on production and check the row styling. Then build the curated list header (compact picker, source link, "N ranked, M to go", collapsed "Already ranked").

## Open questions
None. Resolved 2026-11-21: Trans Europa Express 9.33, Deftones blocked, The Verve's A Storm in Heaven in Don't care (album only, not the artist), minor Nas albums not wanted. Rating queue continues with Beck, Prodigy, Autechre, Boards of Canada and others.

## Don't forget
- Write each rating to production as Keith gives it: back up, fresh fetch, `insertAtRating` splice, assert no mbid in both ranked and any list (backlog is an object: use `allSavedAlbums`), POST with `base_updated_at`, read back. Run scripts via `web/node_modules/.bin/vite-node --root web` (extensionless imports). Save a running tally to a file, never only in chat.
- Filter rule: skip artists already in wantToListen/notHeard/dontCare/blocked_artists when recommending.
- Keith still needs to re-hide hidden artists/curated entries made since Nov 8, plus Sam Smith and Christina Aguilera albums.
- Spin 300 notes: rank 296 "Total 4" matched by title only; mixtapes/EP/live/compilations kept on purpose. Stereolab "Switched On" resolved to the 1992 compilation; Yeah Yeah Yeahs to the 2002 EP.
- Bundle is 465 kB (121 kB gzip) because curated list data ships in main JS; consider lazy-loading.
- Check the Want to listen view after the `.saved-meta` CSS change.
- Still open: UX-teardown slices 5-6, gap-bonus shrinkage in `suggestions.ts`, splitting `main.ts`, CSP, friend accounts, virtualizing the 112,000px list.

## Files touched this session
- `web/src/recentlyRanked.ts`, `web/src/main.ts`, `web/src/rankingActions.ts`, `web/src/album.ts`, `web/api/ranking.ts`, `web/src/ranking/types.ts`: `rated_at` and Recently ranked view (committed)
- `web/src/data/curatedLists.ts`: real source URLs (committed)

## Git state
- Branch: main, in sync with origin through `c517c7b`; deployed at `c517c7b`
- Uncommitted: only untracked `.playwright-mcp/` (pre-existing, leave out); this file once committed
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-11-21
