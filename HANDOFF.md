# Handoff

## Current task
Hide/skip-permanence for the rating workflow: Keith reported hidden bands and
curated-list albums keep resurfacing because that state was localStorage-only.
Core fix is built, tested, and deployed. One piece deliberately deferred.

## Status
Shipped and verified live this session: (1) added the Pitchfork "200 Best
Albums of the 1980s" curated list (200 entries, 151 with resolved mbids); (2)
ran a full `/ship-check` + launch-assassin + Fable brief, which found and led
to fixing a Critical CSS bug (tablet-breakpoint layout break on the golden
ranking screen); (3) built the hide/skip-permanence feature -- `blockedArtists`
and a new `curatedSkips` set now persist to Turso (previously localStorage
only, which was the actual bug), curated-list rows gained Skip for now / No
more [Artist] / Want to listen actions, and the Blocked Artists screen now
also reviews/unskips curated skips. Full TDD throughout, 306/306 tests
passing, build clean, deployed and schema-verified live (both new columns
confirmed present on the production Turso table).

Not done: "Want to listen" on a curated entry only works when the entry
already has a resolved MusicBrainz match (~600 across the four lists).
Unresolved entries need the same search-confirm flow "Rate" already uses,
pointed at `wantToListen` instead of the ranked list -- deliberately deferred
as its own scope, not started.

## Next concrete step
If resuming the hide/skip work: extend `handleWantToListenCuratedEntry` in
`web/src/main.ts` to reuse `handleRateCuratedAlbum`'s search-confirm flow for
unresolved entries, inserting into `lists.wantToListen` instead of rating.

If picking something else instead: the ship-check backlog (2 remaining Highs,
10 Mediums) is sitting untriaged in
`~/.claude/ship-check-reports/2026-08-25-1245-album-case.md`.

## Don't forget
- Ship-check backlog untriaged: 2 Highs (untested sync/conflict state machine
  in `main.ts`'s `syncRankingSnapshot`; no delete affordance on saved lists)
  plus 10 Mediums. Full report + retention log at
  `~/.claude/ship-check-reports/2026-08-25-1245-album-case.md` and
  `~/.claude/ship-check-log.md`.
- This project's standing check going forward is `/regression-smoke`, not a
  full `/ship-check` -- confirmed this session (matches `SHIP-STANDARD.md`,
  and the ship-check's own audit stack proved the point, see incident below).
- Write-key enforcement (`ALBUM_CASE_WRITE_KEY`) stays dropped, reconsidered
  and left as-is this session despite the incident below. One-function
  revert if that changes: `requireWriteKey()` in `web/api/_writeKey.ts`.
- Incident: during the ship-check, an audit subagent wrote a real test rating
  to production data without authorization (security-classifier flagged);
  self-reported reverted, independently verified 95% clean, one stray atom
  row (id 97) found and deleted with Keith's approval. No lasting damage, but
  scope any future audit subagents to read-only explicitly.
- `curatedEntryKey` moved from `web/src/ui/curatedListView.ts` to
  `web/src/curatedListMatch.ts` this session (re-exported from the old
  location so nothing broke) -- canonical definition is now in
  `curatedListMatch.ts`.
- 10 commits ahead of `origin/main`, not pushed (same as prior sessions --
  this repo doesn't auto-deploy from git anyway, `vercel deploy --prod --yes`
  from `web/` is the actual deploy step and has been run after each commit
  that needed it this session).

## Files touched this session
- `web/src/data/curatedLists.ts` -- added the `pitchfork-1980s` curated list
- `web/src/style.css` -- fixed the tablet-breakpoint (768px) layout break
- `web/api/_schema.ts` -- added `blocked_artists_json`, `curated_skips_json`
- `web/api/ranking.ts` -- validate/GET/POST for the two new fields
- `web/api/ranking.test.ts` -- round-trip tests for the two new fields
- `web/src/rankingSync.ts` -- snapshot payload/load carry the two new fields
- `web/src/rankingSync.test.ts` -- tests for the above
- `web/src/curatedListMatch.ts` -- `curatedEntryKey` moved here;
  `unrankedFromCuratedList` gained blocked/skipped filtering
- `web/src/curatedListMatch.test.ts` -- new filter tests
- `web/src/main.ts` -- `blockedArtists` now server-persisted; new
  `curatedSkips` state; new curated-entry handlers; Blocked Artists screen
  extended to review/unskip curated skips
- `web/src/ui/curatedListView.ts` -- three new per-row buttons

## Git state
- Branch: main
- Last commit: 202869b feat(web): persist artist blocks + add skip/want-to-listen to curated lists
- Uncommitted changes: no (only pre-existing/scratch untracked: `.playwright-mcp/`, `ac-*.png` screenshots from the ship-check's visual-audit stage)
- Pushed to origin: no, 10 commits ahead of origin/main
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-25T13:52:00Z
