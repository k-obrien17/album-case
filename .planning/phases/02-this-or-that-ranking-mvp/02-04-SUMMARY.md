---
phase: 02-this-or-that-ranking-mvp
plan: 04
subsystem: atom-mailbox
tags: [vercel, turso, libsql, retry-queue, atoms]

# Dependency graph
requires:
  - phase: 02-this-or-that-ranking-mvp
    provides: "Drag-to-place ranked-list UI and anonymous session persistence (plan 02-03)"
  - phase: 01-album-data-foundation
    provides: "Canonical atoms/sessions schema in pipeline/schema.sql"
provides:
  - "Vercel serverless `/api/atom` endpoint that validates and writes atom rows to Turso"
  - "Client-side `tastetest-atom-queue` retry buffer"
  - "Neighbor atom derivation from drag placements"
affects: [deployment, aggregate-data, future-insights]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side Turso credentials only; no VITE_ secret exposure"
    - "Parameterized libSQL writes through @libsql/client"
    - "Fire-and-forget client queue removes entries only after a 2xx response"

key-files:
  created:
    - web/api/_schema.ts
    - web/api/atom.ts
    - web/src/atoms.ts
    - web/src/atoms.test.ts
    - web/.env.example
  modified:
    - web/src/main.ts
    - web/vercel.json
    - .gitignore
    - web/.gitignore

key-decisions:
  - "Mechanism is `drag_to_place`, not the older plan's `this_or_that`, because atoms now derive from direct list placement."
  - "Each placement emits up to two neighbor atoms: upper neighbor beats candidate; candidate beats lower neighbor."
  - "The API validates entity MBIDs against `web/api/_allowlist.json` and UUID format before touching Turso."
  - "Synthetic verification rows are deleted after live endpoint/UI checks so test data does not remain in the dataset."

requirements-completed: [RANK-05]

# Metrics
duration: ~45min
completed: 2026-07-04
---

# Phase 2 Plan 4: Atom Mailbox Summary

Built and verified the durable atom mailbox for the drag-to-place MVP. Placements now enqueue pairwise neighbor atoms, post them through a Vercel serverless endpoint, and retry safely if the network or API is unavailable.

## Accomplishments

- Added `web/api/_schema.ts` with idempotent `atoms` and `sessions` table/index creation matching the Phase 1 schema.
- Added `web/api/atom.ts`:
  - accepts only POST
  - validates MBID UUIDs against `web/api/_allowlist.json`
  - rejects malformed payloads with 400
  - hardcodes `mechanism = 'drag_to_place'`
  - upserts `sessions`
  - inserts atoms via parameterized SQL
- Added `web/src/atoms.ts` with `enqueueAtom` and `flushAtomQueue`, backed by `tastetest-atom-queue`.
- Wired `web/src/main.ts` so candidate placement derives neighbor atoms and enqueues them without awaiting network I/O.
- Added atom queue tests for offline reject, non-2xx retention, and successful dequeue.
- Added local env handling:
  - `web/.env.local` contains local Turso env vars and is ignored
  - `web/.env.example` documents required vars
  - Vercel project `eighth-chair-s-projects/web` has both Turso vars set for production, preview, and development

## Verification

- `cd web && npm run test` — 8 files, 45 tests passed.
- `cd web && npm run build` — TypeScript and Vite production build passed.
- API files typechecked directly with `npx tsc --noEmit --ignoreConfig ... api/atom.ts api/_schema.ts`.
- `vercel dev` with local Turso env:
  - valid whitelisted atom returned 201
  - malformed atom returned 400
  - inserted Turso row was queried and confirmed with `mechanism = 'drag_to_place'`
  - synthetic rows/sessions were deleted after verification
- Playwright browser-to-API check:
  - placed two albums through the UI
  - verified `tastetest-atom-queue` drained
  - confirmed the UI-created Turso atom row existed
  - deleted the synthetic rows/sessions after verification

## Deviations from Plan

- The original 02-04 plan referenced `web/src/ui/pickLoop.ts` and `mechanism = 'this_or_that'`. The current app no longer has that UI; the implementation hooks into `web/src/main.ts` and uses `mechanism = 'drag_to_place'`.
- `web/vercel.json` no longer sets `functions.runtime = nodejs20.x`; the current Vercel CLI rejected that value. Removing the override lets Vercel use its default Node runtime for TypeScript API routes.

## Next Phase Readiness

Phase 2 is complete against the curated seed app. The next practical step is a Vercel deployment smoke test, then deciding whether to merge `design-system-te` to `main`. Phase 1 remains data-pending until the real MusicBrainz dump is ingested and verified.
