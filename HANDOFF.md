# Handoff

## Current task
Phase 2 (This-or-That Ranking MVP) is complete. The player-facing mechanism is now a **text-only drag-to-place ranked list** rather than the original two-album pick loop, and each placement posts pairwise neighbor atoms through the Turso mailbox.

## Status
Build, tests, endpoint verification, and browser verification are green.

- `cd web && npm run test` — 8 files, 45 tests passed.
- `cd web && npm run build` — TypeScript + Vite production build passed.
- API typecheck passed with `npx tsc --noEmit --ignoreConfig ... web/api`.
- `POST /api/atom` returns 201 for a valid whitelisted atom and 400 for malformed input.
- Playwright verified drag placement, existing-row reorder, set-aside/mark-as-heard, desktop screenshot, 360px mobile layout, and UI-to-API atom queue drain.
- Turso rows were verified for synthetic sessions and then deleted.

## What changed
1. The UI now shows one candidate album and a ranked list target. The player drags the candidate into its exact position.
2. Existing ranked rows are reorderable via a grip.
3. Candidate selection is randomized from eligible albums instead of walking the editorial seed order.
4. "Want to listen" and "Haven't heard" set-aside lists are persisted under `tastetest-lists` and excluded from future candidates until marked heard.
5. `RankingState.pending` is normalized to `null` in the drag-to-place flow; the personal list is the ordered `ranked: Album[]`.
6. `/api/atom` validates payloads, hardcodes `mechanism = 'drag_to_place'`, upserts anonymous sessions, and inserts atoms with parameterized SQL.
7. `web/src/atoms.ts` buffers failed POSTs in `tastetest-atom-queue` and retries without blocking the UI.
8. Planning docs now document drag-to-place as the player mechanism while preserving the transitive-by-construction / no-Elo principle.

## Files to know
- `web/src/ui/rankList.ts` — pointer-events drag UI, insertion indicator, drag ghost, autoscroll, set-aside buttons.
- `web/src/ranking/order.ts` — pure `insertAt` and `moveItem` helpers for placement/reorder.
- `web/src/main.ts` — app wiring for ranking, set-aside views, persistence, session.
- `web/src/seed.ts` — randomized eligible candidate selection with injectable RNG.
- `.planning/phases/02-this-or-that-ranking-mvp/02-03-SUMMARY.md` — plan completion summary.
- `web/api/atom.ts` — Vercel serverless mailbox for validated atom writes.
- `web/src/atoms.ts` — fire-and-forget client queue and retry flush.
- `.planning/phases/02-this-or-that-ranking-mvp/02-04-SUMMARY.md` — atom mailbox completion summary.

## Next concrete step
Phase 2 is complete. Next likely steps:

- Deploy the web app to Vercel and smoke-test `/api/atom` on the deployed URL.
- Decide whether to merge `design-system-te` to `main`.
- Phase 1 real-data gate remains: operator runs the real MusicBrainz dump ingestion and verifies the full album universe.

## Git state notes
- Branch: `design-system-te`
- Untracked throwaways at repo root still exist and are intentionally unrelated: `elo-demo.html`, `pairwise-demo.html`.
- `web/.env.local` is ignored and contains local Turso env vars.
- Vercel project `eighth-chair-s-projects/web` has `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` set for production, preview, and development.
- A Vercel dev server may still be running at `http://127.0.0.1:3000/`; stop it if this session ends.

## Updated
2026-07-04T15:53:21Z
