# Handoff

## Current task
Rating sessions write to production immediately (standing OK from Keith, 2026-11-21). Curated list header is deployed and verified.

## Status
- Production serves `index-CT3EKKos.js` (includes `0baf7cf` curated list header). Checked live at 390px/1280px: Recently ranked, Curated lists (Spin 300 only), collapsed Already ranked, Want to listen. No console errors. Everything is pushed (`4401fe9` on origin).
- Live counts after this session's ratings: 992 ranked / 111 want / 61 notHeard / 43 dontCare / 6 blocked.
- Written this session (read back): Beck (Odelay re-rated 9.38, Mellow Gold 8.78, Mutations 8.69, Midnite Vultures 8.99, Sea Change 9.27, Guero 8.87); The Prodigy (Experience 8.88, Jilted Generation 8.92, Fat of the Land 9.15); Boards of Canada (Music Has the Right to Children re-rated 9.41, Geogaddi 9.19, Tomorrow's Harvest 9.03; Campfire Headphase + Inferno to Want to listen); Justice (cross 9.66, Audio Video Disco 9.53; Woman + Hyperdrama to Want to listen).
- Skipped for now by Keith: Beck's The Information, Modern Guilt, Colors, Hyperspace, Ride Lonesome, One Foot in the Grave, Stereopathetic Soulmanure; Prodigy's Always Outnumbered, Invaders Must Die, The Day Is My Enemy, No Tourists. Autechre has only Amber in the catalog (others need discovery by artist MBID).
- Running tally: `~/Desktop/album-case-beck-tally-2026-11-21.md`. Backups: `~/Desktop/album-case-server-before-{beck,prodigy,boc,boc-want,justice,justice-want}-*.json`.
- Ratings live in Turso, not git; only HANDOFF.md changes are committed.

## Next concrete step
Rate Aphex Twin (offered to Keith, awaiting ratings): ...I Care Because You Do, Drukqs, Syro, Melodies From Mars. Alternative: Röyksopp.

## Don't forget
- Write each rating to production as Keith gives it: back up, fresh fetch, `insertAtRating` splice, assert no mbid in both ranked and any list (backlog is an object: use `allSavedAlbums`), POST with `base_updated_at`, read back. Run scripts via `web/node_modules/.bin/vite-node --root web` (extensionless imports). Save a running tally to a file, never only in chat. Rating queue continues with Aphex Twin, then others. Scripts for the pattern are ad hoc in the session scratchpad; a rated album found in a saved list must be stripped via `removeFromAllLists` before the POST.
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
