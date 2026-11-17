# Handoff

## Current task
Wiring Spin's 300 Best Albums 1985-2014 in as a curated list; the Pitchfork Indie Rock 100 list and a curated-row CSS fix already shipped.

## Status
- Shipped and deployed 2026-11-17: `f5bf572` (Indie Rock 100, all 100 entries resolved) and `6368963` (curated rows no longer collapse to 1 char wide at 900px+, long artist names no longer overflow at 390px). Live bundle `index-B9VPI6VU.js`. 7 local commits, NOT pushed.
- Spin 300: not yet in `web/src/data/curatedLists.ts`. List text is saved at `/private/tmp/claude-501/-Users-keithobrien-Desktop-Claude-Projects-album-case/e685fbf8-4500-49f5-a42e-ffd71fc0c4e7/scratchpad/spin300.txt`. A scoped resolver (`resolve-spin.mjs`, same folder) was mid-run: 146 of 300 resolved by rank 160, 14 in review. It writes `spin-resolved.json` (checkpoint every 20 ranks, final at end). If the scratchpad is gone, rerun it; it reuses mbids already in other lists and uses a generic user agent.
- Do NOT run `web/scripts/resolve-curated-list-mbids.mjs --write` for this. A full run rewrote older lists and dropped existing resolutions (reverted once). The privacy hook also blocks that script because its user agent holds Keith's email.

## Next concrete step
Read `spin-resolved.json`, review the `review` entries (Various Artists: C86, Soweto, Total 4, plus no-confident matches), then add list id `spin-300` (name "Spin: The 300 Best Albums, 1985-2014", rank 1 = Nevermind) to `curatedLists.ts` with `resolved` merged in. Confirm `git diff --stat` touches only that file, run `npm run test`, then ask before commit and deploy.

## Open questions
- Real source URL for the Indie Rock 100 (currently placeholder `https://pitchfork.com/`) and for Spin 300.
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
- `web/src/data/curatedLists.ts`: added `pitchfork-indie-rock-100` (committed)
- `web/src/style.css`: `.saved-meta` flex floor, `.saved-item .candidate-place` wrap (committed)

## Git state
- Branch: main, 7 commits ahead of origin, deployed through `6368963`
- Last commit: 6368963 fix(ui): stop curated row titles collapsing on wide screens
- Uncommitted changes: only untracked `.playwright-mcp/` (pre-existing screenshots, leave out)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-11-17T13:52:00Z
