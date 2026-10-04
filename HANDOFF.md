# Handoff

## Current task
Self-hosted MusicBrainz album catalog for fast search (plan `docs/superpowers/plans/2026-09-24-album-catalog.md`), step one of the redesign so Keith and a few friends can use Album Case.

## Status
Tasks 1-6 code plus final-review fixes are committed locally, not pushed or deployed (396 unit + 13 e2e green, build clean). Task 7 is half done: all six MusicBrainz tables (2026-09-30 snapshot) are in `~/album-case-dump/mbdump/` (1.1GB), EP id confirmed = 3. Blocked on ListenBrainz: the popularity dataset service is down on their side (`could not translate host name "db"`), and the pipeline inner-joins on popularity, so Step 4 would produce an empty catalog.

## Next concrete step
Retry ListenBrainz: `K='no input required - just type anything here.'; curl -sS -X POST -H 'Content-Type: application/json' -d "[{\"$K\":\"x\"}]" -o ~/album-case-dump/popularity.json https://datasets.listenbrainz.org/popular-releases-by-listeners/json`. If it returns data, continue plan Task 7 Step 3 (JSONL convert, check keys), Step 4, Step 5, then stop and show Keith the dry-run numbers.

## Open questions
- If ListenBrainz stays down for days: fall back to MusicBrainz `release_count` (editions per release group, in `release_group_meta`) as the popularity proxy? Needs pipeline + ranking changes; Keith hasn't decided.
- Redesign decisions still open (mockup: https://claude.ai/artifact/2z3JETpGSYvDYc8AWJMgVT): ranking method (recommended: score, then check neighbors); where Want to listen lives (recommended: inside My ranked); drop drag-reorder; Hide per album + "hide artist" in ⋯; migrate Haven't heard -> Want to listen, Don't care -> Hidden; fate of Voice speed round; default source "For you".

## Don't forget
- Plan Task 7 Step 3's plain `curl` URL returns 400: the endpoint needs the odd query param above (GET with it returned 500; POST JSON is the dataset-hoster form). Update the plan and `pipeline/README.md` once the working call is confirmed.
- Weekly cron coverage risk: if a 21-day Album+EP window exceeds ~3,000 groups, runs stay partial. Task 8 Step 7's manual run shows `pages`/`partial`; if partial, raise maxDuration or move it to the Mac via `cron-hardened`.
- Deferred review items (ledger `.superpowers/sdd/2026-09-24-album-catalog/progress.md`): loader re-loads albums that later fail the album rule; full re-load rewrites every row + FTS entry. Both only matter on a second dump load.
- Every Task 8 step (env pull, FTS5 probe, `--write` load, CRON_SECRET, deploy, manual cron run) needs Keith's explicit OK at the time.
- Agreed order after the catalog: (1) one spec for streamlined Rank screen + listening-history import, (2) friend accounts/per-user data last.
- pytest lives in `~/.venvs/album-case`. `~/album-case-dump` can be deleted after go-live if Keith agrees.

## Files touched this session
- web/api/cron/refresh-catalog.ts (+test) — 40s time budget, per-page saves, error logging
- web/api/search-album.ts (+catalog test) — no-store on degraded results, close Turso client, hang test
- web/api/_catalog.ts — FTS keyed on explicit `id INTEGER PRIMARY KEY`
- pipeline/README.md, docs/superpowers/plans/2026-09-24-album-catalog.md — streamed extract, primary_type + derived-archive meta, latency `cb` param

## Git state
- Branch: main
- Last commit: this handoff commit (code tip: 0258163 docs: pull release_group_meta from the derived dump archive)
- Uncommitted changes: no
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-10-04T15:39:54Z
