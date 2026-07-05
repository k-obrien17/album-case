# Handoff

## Current task
Taste Test (Music Library) is deployed at https://music-library-tau-three.vercel.app. A security containment pass just landed: the app previously had no owner-write auth (a fixed client-side owner/session ID meant anyone with the URL could mutate the canonical ranking), so the repo was flipped to private and a write kill switch (`ALLOW_PUBLIC_WRITES`) was added to gate every mutating endpoint. This session itself did no code work — it only answered a "what's the URL?" question by finding it in README.md/HANDOFF.md.

## Status
Working tree clean except two pre-existing untracked scratch files (`elo-demo.html`, `pairwise-demo.html`, unrelated to this or the last session). `ALLOW_PUBLIC_WRITES` is set to `false` in Vercel Production and Preview — **this means the live app cannot currently write at all, including for Keith.** There is no owner bypass yet; the kill switch blocks everyone equally until a real owner-write gate (signed cookie / server token) replaces it. Reads (`GET`) still work.

The previous session's "smoke-test the discovery button live" next-step is superseded: with writes globally disabled in prod, that test can't complete against the deployed app right now (would need `ALLOW_PUBLIC_WRITES=true` locally via `vercel dev` + `.env.local`, or a temporary prod flip).

## Next concrete step
Decide the permanent owner-write fix (signed-cookie or server-token gate) so Keith can write again without exposing the endpoint to the public — README.md already documents this as the intended permanent fix. Until then, local writes are only testable via `vercel dev` with `ALLOW_PUBLIC_WRITES=true` in `web/.env.local`.

## Open questions
- **Permanent write-auth design:** signed-cookie vs server-token — not yet decided, just flagged in README/`_writeGate.ts` comments.
- **Push the 2 local-only commits:** `main` is 2 commits ahead of `origin/main` (`670bd68` security containment, `9c63fd4` password-protection decision doc) — not yet pushed. Guarded operation, needs explicit go-ahead (`! git push origin main`).
- **Doc drift (carried over, unconfirmed still true):** `.planning/PROJECT.md` may still describe an anonymous public product; `.planning/STATE.md` may still say "Phase 2, Plan 2 of 4" — reality is a personal single-user tool. Not re-verified this session.
- **`8th-chair` project mystery (carried over):** exists in Keith's own Vercel account, separate from old-account leftovers already deleted. Never confirmed intentional or stray.
- **`world-cup-fantasy`/`world-cup-squads` entanglement (carried over):** two repos point at one Vercel project. Untangle sometime.
- Optional: Turso token rotation in `web/.env.local`, still outstanding.

## Don't forget
- **Write kill switch blocks Keith too, not just the public.** `ALLOW_PUBLIC_WRITES=false` is a blanket gate with no owner exception — the deployed app is effectively read-only until either the permanent fix ships or the flag is temporarily flipped.
- Vercel Password Protection was evaluated and deliberately deferred (requires paid Advanced Deployment Protection add-on) — write kill switch judged sufficient containment for now. Revisit only if the plan tier changes for other reasons.
- **Discovery button architecture note (carried over):** the discovery button makes one live MusicBrainz call from the running app — a deliberate, documented exception to `DATA-SOURCES.md`'s "don't query a live vendor catalog" rule. Don't route it through an offline pipeline unless the product direction shifts back toward public/multi-user.
- `OWNER_ID` (`web/src/owner.ts`) is still the single-owner key everywhere, including `discovered_albums`'s `session_id` column.
- Two load-bearing Vercel-ESM fixes in `api/*.ts` from prior sessions: `import ... with { type: 'json' }` and `from './_schema.js'`. Don't revert.
- Legacy calibration tool (`index.html`/`app.js`/`artists.js`/`scoring/`) is unrelated and untouched.

## Files touched this session
None. This session only answered a question (the deployed app URL) by reading README.md/HANDOFF.md — no edits.

## Git state
- Branch: `main`.
- Last commit: `9c63fd4 docs: record Password Protection decision`.
- Uncommitted changes: no (working tree clean).
- Untracked, intentionally left: `elo-demo.html`, `pairwise-demo.html` (pre-existing scratch files).
- Ahead of `origin/main`: 2 commits (`670bd68`, `9c63fd4`), not yet pushed.

## Reason for handoff
Session paused after a quick question ("what's the URL?"); refreshed this file since it had gone stale relative to the security containment work done between sessions (wrong HEAD, wrong ahead-count, missing the write-kill-switch context).

## Updated
2026-07-05T17:00:00Z
