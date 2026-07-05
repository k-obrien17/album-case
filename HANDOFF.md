# Handoff

## Current task
Album Case is deployed (https://music-library-tau-three.vercel.app) and cleanup/lock-down from the last session is done. This session added two new features via brainstorm → spec → plan → Codex-execution: **artist/year rank badges** on the ranked list, and an **artist discography discovery button** ("rank the rest of their albums" via a live MusicBrainz lookup). Codex executed both plans directly on `main` while this session was still writing them, and also added one extra, unplanned feature ("place candidate by rank number") on its own initiative.

## Status
Working tree is clean. Build (`cd web && npm run build`) is green, full test suite passes: **107 tests, 17 files** (up from 90 — new: `subRank.test.ts`, `api/_lp.test.ts`, `discovery.test.ts`). Both planned features match their specs/plans exactly, verified by reading the actual diffs against the plan documents. The rank-number-placement commit (`8b8a1d6`) was **not** reviewed in detail — it's outside both plans, added by Codex without a spec.

**Not yet tested:** the discovery button's live path (MusicBrainz artist search + release-group browse + Turso persistence) hasn't been exercised end-to-end against a running `vercel dev` — only unit-testable pieces (`_lp.ts`'s LP filter/merge logic) have real test coverage. The manual verification steps are in the plan doc (Task 3 Step 3, Task 7 Step 7).

**Not pushed:** `main` is **86 commits ahead of `origin/main`** — everything from the earlier `design-system-te` merge through tonight's two new features is still local-only.

## Next concrete step
Smoke-test the discovery button live (`cd web && vercel dev`, needs `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` in `.env.local`): click "▶" on a ranked row for an artist with more albums than the seed (e.g. Radiohead), confirm a real album (e.g. "The Bends") surfaces as the next candidate, reload the page and confirm it's still there (proves the Turso round-trip). Then decide whether to push `main` to `origin` (`! git push origin main` — guarded, needs your explicit go-ahead) and/or deploy.

## Open questions
- **Review the unplanned commit:** `8b8a1d6 feat: place candidate by rank number` (`web/src/ui/rankList.ts` + `style.css`, 76 lines) — Codex added this without a spec or plan. Worth reading before it ships.
- **Doc drift (carried over):** `.planning/PROJECT.md` still describes an anonymous public product; `.planning/STATE.md` still says "Phase 2, Plan 2 of 4." Reality is a personal single-user tool with two new features beyond the original roadmap. Reconcile before the next big push.
- **`8th-chair` project mystery (carried over):** exists in Keith's own Vercel account (`8th-chair-keith-obriens-projects.vercel.app`), separate from the old-account leftovers already deleted. Never confirmed as intentional or stray.
- **`world-cup-fantasy`/`world-cup-squads` entanglement (carried over):** two repos point at one Vercel project. Untangle sometime.
- Optional: Turso token rotation in `web/.env.local`, still outstanding.

## Don't forget
- **New this session:** `discovered_albums` Turso table (session_id + mbid primary key, full album records — same seed-independence reasoning as `ranking_snapshots`). `web/api/discover-artist.ts` handles both `GET` (list previously-discovered albums for a session) and `POST` (live-discover one artist's LPs + persist + return). `/api/atom`'s allowlist check now also queries `discovered_albums`, not just the static `_allowlist.json`.
- **LP definition:** MusicBrainz `primary-type: Album` with no `secondary-types` — same rule `build-seed.py` already used for the curated seed, reused via the new pure helper `web/api/_lp.ts`.
- **Architecture note:** the discovery button makes one live MusicBrainz call from the running app — a deliberate, documented exception to `DATA-SOURCES.md`'s "don't query a live vendor catalog" rule (see `docs/superpowers/specs/2026-07-05-artist-discography-button-design.md` for the reasoning). Don't "fix" this later by routing it through an offline pipeline unless the product direction changes back toward the public/multi-user vision.
- `OWNER_ID` (`web/src/owner.ts`) is still the single-owner key everywhere, including the new `discovered_albums` table's `session_id` column.
- Two load-bearing Vercel-ESM fixes in `api/*.ts` from prior sessions: `import ... with { type: 'json' }` and `from './_schema.js'`. Don't revert.
- Legacy calibration tool (`index.html`/`app.js`/`artists.js`/`scoring/`) is unrelated and untouched.

## Files touched this session
- `docs/superpowers/specs/2026-07-05-rank-badges-design.md` — new spec
- `docs/superpowers/specs/2026-07-05-artist-discography-button-design.md` — new spec
- `docs/superpowers/plans/2026-07-05-rank-badges.md` — new implementation plan
- `docs/superpowers/plans/2026-07-05-artist-discography-button.md` — new implementation plan
- `HANDOFF.md` — this file, updated across the session (cleanup confirmation, then this rewrite)

Everything else (`web/src/ranking/subRank.ts`, `web/src/ui/rankList.ts`, `web/api/_schema.ts`, `web/api/_lp.ts`, `web/api/discover-artist.ts`, `web/api/atom.ts`, `web/src/discovery.ts`, `web/src/main.ts`, `web/src/style.css`) was written and committed by **Codex**, executing the two plans above — not edited directly in this session, only reviewed.

## Git state
- Branch: `main` (the `design-system-te` branch was fast-forward merged into `main` earlier this session).
- Last commit: `8b8a1d6 feat: place candidate by rank number`.
- Uncommitted changes: no (working tree clean).
- Untracked, intentionally left: `elo-demo.html`, `pairwise-demo.html` (pre-existing scratch files, not from this session).
- Ahead of `origin/main`: 86 commits, nothing pushed.

## Reason for handoff
Session paused after Codex finished executing both plans live and Keith confirmed the build succeeded. Next step is smoke-testing the discovery button and deciding on the `origin` push — both explicitly deferred to Keith rather than done automatically (push is a guarded operation; the live Turso/MusicBrainz test needs Keith's env setup).

## Updated
2026-07-05T16:41:54Z
