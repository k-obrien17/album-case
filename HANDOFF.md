# Handoff

## Current task
Imported Keith's 500-album Spotify "most played" list as ranking candidates, and improved the Voice Speed Round (typed rating + skip). Both shipped and live.

## Status
`web/scripts/import-spotify-albums.mjs` resolves artist+title pairs to MusicBrainz release-groups (local ranked/discovered index first, then a confident-match MB search) and writes into `discovered_albums`. Of 500 rows: 78 written as new candidates, 208 already ranked, 125 already in the pool, 89 left for review (83 legitimately not studio LPs -- soundtracks, classical, kids' content -- plus 6 genuinely ambiguous). Keith reviewed the 6 ambiguous ones via AskUserQuestion and added 1 (Fiona Apple, *When The Pawn...*) by hand. Speed Round (`web/src/ui/speedRound.ts`) now shows the manual number-rating input immediately alongside "Listening…" instead of only after voice fails, and has a "Skip for now" button wired to the same `skippedAlbums` mechanism the main candidate card uses. Build, typecheck, and all 296 tests pass. Deployed via `vercel deploy --prod --yes`; live bundle hash (`index-BSMJm7j7.js`) confirmed to match.

## Next concrete step
Decide which of the remaining 6 Pitchfork decade lists to add next (1970s, 1980s, 2010s, 2020s-so-far, 2000-04, 2010-14) and get the source text -- open since before this session, untouched here. Recommendation carried over: 1980s or 1970s, to keep the decade series contiguous. Paste the list text directly (like the 1990s list) rather than scraping, to avoid transcription mismatches. Re-run `web/scripts/cross-check-curated-titles.mjs` after adding it, then redeploy manually.

## Open questions
- Which decade list to add next, and whether Keith has paste-source text ready.
- Whether to run `import-spotify-albums.mjs` again later if Keith pulls a fresher Spotify export, or treat this as a one-time seed.

## Don't forget
- **No auto-deploy on this project.** Every commit that should reach production needs a manual `vercel deploy --prod --yes` from `web/` afterward. Check `curl -s https://album-case.vercel.app/ | grep -o 'assets/index-[^"]*\.js'` against the local build hash if in doubt.
- Vercel CLI is now logged in as `k-obrien17` (re-authed this session to run the deploy). Keith will need to switch it back for his other Vercel project if that one uses a different account.
- `import-spotify-albums.mjs` re-resolves all 500 rows from scratch every run (no `--from-report` reuse mode like `resolve-curated-list-mbids.mjs` has) -- expect ~8-10 min per run against MusicBrainz's rate limit if it's ever re-run.
- Standing repo gotchas: artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials (use an isolated scratch DB for manual write-path testing).

## Files touched this session
- web/scripts/data/spotify-top-albums.tsv -- new, Keith's 500-album Spotify export
- web/scripts/import-spotify-albums.mjs -- new, resolves + writes candidates to discovered_albums
- web/scripts/spotify-import-report.json -- new, match report (toInsert/alreadyRanked/alreadyDiscovered/needsReview)
- web/src/ui/speedRound.ts -- manual rating input always visible, added Skip for now button
- web/src/main.ts -- wired onSkip into the speed round mount

## Git state
- Branch: main
- Last commit: 17eb601 feat(web): add skip button to speed round
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Pushed to origin: no, 4 commits ahead of origin/main
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-23T17:57:48Z
