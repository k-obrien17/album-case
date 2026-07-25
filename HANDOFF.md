# Handoff

## Current task
Spotify "Best of YYYY" playlist export + year audit (tangential to Album Case; all tooling lives outside this repo in `~/Desktop/Claude/spotify-export/`).

## Status
Album Case itself untouched this session; EP-search work from the prior session is pushed and live (`main` even with `origin/main`). The Spotify side: all 153 owned playlists export to CSV via OAuth (`export-playlists.mjs`, post-March-2026 `/playlists/{id}/items` API), and the 47 canonical year lists were audited (`analyze-years.mjs` + MusicBrainz verification). Keith fixed 14 misfiled songs and 12 of 13 cross-year duplicates in Spotify; re-export confirmed. Rules settled: song belongs to its original studio album's year; one artist per year playlist. Full findings in `~/Desktop/Claude/spotify-export/report/AUDIT-SUMMARY.md`.

## Next concrete step
Two Spotify edits remain: cut "Primitive Painters" (Felt) from the 1984 playlist (keep 1985), and decide Kylie "Can't Get You Out of My Head" 2002 → 2001. Then a quick re-export + `node analyze-years.mjs "exports/Best of"` confirms a clean pass.

## Open questions
- Kylie: strict album rule says 2001 (Fever, Oct 2001); Keith may keep 2002 as a US-release judgment call.
- "Creep" sits in 1992 while "Anyone Can Play Guitar" is in 1993 (both Pablo Honey, 1993); left deliberately since strict application would break one-artist-per-year.

## Don't forget
- "KOB Best of 2021 Longer" is ~90% 2022 music — likely mislabeled or filled through 2022; compare against "KOB Best of 2022 Longer" someday.
- 2021 short list still needs 2 more picks beyond Snail Mail "Valentine" and Tyler "LUMBERJACK" (four songs left it, only its own Longer list was mined).
- 33 followed-but-not-owned playlists can't be exported (2026 Spotify policy: contents only for owner-created playlists).
- Spotify client secret lives in `~/Desktop/Claude/spotify-export/.env` — never commit or echo it.
- Playlist CSVs carry Spotify track IDs; possible future cross-reference into Album Case rankings.
- Standing gotchas from earlier sessions still apply: similarity-scores-skew-popular, artist locks paused, `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, RESTORE-POINT backup location, `keithrobrien`'s pre-existing `te-tokens.css` edit.

## Files touched this session
- None in this repo. Outside: `~/Desktop/Claude/spotify-export/` (export-playlists.mjs, analyze-years.mjs, mb-verify.mjs, report/AUDIT-SUMMARY.md).

## Git state
- Branch: `main`
- Last commit: `d7f61b8 fix(rank-list): surface MusicBrainz search when artist already has a ranked album`
- Uncommitted changes: no (only pre-existing untracked `web/scripts/export-all.mjs`)
- Stashed: no
- Even with `origin/main`.

## Reason for handoff
session paused

## Updated
2026-07-25T03:39:42Z
