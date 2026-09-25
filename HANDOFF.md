# Handoff

## Current task
Self-hosted MusicBrainz album catalog for fast search (plan `docs/superpowers/plans/2026-09-24-album-catalog.md`), step one of a bigger redesign so Keith and a few friends can use Album Case.

## Status
Tasks 1-6 (all code) are done and committed locally, not pushed or deployed: pipeline keeps Albums+EPs with no secondary types, `web/api/_catalog.ts` (FTS5 catalog), catalog-first `/api/search-album` with `live=1`, "Search everywhere" link, weekly `/api/cron/refresh-catalog`, dry-run-first `web/scripts/load-catalog.mjs`. 393 unit + 13 e2e + 46 pytest green, tsc clean. The final whole-branch code review has NOT run yet (package ready at `.superpowers/sdd/2026-09-24-album-catalog/review-794c48d..96eda49.diff`). Tasks 7 (local catalog build) and 8 (approval-gated go-live) are paused: Keith stopped the dump download.

## Next concrete step
Ask Keith whether to run the final code review now (dispatch a fresh Opus reviewer on the review package, plan, spec, the plan's Review Focus, and the ledger's `Ruling:` lines), then resume the plan via `superpowers:executing-plans`; the ledger at `.superpowers/sdd/2026-09-24-album-catalog/progress.md` shows Tasks 1-6 complete.

## Open questions
- When to resume the MusicBrainz download (Task 7). `~/album-case-dump` holds 673MB of partial, unusable extraction; restart overwrites it, or delete it.
- Redesign decisions still open (mockup: https://claude.ai/artifact/2z3JETpGSYvDYc8AWJMgVT): ranking method (recommended: score, then check neighbors); where Want to listen lives (recommended: inside My ranked); drop drag-reorder; Hide per album + "hide artist" in ⋯; migrate Haven't heard -> Want to listen, Don't care -> Hidden; fate of Voice speed round; default source "For you".
## Don't forget
- Task 7 must confirm EP's primary-type id from the dump's `release_group_primary_type` table before running the pipeline (EP=3 assumed; not in InsertDefaultRows.sql). Plan text doesn't mention this; it's a ledgered ruling.
- Agreed order after the catalog: (1) one spec for the streamlined Rank screen + listening-history import (Keith's Spotify extended history is already requested), (2) friend accounts/per-user data last.
- Prior-art check: Echo ("Beli of music") and Musicboard are the neighbors; the gap is "import history, then rank what you've actually heard." Covers only on the Rank card.
- Every Task 8 step (env pull, FTS5 probe, `--write` load, CRON_SECRET, deploy, manual cron run) needs Keith's explicit OK at the time.
- pytest lives in `~/.venvs/album-case` (outside the repo).

## Files touched this session
- pipeline/{staging.sql,schema.sql,db.py,ingest_musicbrainz.py,materialize.py,README.md} + tests + fixture — Album/EP filter, release_type column
- web/api/_catalog.ts (+test), web/api/_dbTimeout.ts, web/api/search-album.ts (+2 tests), web/api/cron/refresh-catalog.ts (+test), web/vercel.json
- web/src/ui/rankListSearch.ts, web/src/ui/rankList.ts, web/src/main.ts, web/e2e/search-everywhere.spec.ts
- web/scripts/load-catalog.mjs, web/scripts/lib/catalog-load.mjs (+test)
- docs/superpowers/specs/2026-09-24-album-catalog-design.md, docs/superpowers/plans/2026-09-24-album-catalog.md
- CLAUDE.md — positioning rewrite (Keith plus a small group of friends)

## Git state
- Branch: main
- Last commit: this handoff commit (code tip: 96eda49 feat(scripts): add dry-run-by-default album catalog loader)
- Uncommitted changes: no
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-09-25T22:30:10Z
