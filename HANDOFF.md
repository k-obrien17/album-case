# Handoff

## Current task
Phase 2 (This-or-That Ranking MVP) Wave 3, plan **02-03** (the player-facing UI). Mid-refactor: the interaction has been **pivoted from a two-album pairwise pick loop to a DRAG-TO-PLACE ranked list** at Keith's request. Plan 02-03 is still sitting at its blocking human-verify checkpoint (not approved).

## Status
The drag-to-place refactor is **committed as WIP (`c5fd969`) and INCOMPLETE**. Build is green (`cd web && npm run build` exits 0), but **1 test fails** (`web/src/storage.test.ts`) and `web/src/style.css` still has obsolete pick-loop CSS that the executor was mid-way through deleting when it was stopped.

How we got here (so Codex doesn't undo the pivot):
1. Built the two-album pairwise pick loop (binary-insertion driven). Keith: felt repetitive ("same album in a row"), boring.
2. Patched: randomized which side the candidate shows on + added a "Where does X rank?" caption (`4c29f2f`).
3. Added a set-aside feature: per-card "Haven't heard" / "Want to listen" buttons -> two saved lists under `tastetest-lists` + a 4-view switcher + "Mark as heard" re-entry (`d11a2cc`, `e91f622`, `3933d52`, `b3b4a11`).
4. Keith still unhappy. Two concrete asks: **(a) fewer clicks to slot an album, (b) more variety** ("all from the 60s").
   - **Variety was a BUG, not the data.** The seed (`web/public/seed/albums.json`, 405 albums) is actually mostly modern (106 from the 2010s, 76 from the 90s, only 19 from the 60s). `nextUnrankedCandidate` returned the FIRST unranked album in pool order, and the pool is editorially ordered classic-rock-canon-first, so the player was marched top-down through the canon. Fix = random candidate selection (started in `eb39d39`).
   - **Fewer clicks:** binary insertion is already the math minimum (~log2(N) clicks/album). To click less you must change the mechanism.
5. Keith's chosen mechanism: **a clean, TEXT-ONLY ranked list (no cover art) with the next album shown on the side, dragged into its exact position.** This is one gesture per album AND stays transitive-by-construction (placing into an already-sorted list = exact total order), so it does **NOT** violate PROJECT.md's "no Elo / no self-contradiction" rule. Do not revert it as a rule violation.

The drag-to-place build (in progress in `web/src/ui/rankList.ts`, 332 lines) uses **pointer events** (not HTML5 DnD, for mobile), an insertion indicator, and is meant to autoscroll near list edges. It has NOT been verified on a phone yet.

## Next concrete step
Finish the drag-to-place refactor in `web/`:
1. Fix `web/src/storage.test.ts` — it still asserts the old `pending: {album, lo, hi}` shape; the model is now `pending: null` (ranking is a plain ordered `ranked: Album[]`). Update the expectation.
2. Remove the obsolete pick-loop / two-card CSS blocks left in `web/src/style.css` (executor was deleting old lines ~62-212 when stopped).
3. Confirm `web/src/ui/rankList.ts` drag works: pointer-based drag of the side candidate into the list, insertion indicator, autoscroll when long, existing rows reorderable, "Haven't heard"/"Want to listen" set-aside buttons on the candidate still work, 4-view switcher (Ranked / Want to listen / Haven't heard).
4. `cd web && npm run build` (0) and `cd web && npx vitest run` (all green). Add tests: insert-at-index ordering, randomized candidate selection excludes ranked+set-aside (inject an RNG), reorder-existing.
5. Verify on a phone at 360px (no horizontal scroll, >=44px targets, drag feels OK / autoscroll). This is plan 02-03's blocking human checkpoint.
6. Only then: write `.planning/phases/02-this-or-that-ranking-mvp/02-03-SUMMARY.md` and update STATE.md/ROADMAP.md (mark 02-03 complete). Note in the SUMMARY that the mechanism changed to drag-to-place and that the set-aside lists are a scope addition beyond the original RANK/PLAY requirements.

## Open questions
- **Mechanism is decided (drag-to-place).** PROJECT.md / CLAUDE.md still describe binary-insertion as THE v1 player mechanism and forbid Elo. They should be updated to document drag-to-place as the interaction (it's still transitive, so the "no self-contradiction" principle holds). Not yet done.
- **Wave 4 (02-04) needs Keith's Turso setup**: create a Turso DB, mint a token, set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (Vercel + local). The atom-mailbox endpoint can't be finished without it.
- **Branch**: all work is on `design-system-te`, unpushed, several commits ahead of `origin`. Decide when to merge to `main`.
- **Name**: "Taste Test" domain/handle availability still unverified.

## Don't forget
- **The binary-insertion engine (`web/src/ranking/insertion.ts`) is now UNUSED by the UI but intentionally KEPT** (tested module). Do not delete it.
- **Pairwise atoms for Wave 4 can be DERIVED from each drag drop**: an album inserted at index i implies it beats its lower neighbor and loses to its upper neighbor. That's the clean pairwise signal to write to the `atoms` table (the data-first product goal). Wave 4 work.
- A Vite dev server (`vite --host`, was PID ~36044) may still be running from this session — Codex can kill/restart it (`cd web && npm run dev`).
- The set-aside feature adds `tastetest-lists` to the localStorage namespace (alongside `tastetest-ranking`, `tastetest-session`).
- GSD config: executors run on **Sonnet**, orchestration on Opus. Plan 02-03 was executed via a single sequential `gsd-executor` on the main working tree (not a worktree) because of its blocking human checkpoint.
- STATE.md still shows "Plan 2 of 4 / 75%" — it was intentionally NOT finalized because 02-03 is mid-checkpoint. Update it only when 02-03 truly completes.
- Phase 1 (Album Data Foundation) remains `Executed (data-pending)` — blocked on the operator running the real ~7GB MusicBrainz dump (see `pipeline/README.md`). Unrelated to Wave 3.
- `elo-demo.html` + `pairwise-demo.html` at repo root are pre-existing untracked throwaways. Not part of the build; leave them or delete.

## Files touched this session
- `web/src/ui/rankList.ts` — NEW: drag-to-place ranked-list UI (pointer-events drag, insertion indicator, set-aside buttons, view switcher). ~332 lines, incomplete.
- `web/src/main.ts` — rewired to the drag-list model (old cold-start bootstrap loop removed; no stale pickLoop/rankedList imports).
- `web/src/storage.ts` — migration-safe load; ranking is now a plain ordered list (`pending: null`).
- `web/src/style.css` — drag-list styles added; obsolete pick-loop CSS partially removed (NEEDS finishing).
- `web/src/ui/pickLoop.ts`, `web/src/ui/rankedList.ts`, `web/src/ui/pickLoop.test.ts`, `web/src/main.test.ts` — DELETED (old comparison-loop flow).
- `web/src/seed.ts` — random candidate selection (variety fix); excludes ranked + set-aside (committed `eb39d39`).
- Earlier this session (already committed): set-aside feature (`web/src/ranking/setAside.ts`, `web/src/lists.ts`, `web/src/ui/savedList.ts`, `web/src/ui/pickLoop.ts` card refactor) across `d11a2cc`->`b3b4a11`.

## Git state
- Branch: `design-system-te`
- Last commit: `c5fd969 wip(02-03): drag-to-place ranked list (mid-refactor, incomplete)`
- Uncommitted changes: no (working tree clean except untracked throwaways)
- Untracked (pre-existing, intentionally left): `elo-demo.html`, `pairwise-demo.html`
- Stashed: no

## Reason for handoff
continuing in Codex — mid Phase 2 Wave 3, drag-to-place pivot in progress

## Updated
2026-07-04T14:30:23Z
