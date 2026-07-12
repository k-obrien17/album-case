# Handoff

## Current task
Implementing a major architecture pivot: `rating` becomes the stored, primary value that determines an album's position (replacing today's pure drag-to-place/array-splice model), driven by Keith wanting to wholesale-adopt a 396-album ChatGPT-generated canon (re-rates his existing 244, adds ~152 new). Two design specs and one 8-task implementation plan are written and committed; execution has not started.

## Status
- **Shipped and merged this session, not yet pushed/deployed:** the album-score-export feature (derives a 1-10 rating from rank position at export time only, writes to `keithrobrien.com`'s new `/collect/albums` page). Fully built, reviewed, tested in both repos (`album-case` main at `55213ab`, `keithrobrien` main at `01108c0`). Both repos' `main` are ahead of their `origin/main` (album-case by 9 commits, keithrobrien by 4) — nothing pushed, nothing deployed, both awaiting Keith's go-ahead.
- **Superseded, not yet reconsidered:** `docs/superpowers/specs/2026-07-11-bulk-album-list-import-design.md` (paste-a-Pitchfork-list-into-the-queue) — written and approved before the rating pivot, never implemented. The new rating-primary direction likely makes its "insert into priority queue, still requires drag-to-place" design obsolete for anything that arrives with its own rating (which is now the more likely case) — needs a decision before ever building it, not a blind go-ahead.
- **Current focus, spec'd and planned, zero code written:**
  - `docs/superpowers/specs/2026-07-12-rating-primary-architecture-design.md` — the core pivot. `RankedAlbum = Album & { rating: number }` (kept as a *separate* type from plain `Album`, not a universal required field — verified that requiring it everywhere would break the static seed pool and discovery pipeline, which construct plain `Album`s with no rating). Existing 244 albums backfill from current position via the same formula already built for the site export.
  - `docs/superpowers/specs/2026-07-12-album-canon-import-design.md` — the specific 396-album import (depends entirely on the architecture spec above). Full wholesale replace, mandatory backup first, artist-lock conflict reporting (14 locks currently live in production).
  - `docs/superpowers/plans/2026-07-12-rating-primary-architecture.md` — 8-task implementation plan for the architecture spec, self-reviewed, committed. **This is the next thing to execute.** Traced the real data flow carefully before writing it (confirmed `main.ts` never touches `pending`/`applyPick` directly — the whole binary-search/assist flow lives in `assist.ts`'s own scratch state, which is why the plan's `insertion.ts` changes are small despite the type ripple).
  - No implementation plan yet for the canon-import spec — can't be written until the architecture plan is actually built (nothing to import ratings *into* otherwise).
- The real source file for the canon import is `~/Desktop/album-canon-8-to-10-rated-and-interspersed.xlsx` (confirmed structure via direct parsing: columns Ranking/Album/Artist/Year/Rating, 396 rows) — needs manual conversion to CSV before the canon-import plan is written (Keith chose a local script over an in-app upload feature, explicitly to avoid adding an xlsx-parsing dependency).

## Next concrete step
Execute `docs/superpowers/plans/2026-07-12-rating-primary-architecture.md` via subagent-driven-development, same flow as this session's other implemented features (fresh subagent per task, task review after each, final whole-branch review, then the same 4-option finishing-a-development-branch flow). Keith was asked "proceed now, or review the plan first?" when the session ended — don't assume "go," check first.

## Open questions
- Proceed with executing the rating-architecture plan now, or does Keith want to review it first? (asked, unanswered when session paused)
- Push + deploy the already-merged score-export work (both repos)? Separate small decision, independent of the rating-architecture work.
- Does the bulk-album-list-import spec (2026-07-11) get built as originally designed, get amended for the rating-primary model, or get shelved in favor of the canon-import mechanism covering that need instead?

## Don't forget
- This is the single largest, riskiest change to Album Case so far — it converts something that was previously *guaranteed* correct by construction (no self-contradicting order was structurally possible) into something that depends on floating-point interpolation math being right everywhere. Extra test rigor on `ratingForDropIndex`'s edges (empty list, single album, exact-tie clamping) is called out explicitly in the plan — don't skip it.
- Expect most or all of the 14 live artist locks to get flagged as contradicted once the canon import runs (ChatGPT's ordering had zero awareness of them) — per Keith's explicit choice, locks get reported, never auto-modified.
- The canon-import's mandatory backup step (full ranking snapshot to a timestamped local file before any wholesale write) is not optional — it's the only rollback path for a bulk-replace of Keith's entire personal ranking.
- `web/scripts/export-collect-albums.mjs`'s formula gets duplicated (not imported) into the new `backfill-ratings.mjs` script per the plan — same duplication-over-cross-import convention already established for `OWNER_ID`, since these are separate standalone `.mjs` files.
- Sent Keith an ad-hoc full 244-album rating export earlier this session (`/tmp/all-albums-with-scores.tsv`, delivered via SendUserFile) — that was purely for his review, not persisted anywhere, not to be confused with any real data source.

## Files touched this session
- `web/src/bulkDiscovery.ts`, `web/src/bulkDiscovery.test.ts` — bug fix (summary-count), deployed.
- `web/scripts/export-collect-albums.mjs` — new, score-export script, merged to `main`.
- `keithrobrien/app/collect/albums/page.tsx`, `keithrobrien/app/collect/page.tsx`, `keithrobrien/app/sitemap.ts`, `keithrobrien/content/collect/albums.json` — new page + wiring, merged to `main`.
- `docs/superpowers/specs/2026-07-11-album-score-export-design.md` — corrected mid-session (original version wrongly assumed `content/collect/music.json` was a wired-up target; it isn't, that's a separate songs feature).
- `docs/superpowers/plans/2026-07-11-album-score-export-albumcase.md`, `...-keithrobrien.md` — implementation plans, both fully executed.
- `docs/superpowers/specs/2026-07-12-rating-primary-architecture-design.md`, `2026-07-12-album-canon-import-design.md` — new specs.
- `docs/superpowers/plans/2026-07-12-rating-primary-architecture.md` — new 8-task implementation plan, not yet executed.
- `HANDOFF.md` — this file, full rewrite.

## Git state
- **album-case**: branch `main`, last commit `04fab5e docs: add implementation plan for rating-primary architecture`, uncommitted changes: no, ahead of `origin/main` by 9 commits (unpushed).
- **keithrobrien**: branch `main`, last commit `01108c0 chore(collect): generate real albums.json from Album Case`, uncommitted: one pre-existing unrelated modification (`app/te-tokens.css`, not touched this session, not mine), ahead of `origin/main` by 4 commits (unpushed).
- No worktrees left over from this session (both `album-score-export` worktrees, in both repos, were created, used, and cleaned up). The unrelated `overall-rank-edit` worktree in `album-case` predates this session and was untouched.

## Reason for handoff
session paused

## Updated
2026-07-12T18:58:31Z
