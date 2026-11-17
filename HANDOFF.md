# Handoff

## Current task
Curated lists: Pitchfork Indie Rock 100 and Spin 300 are both shipped. Waiting on Keith for source URLs and which UX fixes to do next.

## Status
- Deployed 2026-11-17: `f5bf572` (Indie Rock 100), `6368963` (curated rows no longer collapse at 900px+ or overflow at 390px), `aec15dd` (Spin 300, 300 entries all resolved). Live bundle `index-DeNDMSbs.js`. 9 local commits, NOT pushed.
- Spin 300 notes: rank 164 "janet." fixed to the 1993 album (`785e1f49`); rank 296 "Total 4" is a 2002 compilation matched by title only (unverified); mixtapes (nostalgia ULTRA, Da Drought 3, Acid Rap, House of Balloons), the Fame Monster EP, MTV Unplugged (live), The Singles and 3 Various Artists compilations are kept as resolved on purpose; Kanye albums carry artist name "Ye" on the resolved record.
- Bundle grew from 360 kB to 464 kB (gzip 95 to 121 kB) because curated list data ships in the main JS. Consider lazy-loading `curatedLists.ts` if it grows further.
- Do NOT run `web/scripts/resolve-curated-list-mbids.mjs --write`. A full run rewrote older lists and dropped existing resolutions (reverted once), and the privacy hook blocks it (its user agent holds Keith's email). Scoped resolvers used this session (`resolve-spin.mjs`, `resolve-spin2.mjs`, `build-spin.mjs`) live in session e685fbf8's scratchpad and may be gone; MusicBrainz drops connections after a few hundred requests at 1/sec, so use 2.5s spacing and retry on network errors.

## Next concrete step
Ask Keith for the real source URLs (Pitchfork Indie Rock 100, Spin 300), then replace the two placeholder `source` values in `curatedLists.ts` and redeploy.

## Open questions
- Real source URLs for the Indie Rock 100 (placeholder `https://pitchfork.com/`) and Spin 300 (placeholder `https://www.spin.com/`).
- Apply the other curated-list UX findings (picker header + source link, collapsed "Already ranked", move "No more X" into an overflow)? Report was given in chat, nothing implemented beyond the CSS fix.
- Push the 7 local commits? Needs Keith's say-so.
- Earlier: Deftones mark Not interested or skip only White Pony; minor Nas albums; Trans-Europe Express 9.03 in app vs 9.33 told in chat.

## Don't forget
- Rating session, batch 2 is collected but NOT written to production; Keith has not said "write it". Details: 18 new ratings, Pharcyde re-rate to 9.04, remove 4 now-ranked albums from wantToListen, add 37 wants. Procedure: back up live to `~/Desktop/album-case-server-before-batch2-2026-11-15.json`, re-fetch fresh (Keith edits in-app), splice with insertAtRating semantics, assert no mbid in both ranked and a list, POST with `base_updated_at`, read back. Scratchpad files `resolve2.py`, `resolved2.json`, `live2.json` are in session 445b931c's / 707534b2's scratchpads and may be gone. Bad entries in resolved2: Oasis `451dca98...`, Wilco Being There `5aed5f2c...`, Yo La Tengo `901ddfef...`, Mogwai Young Team `8cc9da13...`, Spiderland `e9f4b96a...`; get full mbids from `/api/search-album`.
- Live counts as of 2026-11-15: 952 ranked / 75 want / 61 notHeard / 42 dontCare.
- Filter rule: skip artists already in wantToListen/notHeard/dontCare/blocked_artists when recommending.
- Keith still needs to re-hide hidden artists/curated entries made since Nov 8 plus Sam Smith and Christina Aguilera albums.
- Stereolab "Switched On" resolved to the 1992 compilation; Yeah Yeah Yeahs resolved to the 2002 EP; check the app's LP filter doesn't hide it.
- Check the Want to listen view after the `.saved-meta` CSS change (shares the class; not opened).
- Still open from earlier: UX-teardown slices 5-6, gap-bonus shrinkage in `suggestions.ts`, splitting `main.ts`, CSP, friend accounts. Pages are 112,256px tall with 952 rows in DOM; not virtualized.

## Files touched this session
- `web/src/data/curatedLists.ts`: added `pitchfork-indie-rock-100` and `spin-300` (committed)
- `web/src/style.css`: `.saved-meta` flex floor, `.saved-item .candidate-place` wrap (committed)

## Git state
- Branch: main, 9 commits ahead of origin (after this handoff commit), deployed through `aec15dd`
- Last commit: aec15dd feat(data): add Spin 300 curated list
- Uncommitted changes: only untracked `.playwright-mcp/` (pre-existing screenshots, leave out)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-11-17T15:10:00Z
