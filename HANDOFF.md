# Handoff

## Current task
Building **Taste Test** (the album this-or-that ranking product) through GSD. Mid Phase 2 execution: Waves 1-2 done, Wave 3 is next.

## Status
The project pivoted this session from a private artist-tier tool to a public, data-first **album** ranking app. Core loop is decided: **two albums, pick one, binary-insertion builds a transitive personal list, every pick logged as an atom.** Now GSD-managed (`.planning/`).

- **Phase 1 (Album Data Foundation): built + tested, but `Executed (data-pending)`.** The whole `pipeline/` package (SQLite, MusicBrainz + ListenBrainz dump ingestion, notability floor, Cover Art Archive pointers) works — 34/34 tests, proven end-to-end on fixtures (produced Abbey Road / OK Computer / a VA comp with covers). It is NOT complete because the real ~7GB MusicBrainz dump has not been ingested. That is an operator step (see below). The roadmap deliberately reads `Executed (data-pending)`, not Complete.
- **Phase 2 (This-or-That Ranking MVP): planned, plan-checked (passed), Waves 1-2 executed.**
  - Wave 1 (02-01): `web/` Vite+TS app scaffolded, Total Emphasis design system adopted, **405-album seed** resolved to real MBIDs (96% hit rate) with CAA cover pointers. Build green.
  - Wave 2 (02-02): pure DOM-free **binary-insertion ranking engine**, 14 vitest tests, transitivity proven by a property test (no self-contradicting picks possible).
  - Waves 3-4 NOT started.

## Next concrete step
Execute Phase 2 Wave 3 (the pick-loop UI): `/gsd:execute-phase 2 --wave 3` (or drive plan 02-03 directly with a sequential gsd-executor on Sonnet). It builds `web/src/ui/pickLoop.ts` + `rankedList.ts` + localStorage persistence and wires `main.ts`. Note plan 02-03 already has the mandatory cold-start bootstrap fix baked in. It ends in a **blocking human phone-usability checkpoint** — Keith must open the dev server (`cd web && npm run dev`) on a phone and confirm.

## Open questions
- **Wave 4 (02-04) needs Keith's Turso setup**: create a Turso DB, mint a token, set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (in Vercel + local). The atom-mailbox endpoint can't be finished without it.
- **Branch**: all work is on `design-system-te`, not `main`. Decide when to merge.
- **Name**: "Taste Test" domain/handle availability still unverified.

## Don't forget
- **Phase 1 completion is blocked on the operator dump run** (on Keith's machine, where a 7GB download is fine): download `mbdump.tar.bz2` + the ListenBrainz popularity dump, then run the three `pipeline/` CLIs + `materialize.py --verify` and re-tune `NOTABILITY_MIN_LISTENERS` (starts at 50). Full instructions in `pipeline/README.md`.
- Executors run on **Sonnet** (config), orchestration on **Opus 4.8**. Opus was flaky today (crashed the Phase 1 planner mid-run once); recover by hand-authoring or re-spawning.
- `elo-demo.html` + `pairwise-demo.html` at repo root are pre-existing untracked throwaways from the (now-resolved) fork. Not deleted; not part of the build.
- The legacy root app (`index.html`/`app.js`/`artists.js`) + `scoring/` + `poc/` are demoted (seed/fixture/throwaway). New product code lives in `pipeline/` (data) and `web/` (app). CLAUDE.md documents the two-product split.

## Files touched this session
- `DATA-SOURCES.md` — new; source matrix + "store everything, reference only what you own, pointers for copyrighted assets" architecture rule
- `CLAUDE.md` — rewritten for the Taste Test pivot (two-product split; file:// rule scoped to legacy only)
- `.planning/` — full GSD init: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `config.json`
- `.planning/phases/01-album-data-foundation/` — 4 plans + SUMMARYs (data foundation)
- `.planning/phases/02-this-or-that-ranking-mvp/` — `02-CONTEXT.md` + 4 plans + 02-01/02-02 SUMMARYs
- `pipeline/` — new package: `schema.sql`, `db.py`, `ingest_musicbrainz.py`, `ingest_listenbrainz.py`, `materialize.py`, `config.py`, `covers.py`, `staging.sql`, fixtures, tests, README
- `web/` — new Vite+TS app: scaffold, te design system, 405-album seed, `src/ranking/insertion.ts` + tests

## Git state
- Branch: `design-system-te` (several commits ahead of `origin`, not pushed)
- Last commit: `412bd20 docs(02-02): complete binary-insertion ranking engine plan`
- Uncommitted changes: no (only this HANDOFF.md)
- Untracked (pre-existing, intentionally left): `elo-demo.html`, `pairwise-demo.html`
- Stashed: no

## Reason for handoff
context clear, mid Phase 2 execution (Waves 1-2 done, Wave 3 next)

## Updated
2026-07-04T09:17:00Z
