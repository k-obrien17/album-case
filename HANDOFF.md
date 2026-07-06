# Handoff

## Current task
Reconciled a repo fork: this project used to live at `~/Desktop/Claude/Projects/random-music-rankings` and, separately, at `~/album-case`. Both shared history through commit `02af138`, then diverged for a day — turned out the underlying GitHub repo had been renamed (`random-music-rankings` → `album-case`), and the old folder kept working against the old (auto-redirected) remote URL independently. This session identified the fork, reconciled what was unique in each side, and retired the old folder.

## Status
`~/album-case` is now the single canonical folder. Build is green, full test suite passes (**114 tests, 20 files**, up from 107 — the increase is the ported seed pool, no new features). Ported from the old folder and committed: the Password Protection decision note (into `SECURITY.md`) and a 47-album seed pool expansion (115 → 162 albums, was sitting uncommitted-nowhere-else). Also copied over but left untracked/gitignored (matching this repo's own conventions): `import-ranking.html`, two pre-existing demo HTML files, a scratchpad ranking-recovery JSON/TXT pair, and a mostly-empty `data/tastetest.db` stub. The old folder's full git history is preserved forever on branch `archive/random-music-rankings-fork` on the same GitHub repo, then the folder was deleted from disk.

Everything from the **previous** handoff (rank badges, discography discovery button, unplanned rank-number-placement commit) was already committed before this session started and untouched by this session — see "Don't forget" below for what's still open from that work.

## Next concrete step
Add `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` to `web/.env.local` (the old folder had working credentials for the same underlying database — same Vercel project, `prj_neYcRKLQ7wkgHRQudb58goHzT0Kh` — but album-case's local env never had them) and finally do the live smoke test of the discovery button that's been deferred across two sessions now: `cd web && vercel dev`, click "▶" on a ranked row for an artist with more albums than the seed (e.g. Radiohead), confirm a real album surfaces, reload and confirm it persisted.

## Open questions
- **Push decision, still deferred to Keith:** `main` is 2 commits ahead of `origin/main` (the two ports from this session). The earlier ~88-commit backlog from before this session was already pushed at some point between the last handoff and now. Push is guarded (`! git push origin main`), needs explicit go-ahead.
- **Move `~/album-case` under `~/Desktop/Claude/Projects/`?** It currently lives outside the usual project-layout convention. Flagged, not acted on.
- Carried over, still unconfirmed: review of the unplanned `8b8a1d6 feat: place candidate by rank number` commit (Codex added it without a spec).
- Carried over, still unconfirmed: `.planning/PROJECT.md`/`STATE.md` doc drift (describes an anonymous public product; reality is a personal single-user tool with several features beyond the original roadmap).
- Carried over: `8th-chair` Vercel project mystery, `world-cup-fantasy`/`world-cup-squads` entanglement — neither investigated this session.

## Don't forget
- **The old folder's history is not gone** — `git fetch origin && git log archive/random-music-rankings-fork` on this repo recovers it if anything ported over turns out wrong.
- **Two independent write-gate implementations existed in parallel**: the old folder had a coarse `ALLOW_PUBLIC_WRITES` boolean kill-switch (`_writeGate.ts`); album-case already had the proper `ALBUM_CASE_WRITE_KEY` token gate (`_writeKey.ts`), which is strictly better and is what's live now. The boolean version was **not** ported — don't reintroduce it.
- `footgun-guard.sh` blocked a `git push origin main:refs/heads/archive/...` because its pattern matches the literal string "main" anywhere in the push command, including as a source ref for a non-main destination branch. False-positive, not a bug that caused harm, but expect it to keep firing on similar backup-branch pushes cut from `main`.
- `data/tastetest.db` (copied over, gitignored) is a near-empty stub (10 entities, 0 atoms, 0 sessions) — leftover from an early pipeline test, not real seed data. Low value, kept only for completeness.
- The scratchpad ranking-recovery JSON/TXT (copied over, gitignored) **is** real data — an actual recovered album ranking, not a throwaway.
- Legacy calibration tool (`index.html`/`app.js`/`artists.js`/`scoring/`) is unrelated and untouched.

## Files touched this session
- `SECURITY.md` — added "Also Considered" section (Password Protection decision), committed as `334a341`
- `web/api/_allowlist.json`, `web/public/seed/album-list.json`, `web/public/seed/albums.json` — ported +47 albums (115→162), committed as `b10f70f`
- `elo-demo.html`, `pairwise-demo.html`, `web/public/import-ranking.html`, `scratchpad/recovered-tastetest-ranking-*.{json,txt}`, `data/tastetest.db` — copied from the old folder, left untracked (gitignored or pre-existing convention)
- `~/Desktop/Claude/Projects/random-music-rankings` — deleted in full after everything unique was ported or archived

## Git state
- Branch: `main`.
- Last commit: `b10f70f feat(seed): port +47 album seed pool addition from random-music-rankings`.
- Uncommitted changes: no (working tree clean).
- Untracked, intentionally left: `elo-demo.html`, `pairwise-demo.html` (pre-existing scratch files), plus the gitignored copies noted above.
- Ahead of `origin/main`: 2 commits, not pushed (see Open questions).

## Reason for handoff
Session paused.

## Updated
2026-07-06T22:20:00Z
