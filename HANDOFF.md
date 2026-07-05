# Handoff

## Current task
**Taste Test is built and deployed.** Live at **https://web-indol-six-27.vercel.app**, single-owner, server-authoritative persistence (media-library model): open the URL, the one list loads from the Turso DB, every pick saves back, no codes/files/imports. This session took it from a mid-refactor drag build to a deployed, data-backed app.

## Status
Working and deployed. Production build serves the drag-to-place ranking loop with taste-weighted candidates, assisted binary placement, skip, three set-aside buckets, and full server persistence. `cd web && npm run build` green, **90 tests pass**. The Turso `/api/ranking` + `/api/atom` endpoints are verified live (round-trip tested).

**Keith's data is safe in three places:**
- **Authoritative:** Turso DB, `ranking_snapshots` keyed by `OWNER_ID` (`c0ffee00-0000-4000-8000-000000000001`) — **89 ranked + 7 want-to-listen + 63 haven't-heard** (full album records, survives seed changes).
- **Desktop backups:** `~/Desktop/tastetest-ALL-origins-backup-2026-07-05.json` (every origin), `tastetest-ranking-backup-2026-07-04.json`, `tastetest-import.json`, `tastetest-live.json`.
- Browser localStorage (offline cache only now).

## Next concrete step
**Enable Vercel Deployment Protection** (project `web` → Settings → Deployment Protection → Vercel Authentication or Password). This is the fix for the HIGH security finding: `OWNER_ID` is a public constant and `/api/ranking` has no auth, so anyone with the URL can read/overwrite the list. Deployment Protection gates the whole app+API behind auth and fully closes it. It's an account setting (Keith's to flip). Until then, treat the URL as a secret.

## Open questions
- **Security (HIGH, must-do before sharing the URL):** single-owner + public constant = no real access control. Deployment Protection is the recommended fix; real accounts only if it goes multi-user public.
- **Rotate the Turso token** in `web/.env.local` (live rw credential, gitignored but on disk).
- **Doc drift:** `.planning/PROJECT.md` still describes an anonymous, public, no-accounts product; the app is now a single-owner personal tool. `.planning/STATE.md` still says "Phase 2, Plan 2 of 4" but the build went well beyond/around the GSD plan (drag-to-place pivot, single-owner persistence). Reconcile the planning docs to reality, or branch "personal mode" vs "public product" explicitly.
- **Branch:** all work on `design-system-te`, unpushed, well ahead of `origin`. Decide when to merge to `main`.

## Don't forget
- **`OWNER_ID`** (`web/src/owner.ts`) is the single-owner key; `session.ts` returns it. Server stores FULL album records (not seed mbids) so the list survives seed changes and works cross-device.
- **Seed is 115 taste-dominant albums** (72% Keith's Spotify top artists, canon capped ~28%); `web/public/seed/preferred-artists.json` holds his top-60. `build-seed.py` regenerates `albums.json` + `_allowlist.json` from `album-list.json`.
- **Two Vercel-ESM gotchas are load-bearing** in `api/*.ts`: `import ... with { type: 'json' }` and `from './_schema.js'`. Don't revert them.
- The **allowlist gates `/api/atom` only**; ranking snapshots intentionally don't gate on it.
- Restore-code + backup import/export code still exists (`session.ts`, `backup.ts`) but is not rendered in the UI — kept as a fallback, not in the user path.
- Old crowd-data atoms: ~52 unsent atoms stranded on the retired localhost:5173 origin (minor; crowd data, not the personal list).
- Legacy calibration tool (`index.html`/`app.js`/`artists.js`/`scoring/`) is unrelated and untouched.

## Files touched this session (commits on `design-system-te`)
- `51b89a3` single-owner server-authoritative persistence (owner.ts, session.ts, rankingSync.ts, main.ts, api/ranking.ts)
- `6ec57d3` seed-change-proof backup import (backup.ts)
- `a5c090b` / `c105ad9` Vercel-ESM api fixes (_schema.js extension, JSON import attribute)
- `bca5a0f` restore-code
- `215764f` assisted placement + skip + don't-care bucket
- `6c450ff` taste-weighted candidates + retightened seed
- `178d921` send-path correctness (no silent pick loss / blank-app crash)
- `e868b38` preserved Codex's in-flight retention/sync/priority/backup build
- `4632bf3` taste-dominant seed rebuild

## Git state
- Branch: `design-system-te`
- Last commit (before this handoff): `51b89a3` (HANDOFF + .gitignore to be committed on top)
- Uncommitted: `.gitignore` (added `scratchpad/`), this `HANDOFF.md`
- Untracked, intentionally left: `elo-demo.html`, `pairwise-demo.html` (pre-existing throwaways), `scratchpad/` (now gitignored; recovered-ranking backup)
- Local scaffolding torn down: dev servers on 4173/5173/4190 stopped, isolated worktree removed.

## Reason for handoff
Milestone: app deployed with durable single-owner persistence; local scaffolding cleaned; data preserved (89 in Turso + Desktop backups).

## Updated
2026-07-05T14:01:44Z
