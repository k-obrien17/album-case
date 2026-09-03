# Handoff

## Current task
Resolve MBIDs for the `pitchfork-ambient` curated list so it can be checked
against the owner's ranked list, then deploy.

## Status
`pitchfork-ambient` is now fully resolved: 50/50 entries have a `resolved`
MBID block in `web/src/data/curatedLists.ts`. The automated resolver
(`web/scripts/resolve-curated-list-mbids.mjs`) got 34/50 across two runs;
the remaining 16 were resolved by hand (loosened MusicBrainz queries,
artist-scoped discography browses, and one -- William Basinski's "The
Disintegration Loops I-IV" -- matched to the album Keith already had rated
in his own ranked list rather than guessed from search). Both batches are
committed: `23b081e` (34 automated) and `f3fd9e1` (16 manual). Verified via
`npx tsc --noEmit`, the `curatedListMatch` unit tests, and a local
`npm run dev` smoke check (all 50 render correctly, no console errors).

**Not yet deployed** -- this repo has no auto-deploy, so production
(`https://album-case.vercel.app`) does not have the resolved list yet; its
curated-lists view still only shows the four decade lists, not
`pitchfork-ambient`.

Separately, while testing recommendations from the list, three albums got
rated live in production through the app itself (search -> Add flow, not a
code change): Biosphere *Substrata* (8.78), Alice Coltrane *Turiya Sings*
(8.55), Aphex Twin *Selected Ambient Works Volume II* (9.06). Ranked list is
now at 779. Fripp & Eno's *Evening Star* was suggested as the next
recommendation but not yet rated -- pick that thread back up if Keith wants
another one.

## Next concrete step
Run `vercel deploy --prod --yes` from `web/` so `pitchfork-ambient` becomes
visible in production's Curated Lists tab (currently only exists locally
via the committed source, not live).

## Don't forget
- Still open from earlier sessions (not touched this session): confirm/undo
  on the ranked-row "x" remove button, primary comparison card buried below
  nav chrome, unvirtualized 779-row ranked list, and the
  `main.ts`/`rankList.ts` god-file refactor (needs its own plan-mode
  session).
- Standing regression check for this project is `/regression-smoke`, not a
  full `/ship-check`.
- Write-key enforcement (`ALBUM_CASE_WRITE_KEY`) stays dropped. One-function
  revert if that changes: `requireWriteKey()` in `web/api/_writeKey.ts`.
- `CLAUDE.md` has an uncommitted 2-line diff (removes the old "This file
  provides guidance..." boilerplate line) that nobody in this session made --
  origin unknown, left alone. Worth asking Keith about before it's lost.

## Files touched this session
- `web/src/data/curatedLists.ts` -- added `resolved` MBID blocks for all 16
  remaining `pitchfork-ambient` entries (committed in `f3fd9e1`; the other
  34 were already committed in `23b081e` from earlier in the session).

## Git state
- Branch: main
- Last commit: f3fd9e1 feat(web): manually resolve remaining pitchfork-ambient MBIDs
- Uncommitted changes: yes -- `CLAUDE.md` (unexplained, not this session's
  work, see Don't forget), `web/api/_lp.ts`, `web/api/_schema.ts`,
  `web/api/discover-artist.ts`, `web/api/ranking.ts`, `web/src/album.ts`,
  `web/src/ranking/types.ts`, plus several untracked files -- all
  pre-existing from before this session, left alone
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-02T15:42:00Z
