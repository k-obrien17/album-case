---
phase: 02-this-or-that-ranking-mvp
plan: 03
subsystem: player-ui
tags: [typescript, vite, drag-to-place, localstorage, mobile]

# Dependency graph
requires:
  - phase: 02-this-or-that-ranking-mvp
    provides: "web/ Vite+TS scaffold, te design system, seed album dataset (plan 02-01)"
  - phase: 02-this-or-that-ranking-mvp
    provides: "Pure binary-insertion ranking engine kept as a tested module (plan 02-02)"
provides:
  - "Player-facing drag-to-place ranked-list UI (web/src/ui/rankList.ts)"
  - "localStorage persistence for ranked list, anonymous session, and set-aside lists"
  - "Randomized candidate selection excluding ranked and set-aside albums"
  - "Phone verification at 360px: no horizontal scroll, >=44px targets"
affects: [02-04, atom-posting, placement-to-pairwise-derivation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pointer-events drag rather than HTML5 drag-and-drop so the interaction works on touch devices"
    - "Ranked list is plain ordered Album[] with pending normalized to null in the drag-to-place flow"
    - "Candidate selection uses injectable RNG for deterministic tests"

key-files:
  created:
    - web/src/ui/rankList.ts
    - web/src/ranking/order.ts
    - web/src/ranking/order.test.ts
    - web/src/lists.ts
    - web/src/lists.test.ts
  modified:
    - web/src/main.ts
    - web/src/seed.ts
    - web/src/seed.test.ts
    - web/src/storage.ts
    - web/src/storage.test.ts
    - web/src/style.css

key-decisions:
  - "Player-facing mechanism pivoted from two-card binary insertion to text-only drag-to-place because it takes one gesture per album and avoids repeated comparisons against the same candidate."
  - "The no-Elo/no-self-contradiction rule still holds: placing into a single ordered list is transitive by construction."
  - "Set-aside lists are a scope addition beyond the original RANK/PLAY plan: players can mark a candidate as 'Want to listen' or 'Haven't heard' and re-enter it later."
  - "The seed-order variety bug was fixed by randomizing eligible candidates instead of walking the editorially ordered seed from the top."

requirements-completed: [RANK-01, RANK-04, PLAY-01, PLAY-02, PLAY-03, PLAY-04]

# Metrics
duration: ~75min
completed: 2026-07-04
---

# Phase 2 Plan 3: Player UI Summary

Built and verified the drag-to-place ranking UI: the player sees one candidate album, drags it into a text-only ranked list, can reorder existing rows, and can set aside albums into "Want to listen" or "Haven't heard" lists.

## Accomplishments

- Rewired `web/src/main.ts` around the drag-to-place model: `RankingState.ranked` is the source of truth and `pending` is normalized to `null`.
- Added pointer-event drag UI in `web/src/ui/rankList.ts` with insertion indicator, drag ghost, existing-row reorder, and viewport-edge autoscroll.
- Added pure ordering helpers (`insertAt`, `moveItem`) with unit tests.
- Added persisted set-aside lists under `tastetest-lists`, with list views and "Mark as heard" re-entry.
- Fixed candidate variety by selecting a random eligible album while excluding ranked and set-aside albums.
- Updated storage tests so stale binary-insertion `pending` data is migrated away on load.

## Verification

- `cd web && npm run test` — 7 files, 42 tests passed.
- `cd web && npm run build` — TypeScript and Vite production build passed.
- Playwright verification against `http://127.0.0.1:5174/` passed:
  - Dragged candidates into the list.
  - Reordered existing rows.
  - Set aside a candidate, viewed the saved list, and marked it heard.
  - Checked 360px mobile layout: `scrollWidth === viewportWidth`, minimum target height 44px, no short tap targets.
  - Screenshots saved at `/tmp/tastetest-desktop.png` and `/tmp/tastetest-mobile.png`.

## Deviations from Plan

- The plan originally called for a two-album cover-card pick loop driven by binary insertion. Keith rejected that interaction as repetitive and too click-heavy, so the player-facing mechanism changed to drag-to-place.
- The binary-insertion engine from 02-02 remains in the repo and remains tested, but it is no longer used by the UI.
- Cover art is no longer the player-facing centerpiece in this plan. The drag UI is intentionally text-only for speed and clarity; saved-list rows still support thumbnails.
- Set-aside lists were added beyond the original plan scope because "Haven't heard" and "Want to listen" are necessary escapes for a ranking app over unfamiliar albums.

## Next Phase Readiness

Plan 02-04 should derive atom writes from each drag placement. A candidate inserted at index `i` implies it loses to the upper neighbor and beats the lower neighbor, where those neighbors exist. Turso setup is still required before the atom-mailbox endpoint can be completed.
