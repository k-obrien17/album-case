# Handoff

## Current task
Import Pitchfork's "The 50 Best Ambient Albums of All Time" as a new curated
list in Album Case so it can be checked against the owner's ranked list.

## Status
Added a `pitchfork-ambient` entry to `web/src/data/curatedLists.ts` (50
artist/title pairs, rank 1-50, source URL set) following the existing
decade-list pattern (`pitchfork-1960s` etc.). No `resolved` MBID records yet
-- entries currently fall back to the app's live search-and-confirm path.

Started `web/scripts/resolve-curated-list-mbids.mjs` (dry run, no `--write`)
in the background to pre-resolve MBIDs. Note: this script always re-resolves
every entry across *all* curated lists, not just the new one, so a full run
takes several minutes (1 req/sec against MusicBrainz for anything that
isn't already a hit against the owner's own ranked list). As of pause it was
still running (~35+ min elapsed, PID 27145 in this session's shell -- may or
may not have survived session end). `web/scripts/curated-mbid-report.json`
still reflects a prior run from Aug 24 and has not been refreshed yet.

Nothing has been written to `curatedLists.ts` from the resolver (that only
happens with `--write`), and nothing has been committed.

## Next concrete step
Re-run the resolver from the repo root (safe to rerun; only writes the
report file until `--write` is passed):

```
node --env-file=web/.env.local web/scripts/resolve-curated-list-mbids.mjs
```

Then review the `pitchfork-ambient` entries in
`web/scripts/curated-mbid-report.json` (confident vs. needsReview), and if
the match rate looks reasonable, apply with:

```
node --env-file=web/.env.local web/scripts/resolve-curated-list-mbids.mjs --from-report --write
```

That regenerates `curatedLists.ts` with resolved MBIDs merged in for
confident matches only; unmatched entries are left as-is (live search
fallback).

## Don't forget
- Still open from an earlier session (not touched this session): confirm/undo
  on the ranked-row "x" remove button, primary comparison card buried below
  nav chrome, unvirtualized 769-row ranked list, and the `main.ts`/`rankList.ts`
  god-file refactor (needs its own plan-mode session).
- Standing regression check for this project is `/regression-smoke`, not a
  full `/ship-check`.
- Write-key enforcement (`ALBUM_CASE_WRITE_KEY`) stays dropped. One-function
  revert if that changes: `requireWriteKey()` in `web/api/_writeKey.ts`.

## Files touched this session
- `web/src/data/curatedLists.ts` -- added the `pitchfork-ambient` curated
  list (50 unresolved artist/title entries, rank 1-50).

## Git state
- Branch: main
- Last commit: a86c60a chore: update handoff
- Uncommitted changes: yes -- `web/src/data/curatedLists.ts` (this session);
  `web/api/_lp.ts`, `web/api/_schema.ts`, `web/api/discover-artist.ts`,
  `web/api/ranking.ts`, `web/src/album.ts`, `web/src/ranking/types.ts`, plus
  several untracked files were all already modified/untracked at session
  start -- pre-existing, not from this session, left alone
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-01T23:34:00Z
