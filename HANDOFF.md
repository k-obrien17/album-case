# Handoff

## 2026-11-14 follow-up: hides now sync, artist navigation fixed (UNCOMMITTED, NOT DEPLOYED)
Fixes for "it keeps cycling the same bands and unhid albums I hid", found after a sync conflict was resolved by merging a 919-album local copy into the server (921 ranked, merged payload kept the server's hidden artists/curated skips because the backup file did not carry them).
- Cause of cycling: after the earlier Artist-gaps filter, an artist whose last album was triaged vanished and the view snapped to `artists[0]` (always the same top bands); "Finish artist & next" also jumped to the first unreviewed artist overall. Now `pickSelectedArtistId` / `nextArtistAfter` (`web/src/backlog.ts`) move to the artist that FOLLOWED it, and the heading button is "Skip artist →" (marks reviewed, so skipped artists stop returning at the top). E2E: `web/e2e/artist-gaps-hides.spec.ts` (fails on the old logic).
- Removed albums (`tastetest-skipped-albums`, previously browser-only) are now saved with the snapshot as `skipped_albums` (migration `add_skipped_albums_json`, `COALESCE` so older clients never clear it; cap 20,000). Boot merges server + local and pushes anything only this browser had.
- "Discard unsaved changes" now unions hidden artists, curated skips and removed albums with the server copy instead of overwriting local hides, and saves any local-only ones right after the reload. "Export unsaved backup" now also writes `blocked_artists`, `curated_skips`, `skipped_albums`, `artist_locks`.
- Still device-local by design: "Skip for now" on a candidate (session only) and the candidate-artist cooldown.
- 476 unit tests + 19 Playwright specs green. Production currently runs the earlier fix pass below (deployed 2026-11-14); this follow-up is not live.

## 2026-11-14 ship-check fix pass (DEPLOYED 2026-11-14, still uncommitted)
Fixes for the 2026-11-14 ship-check (report: `~/.claude/ship-check-reports/2026-11-14-1132-album-case.md`). All in the working tree; typecheck clean, 464 unit tests + 16 Playwright specs green.
- `POST /api/ranking` now requires `base_updated_at` (400 `missing_base_updated_at`); the unconditional-upsert SQL branch is gone. The scripts (`import-album-canon.mjs`, `backfill-ratings.mjs`) already send it.
- Write key is now an explicit opt-in switch: `requireWriteKey()` enforces only when `ALBUM_CASE_ENFORCE_WRITE_KEY=1` (plus `ALBUM_CASE_WRITE_KEY`). A stale `ALBUM_CASE_WRITE_KEY` is still set in Vercel production, so the flag (not the key) must be what turns it on; deploying this does NOT change production behavior. To enforce: set the flag, redeploy, open `/#key=<key>` once per device. The client shows a locked banner with an unlock field on 401 and stops retrying.
- Permanent 4xx saves (400, 413, ...) now stop the 4s retry loop and show a "server refused" banner with Export; the next edit retries once. Conflict "Discard" needs two taps. Banner has `role="status"`. Returning to a visible/online tab offers a lossless "Reload" if the server moved on.
- Migrations: `web/api/_migrate.ts` + `web/api/_migrations/` (README has the rules), shared `_ensureSchema.ts` replaced the three duplicated bootstraps. Legacy DBs adopt the baseline with no data change. Production applies pending migrations on the first request after deploy; adds `schema_migrations` table and an index on `discovered_albums(session_id, primary_artist_mbid)`.
- 44px `min-width` on rating/overall buttons; favicon; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` headers in `vercel.json` (no CSP yet).
- Verified (not assumed): the phone candidate card was already sticky, and a 360px drag from the "More ways to rank" handle autoscrolls to a deep row and lands correctly (Playwright, mouse pointer events; a physical-touch check is still open). The Playwright run used a local-Chrome config because the bundled browser is not installed (`npx playwright install` fixes that).
- Not done: splitting `main.ts` (1,783 lines), cover-art/denser mobile rows, per-user sync state and real sign-in (friends rollout), CSP.
- Ask Keith before: committing, `vercel deploy --prod --yes` from `web/`.

## Current task
Browse-by-category views + gap-aware discovery (spec `docs/superpowers/specs/2026-11-07-browse-and-discovery-design.md`), then a UX-teardown fix pass (`docs/superpowers/2026-11-08-ux-teardown.md`). Both shipped.

## Status
- Browse/discovery: merged at 5e389e4, deployed 2026-11-08.
- UX teardown slices 1-4 SHIPPED 2026-11-08 (cc90da8..69a4b25, bundle `assets/index-IKNPecZ4.js` verified live): sticky search chrome (16% of viewport pinned incl. the pill, was 23% with no search access), candidate card collapses to a "Place next:" pill on phones (expand/Hide, state kept across renders), slice headers got a "N unranked picks ↓" jump link (zero picks = direct Find more trigger), Year/Decade browse now chronological newest-first (Artist keeps best-album order), muted/faint ink darkened to 6.0:1 / 5.3:1 (AA) via te-bridge.css overrides. 433 unit tests green.
- Teardown slices 5-6 NOT built (desktop max-width/grid, Want to listen sort+filters); see the teardown doc.
- Vercel CLI note: the project lives under account `k-obrien17` (team keith-obriens-projects), not `eighthchair-8983`. A wrong login 403s on deploy; fix with `vercel login`.
- My list now has List / Artist / Year / Decade / Genre browse chips; year/decade/genre sections open a slice view (rating/overall edits mbid-resolved to global indices, reorder suppressed); artist sections open the existing artist batch view.
- Slice pages show up to 3 unranked candidates (rate-in-place) plus "Find more from <slice>", which constrains the backlog's Suggest one shelf (dismissable "Only <slice> ×" chip).
- `suggestAlbum` gained `sliceFilter` and a bounded gap bonus (N>=20, slice mean>=7.5, share<=5%, max +8, artist excluded).
- Genre backfill COMPLETE: 5,227/5,230 discovered rows have genres; the 3 NULLs are permanent MusicBrainz 404s (deleted release-groups). All 826 ranked albums covered (813 with genres, 13 checked-none). Script `web/scripts/backfill-genres.mjs` stays resumable (`--session/--pool/--limit/--write`, dry run prints remaining NULL count).
- Bootstrap now overlays discovered genres onto seed-pool albums; snapshots self-heal genres on the next save.

## Next concrete step
Keith phone-sessions the shipped teardown fixes (search from depth, pill, slice jump link, chronological years) and reports friction. Remaining queued work, in rough order: teardown slices 5-6 (desktop width, Want to listen sort), gap-bonus shrinkage (Codex finding below), then the still-open product decisions.

## Deferred review minors (ledgered in the final review, workspace since deleted)
- Backfill re-fetches 404'd mbids each rerun; write `[]` on 404 next time the script is touched.
- Backfill duplicates USER_AGENT instead of importing from `web/api/_lp.ts`.
- `groups.ts` More-genres collapse uses a side-effecting filter predicate; fine at this scale.
- ~~True 360px media queries unexercised~~ RESOLVED 2026-11-08: verified with Playwright at 360x740 against production.
- Search/discovery reject release-groups with ANY secondary type (`isAlbumOrEpReleaseGroup`, `web/api/_lp.ts:30`), so soundtrack-typed classics (e.g. Purple Rain, Album+Soundtrack on MB) can't be added via search; Curated lists is the one surface that still carries them. Purple Rain was spliced in directly 2026-11-08 (exact insertAtRating semantics, versioned write). Consider admitting Soundtrack as a sole secondary type in explicit search.

## Codex second-opinion findings (2026-11-08, verified against code)
- ~~Candidate strip invisible in long slices~~ RESOLVED 2026-11-08: jump link shipped (2eaaade).
- Gap bonus has no per-slice minimum count: one 7.5+ album in a niche genre earns ~+7.8 of max +8 (suggestions.ts gapFor). Consider shrinkage like the artist-affinity line (suggestions.ts:124) or scaling the bonus by slice count.
- Gap bonus only rescales candidates already eligible via artist familiarity or related-artist connection; genre alone cannot introduce a candidate (by design, but undocumented).
- "More genres" is a dedup bucket with no per-genre navigation or candidates; expanding it into rare genre names is a smaller fix than any taxonomy work.
- When the first friend account ships, server-enforced ownership must ship with it (write-key is currently a pass-through; see SECURITY.md); session_id can serve as list ID with auth resolving it server-side.

## Still-open product decisions (carried from 2026-10-04 handoff; that handoff's catalog-pipeline state may be stale — cron fixes landed since)
- Redesign decisions (mockup https://claude.ai/artifact/2z3JETpGSYvDYc8AWJMgVT): ranking method, where Want to listen lives, drop drag-reorder, Hide semantics, Voice speed round's fate, default source.
- Agreed order: (1) streamlined Rank screen + listening-history import spec, (2) friend accounts/per-user data last.

## Git state
- Branch: main, pushed through 69a4b25; only this handoff commit may trail origin. Untracked by choice: the two `album-case-backup-*.json` snapshots and `docs/superpowers/2026-11-08-codex-perspective-brief.md` / `2026-11-08-ux-teardown.md` (commit or delete, Keith's call).

## Reason for handoff
Implementation session wrapped: browse/discovery shipped, dedupe done (Ocean Blvd Demos removed, backup `album-case-backup-2026-11-08-pre-dedupe.json`), UX teardown written and its slices 1-4 shipped.

## Updated
2026-11-08
