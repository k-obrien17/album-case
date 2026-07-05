# Handoff

## Current task
**Taste Test is built, deployed, and moved to Keith's own Vercel account.** Live at **https://music-library-tau-three.vercel.app** (project `music-library`, under team **Keith O'Brien's projects**). Single-owner, server-authoritative persistence (media-library model): open the URL → your list loads from Turso → every pick saves back → no codes/files/imports. Keith has been actively ranking on it (list grew from 89 to **107**).

## Status
Working, deployed, on the right account. `cd web && npm run build` green, **90 tests**. Turso `/api/ranking` + `/api/atom` verified live (round-trip). App diverged hard from the original GSD plan and the anonymous-public product vision in `.planning/` — it's now a personal single-user tool.

**Data (safe, authoritative in Turso):** `ranking_snapshots` keyed by `OWNER_ID = c0ffee00-0000-4000-8000-000000000001` — as of last check **107 ranked + 16 want-to-listen + 63 haven't-heard** (full album records, survives seed changes, same DB across every deployment). Desktop backups: `~/Desktop/tastetest-ALL-origins-backup-2026-07-05.json`, `tastetest-ranking-backup-2026-07-04.json`, `tastetest-import.json`, `tastetest-live.json`.

## Next concrete step
**Cleanup + lock-down: DONE (confirmed 2026-07-05).**
- ✅ 3 leftover projects deleted from the OLD "Eighth Chair" account (`web`, `taste-test`, `world-cup-squads`).
- ✅ Deployment Protection enabled on `music-library` (Vercel Authentication → On). HIGH security finding (public `OWNER_ID`, unauthenticated `/api/ranking`) is closed.
- ⏭ Turso token rotation in `web/.env.local` still optional/outstanding, not done.
- CLI confirmed still logged into `k-obrien17` / Keith O'Brien's projects post-cleanup (no account-switch stranding).

Remaining work is doc/repo hygiene, not app or account risk — see Open questions.

## Open questions
- **Doc drift:** `.planning/PROJECT.md` still describes an anonymous public product; `.planning/STATE.md` still says "Phase 2, Plan 2 of 4." The build went well beyond/around GSD. Reconcile docs to reality (personal tool vs public product) before the next big push.
- **Branch:** all work on `design-system-te`, unpushed, well ahead of `origin`. Decide when to merge to `main`.
- `world-cup-fantasy` repo's `.vercel` is ALSO linked to the same `world-cup-squads` project — two repos → one project. Untangle sometime so the wrong repo isn't deployed over it.
- **Unresolved:** an `8th-chair` project exists *in Keith's own account* (`8th-chair-keith-obriens-projects.vercel.app`) — separate from the 3 deleted old-account leftovers. Not yet identified/confirmed as intentional or stray.

## Account / deploy facts (important context)
- **Both apps now live under "Keith O'Brien's projects"** (team `team_gqKcSmYlv1K3peiDwzDuT1Gl`): Taste Test = `music-library` (https://music-library-tau-three.vercel.app); World Cup Squads = `world-cup-squads` (https://world-cup-squads-theta.vercel.app, was already there).
- The OLD "Eighth Chair" account (`eighthchair-8983` / `eighth-chair-s-projects`, team `team_X5v00ZOZA5gUVWYG9fAbopqT`) holds the 3 leftovers to delete.
- The Vercel CLI is currently logged into **Keith O'Brien's projects**. `web/.vercel/` links to `music-library` (gitignored). Turso env vars are set on `music-library` for production/preview/development.

## Don't forget
- `OWNER_ID` (`web/src/owner.ts`) is the single-owner key; `session.ts` returns it. Server stores FULL album records (not seed mbids) so the list survives seed changes and works cross-device.
- Seed is 115 taste-dominant albums (72% Keith's Spotify top artists); `web/public/seed/preferred-artists.json` is the source list; `build-seed.py` regenerates `albums.json` + `_allowlist.json` from `album-list.json`.
- Two load-bearing Vercel-ESM fixes in `api/*.ts`: `import ... with { type: 'json' }` and `from './_schema.js'`. Don't revert.
- Allowlist gates `/api/atom` only; ranking snapshots don't.
- Restore-code + backup import/export code still exists (`session.ts`, `backup.ts`) but is not rendered — kept as fallback, not in the user path.
- Legacy calibration tool (`index.html`/`app.js`/`artists.js`/`scoring/`) is unrelated and untouched.

## Files touched this session (commits on `design-system-te`, newest first)
- `8c5c8eb` chore: handoff (previous) + gitignore scratchpad
- `51b89a3` single-owner server-authoritative persistence (owner.ts, session.ts, rankingSync.ts, main.ts, api/ranking.ts)
- `6ec57d3` seed-change-proof backup import
- `a5c090b` / `c105ad9` Vercel-ESM api fixes (_schema.js, JSON import attribute)
- `bca5a0f` restore-code · `215764f` assisted placement + skip + don't-care
- `6c450ff` taste-weighted candidates + retightened seed · `178d921` send-path correctness
- `e868b38` preserved Codex's retention/sync/priority/backup build · `4632bf3` taste-dominant seed
(Deploys + the Vercel account move were done via CLI, not committed to the repo.)

## Git state
- Branch: `design-system-te`; last commit before this handoff: `8c5c8eb` (this HANDOFF commits on top).
- Uncommitted: this `HANDOFF.md`.
- Untracked, intentionally left: `elo-demo.html`, `pairwise-demo.html`, `scratchpad/` (gitignored).
- Local scaffolding already torn down (dev servers 4173/5173/4190 stopped, isolated worktree removed).

## Reason for handoff
Cleanup confirmed done: old-account leftovers deleted, Deployment Protection on. Remaining items are doc drift + branch merge decision, no urgency.

## Updated
2026-07-05T14:56:13Z
