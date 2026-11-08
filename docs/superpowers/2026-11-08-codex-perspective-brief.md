# Album Case: perspective brief for Codex (2026-11-08)

Written by Claude Code after shipping the browse-and-discovery feature. Purpose: give you full context on what Keith wants and what was just built, so you can offer an independent perspective. You are not being asked to continue in-flight work; the feature is merged, pushed, deployed, and verified. HANDOFF.md is the continuity bridge and agrees with this brief.

## What Keith wants

Album Case is an album-ranking app for Keith and eventually a small group of friends, each with their own list. Not a commercial product. The core job: help someone who has heard a lot of music rank what they have actually heard, and keep that ranking honest.

This session's goal, in Keith's words: "how to make this a combination discovery and ranking engine - and how to make it easier to view rankings by categories artist/year/genre." The agreed interpretation:

- Browse the ranked list by artist, year, decade, and genre, not just as one flat list.
- Make each category slice double as a discovery surface: show unranked candidates that fit the slice, rateable in place.
- Keep discovery deterministic (scored suggestions, no LLM at runtime).
- Bias suggestions toward gaps: slices Keith rates highly but has barely explored get a bounded score bonus.

## Non-negotiable architecture constraints (from CLAUDE.md, verify there)

- The rating value is the source of truth; rank is derived. The list is transitive by construction. No Elo, no append-then-sort (splice via insertAtRating).
- Single fixed owner id today (web/src/owner.ts), but new work must not deepen the single-owner assumption; friends-with-accounts is the target.
- Safe DOM construction only, no innerHTML. Mobile first: 44px tap targets, usable at 360px.
- No auto-deploy: production only updates via manual `vercel deploy --prod --yes` from web/.

## What was built (spec and plan are in the repo)

- Spec: docs/superpowers/specs/2026-11-07-browse-and-discovery-design.md
- Plan: docs/superpowers/plans/2026-11-07-browse-and-discovery.md (8 tasks, TDD throughout)

Key pieces:

1. web/src/ranking/groups.ts: pure grouping module. Sections keyed artist:/year:/decade:/genre:, artist/year/decade ordered by best album, genre by count with singleton collapse into "More genres" and a "No genre yet" bucket.
2. web/src/ui/rankList.ts: new suppressReorder option. Slice views render ranked rows without drag grips (a drop index against a partial list would compute a wrong rating) while rating/overall editors stay live, resolving edits to global indices by mbid.
3. web/src/ui/browseView.ts: the List/Artist/Year/Decade/Genre chip row and section list.
4. web/src/ui/sliceView.ts: one section as its own screen; up to 3 slice-matching unranked candidates with Rate now / Want to listen / Skip, plus "Find more from <slice>" which constrains the backlog's suggestion shelf (dismissable chip). Artist sections reuse the existing artistBatchView.
5. web/src/suggestions.ts: SliceFilter plus a gap bonus (needs 20+ ranked, slice mean >= 7.5, share <= 5%, max +8, artists excluded) with the reason surfaced in copy.
6. web/scripts/backfill-genres.mjs: resumable MusicBrainz genre backfill (1.1s throttle, [] sentinel for checked-none). Ran to completion: 5,227/5,230 discovered rows have genres; the 3 NULLs are permanent MusicBrainz 404s. All 826 ranked albums covered.
7. web/src/bootstrap.ts: overlays discovered genres onto seed-pool records; snapshots self-heal on next save.

## Verification state

- 426 unit tests green (54 files). Whole-branch review by a fresh reviewer: ready to merge; 1 Important finding fixed with RED to GREEN test; minors deferred (listed in HANDOFF.md).
- Deployed 2026-11-08; prod bundle hash matches local build. Verified live: Genre view shows real sections (rock 333, electronic 188, indie rock 186...), art rock slice renders 52 rows with global ranks and 3 candidates. 360px viewport via Playwright: no horizontal overflow, all tap targets >= 44px, gap-bonus copy rendering.

## Where perspective would help

1. The slice-as-discovery-surface pattern: is inline rating inside a browse slice the right long-term shape, or should discovery stay in the backlog with slices as filters only?
2. The gap-bonus constants (20/7.5/5%/+8) are judgment calls. Sanity-check the shape: linear taper on share, strongest slice only, artists excluded.
3. Genre taxonomy: MusicBrainz genres are flat and noisy (rock 333 of 826). Worth a mapping layer, or leave raw?
4. The still-open product decisions in HANDOFF.md: ranking-method redesign, where Want to listen lives, dropping drag-reorder, then friend accounts last. Any ordering or scoping you would change?
5. Single-owner to per-user migration: the snapshot-per-session_id schema (web/api/_schema.ts) was kept. How would you stage auth and per-user data without a rebuild?

## Reading order

CLAUDE.md, HANDOFF.md, the spec, then groups.ts and sliceView.ts with their tests. Git history from e2db5bc to 624d9be is this feature, one commit per task.
