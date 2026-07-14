# Handoff

## Current task
Similar-artist expansion for "Fill in more albums" — **built, reviewed, merged, pushed, and deployed to production.** Nothing in flight; the repo is fully shipped and in sync with origin.

## Status
Everything from the last two sessions is live at https://album-case.vercel.app:

- **Search** (local filter + MusicBrainz fallback with rate-to-add), deployed earlier today.
- **Similar-artist expansion** (this session): "Fill in more albums" is now two-tier. Tier 1 (unchanged) browses the top-10 ranked artists' remaining catalogs; when it finds 0 and writes aren't locked, Tier 2 fetches similar artists per seed from ListenBrainz Labs (via a new read-only proxy `GET /api/similar-artists?artist_mbid=`), normalizes+aggregates scores across seeds, excludes artists already represented in ranked/pool or blocked by name, and discovers the top 5 new artists' studio LPs into the candidate queue — naming them in the summary. Repeated presses dig 5 artists deeper (previous run's artists are now in the pool, so exclusion advances).
- 243 tests pass, tsc/build clean. Route verified live (50 similar artists for Radiohead). Production data healthy: **401 ranked albums** (Keith actively adding via search — up from 376 post-canon), OK Computer still #1 at 10.
- The stalled-save issue from yesterday is resolved (it was the rotated write key; Keith re-unlocked via the `#key=` fragment link — his adds are landing on the server again).

## Next concrete step
**Keith verifies the one path no test could reach:** press "Fill in more albums" on his unlocked device. Expected: Tier 1 progress → "Finding similar artists (1/10)…" → "Discovering [artist]…" → summary naming ~5 new artists whose albums joined the candidate queue. (With writes locked, Tier 1 short-circuits client-side before any network call, so the full unlocked Tier-2 flow was verified only via unit tests with injected deps plus a live curl of the route — the wiring was reviewed character-by-character against the route's response shape, but the first real press is the true end-to-end test.) If anything misbehaves, `web/src/main.ts`'s `handleBulkDiscover` is the wiring and `web/src/bulkDiscovery.ts`'s `runSimilarExpansion` is the logic.

## Open questions
- The `/collect/albums` page for **keithrobrien.com** remains built, merged locally, and **deliberately unpushed/undeployed** per Keith's "not until I say so" (that repo is 5 commits ahead of origin). Its `albums.json` was generated from the 376-album state — **regenerate before ever deploying it** (`node --env-file=web/.env.local web/scripts/export-collect-albums.mjs` from album-case) since the list is now 401 and growing.

## Don't forget
- **Similarity data skews popular** (session-based collaborative filtering: Coldplay scores high for Radiohead). Blocking an artist from the candidate card removes them permanently; that's the intended pressure valve. A Low-severity note from review: the Tier-2 name-block check uses exact lowercase match while the rest of the app uses `artistKeys()` fuzzy normalization — worst case is one wasted discovery call, never a blocked artist surfacing (downstream `blockedArtistMbids` filtering catches it).
- The ListenBrainz algorithm string is a constant in `web/api/similar-artists.ts` — if LB ever retires it, the route 502s and the button reports "Couldn't reach ListenBrainz." That's the first thing to check if Tier 2 starts failing months from now.
- **Artist locks remain PAUSED** (enforced nowhere, 14 locks preserved in the snapshot, re-enable recipe in `web/src/ranking/locks.ts`'s header). **`Number('') === 0`** — any new rating input must reject empty strings explicitly. **Never append-then-sort** when inserting by rating — use `insertAtRating`. **Never set `CONFIRM_CANON_IMPORT` casually** — it replaces the entire live ranking (the script is a safe dry run without it).
- Bulk-add via CSV works and takes any 0-10 ratings now (`RATING_FLOOR` env var restores a floor if wanted). RESTORE-POINT backup from before the canon import: `web/scripts/backups/RESTORE-POINT-pre-canon-import.json` (gitignored, local-only, 244 albums — restore must omit `base_updated_at`).
- Stale worktree from an old session still exists: `.claude/worktrees/overall-rank-edit`. Untouched for days; ask Keith whether to discard it.
- `keithrobrien`'s `app/te-tokens.css` has a pre-existing uncommitted edit — not ours, leave it.

## Files touched this session
- `web/src/bulkDiscovery.ts` + `.test.ts` — `rankSimilarArtists` (per-seed normalization, cross-seed aggregation, exclusions), `runSimilarExpansion` (Tier 2 orchestrator, all four discover statuses handled), `runBulkDiscovery` now returns `found`/`locked`.
- `web/api/similar-artists.ts` + `.test.ts` — new read-only ListenBrainz Labs proxy (UUID validation, 8s timeout, day-long edge cache on success only).
- `web/src/main.ts` — `handleBulkDiscover` chains the tiers (`!locked && found === 0` triggers Tier 2).
- `docs/superpowers/specs/2026-07-13-similar-artist-expansion-design.md`, `docs/superpowers/plans/2026-07-13-similar-artist-expansion.md` — spec + plan.
- `HANDOFF.md` — this file, full rewrite.

## Git state
- **album-case**: branch `main`, last commit `753f6d6 feat(discovery): expand to similar artists when own catalogs are exhausted`. Uncommitted: no (before this handoff commit). Stashed: no. **In sync with origin/main, deployed.**
- **keithrobrien**: branch `main`, 5 commits ahead of origin, unpushed by design. One pre-existing uncommitted file (`app/te-tokens.css`), not ours.

## Reason for handoff
session paused

## Updated
2026-07-14T11:59:11Z
