# Handoff

## Current task
Two new features brainstormed and spec'd this session: bulk-importing a pasted album list (e.g. Pitchfork "Best Albums" lists) into the ranking queue, and exporting derived album scores to `keithrobrien.com`. Neither has an implementation plan or any code yet — both are at the approved-spec stage.

## Status
Two design specs written, self-reviewed, and committed. Both are independent of each other and can be built in either order:

- `docs/superpowers/specs/2026-07-11-bulk-album-list-import-design.md` — paste "Artist - Album" lines, match each to MusicBrainz via a new search endpoint, route confident matches straight to the priority queue (in paste order) and ambiguous ones to a review step, confirm-to-persist. Albums still go through the normal drag-to-place ranking — no bypass. Two new API endpoints (`/api/match-album`, `/api/import-albums`), one new screen, two new client files.
- `docs/superpowers/specs/2026-07-11-album-score-export-design.md` — a formula (`1 + 9*(total-rank)/(total-1)`, rounded to 2 decimals) derives a 1-10 score from rank position, computed only at export time, never stored in Album Case. A new script (`web/scripts/export-collect-music.mjs`, modeled directly on `media-library/scripts/export-collect-watching.mjs`) writes the top 10 to `keithrobrien.com`'s already-existing-but-empty `content/collect/music.json` stub. No changes to Album Case's app/schema/UI at all — smallest, lowest-risk of the two.

Also shipped and live this session (separate, already-closed thread): the "Fill in more albums" bulk-artist-discovery feature (PR #1, merged, deployed to production) plus a bug fix for its summary count (`5a6fe5d`, deployed). Both confirmed working against production Turso/MusicBrainz.

## Next concrete step
Recommended: write the implementation plan for the score export first (smaller, self-contained, proven pattern to copy), then execute it. Keith hadn't confirmed this when the session ended — ask him "score export or bulk import first?" if he hasn't already answered, don't assume.

## Open questions
- Which spec to implement first — recommended score export, but not yet confirmed by Keith.

## Don't forget
- Local `main` is 2 commits ahead of `origin/main` (the two spec-doc commits), unpushed — docs-only, low urgency, but push whenever.
- The score-export script needs `keithrobrien` checked out as a sibling directory to `album-case` (matching media-library's own convention) — verify that's actually true on this machine before assuming the default `COLLECT_OUT` path resolves correctly.
- Neither spec has been implemented yet — no code exists for either feature. Don't assume partial progress; start from the spec.

## Files touched this session
- `docs/superpowers/specs/2026-07-11-bulk-album-list-import-design.md` — new spec, committed (`e765782`).
- `docs/superpowers/specs/2026-07-11-album-score-export-design.md` — new spec, committed (`c92c8f0`).
- `web/src/bulkDiscovery.ts`, `web/src/bulkDiscovery.test.ts` — bug fix for the summary-count bug, committed (`5a6fe5d`), deployed to production.
- `HANDOFF.md` — this file, full rewrite (previous version was fully stale).

## Git state
- Branch: `main`
- Last commit: `c92c8f0 docs: add design spec for derived album scores + music export`
- Uncommitted changes: no
- Stashed: no
- Ahead of `origin/main`: 2 commits (unpushed, docs-only)

## Reason for handoff
session paused

## Updated
2026-07-11T22:00:03Z
