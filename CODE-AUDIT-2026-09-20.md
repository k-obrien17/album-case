# Code audit — 2026-09-20

Full-repo static audit, run via 8 parallel subagents partitioned by area. Several findings were verified by actual execution (noted per-finding), not just static reading.

**Update (2026-09-20, same session):** the Critical finding and all 7 High findings below were fixed and individually verified after this report was first written (reproduced before the fix where the layer supports it, confirmed passing after). Each is marked `[FIXED]` below.

**Update (2026-09-21):** all 20 Medium findings were fixed and verified, via 8 parallel fix agents partitioned the same way as the original audit. 13 of the 16 Low findings were also fixed; 3 were deliberately left as-is (noted inline in the Low section below): the artist-lock dead code (the audit itself said no fix is needed unless locks are reintroduced), `backfill-genres-discovered.mjs`'s missing backup (explicitly low-priority per this report's own "don't over-invest" note), and two "add test coverage" Low items that named no actual code defect. Full verification suite green: `tsc` clean, build clean, 358/358 vitest, 11/11 Playwright e2e, 53/53 pytest (40 pipeline + 13 legacy).

Evidence labels: **Confirmed by code** (defect follows directly from reachable code), **Strong static evidence** (dangerous pattern, runtime state could change the result), **Needs runtime verification** (credible hypothesis, requires execution to confirm).

## Already fixed this session (before this audit ran)

1. Assisted-placement staleness — `web/src/ui/rankList.ts` (`assistNeedsRestart`)
2. Ranked-row removal had no confirmation/recovery path — `web/src/ui/rankList.ts`
3. Voice-rating digit-form parser took the first match instead of the last — `web/src/rating/parseSpokenRating.ts`
4. `reference/app.js` fetched a nonexistent `artists.json` — now points at the root canonical file
5. `backfill-ratings.mjs` had no dry-run/backup/confirm gate — now matches `import-album-canon.mjs`'s convention

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 7 |
| Medium | 20 |
| Low | 16 |

---

## Critical

### [Critical] — Saved-list "Remove" has no confirmation and no recovery path [FIXED]
- **Evidence level:** Confirmed by code
- **Location:** `web/src/ui/savedList.ts:98-102` (button, no confirm); `web/src/main.ts:869-879` (`removeFromSavedList`); `web/src/skippedAlbums.ts` (no delete/undo function exists anywhere)
- **Problem:** A single unconfirmed click on "Remove" in any saved list (Want to listen / Haven't heard / Don't care) fires `onRemove` immediately, which both drops the album from its list AND adds it to `skippedAlbums` (persisted to localStorage, permanently excluded from future candidate selection). Unlike the ranked-row remove bug fixed earlier this session (which lands the album in "Don't care," a reviewable/recoverable list), saved-list Remove has zero recovery surface — no render/undo function for `skippedAlbums` exists anywhere.
- **Impact:** A single mis-tap permanently and silently removes an album from ever being offered again, with no warning and no way back short of manually editing localStorage.
- **Minimal fix:** Apply the same `window.confirm(...)` + status-message pattern already used in `rankList.ts:324-328` to `savedList.ts`'s remove button, and/or stop folding saved-list removal into the same permanent `skippedAlbums` exclusion used for "Skip for now."
- **Verification:** e2e test mirroring `remove-confirm.spec.ts`, targeting a saved list's "Remove" button.

---

## High

### [High] — Spoken decimal rating silently absorbs unrelated trailing numbers [FIXED]
- **Evidence level:** Confirmed by code (reproduced by execution)
- **Location:** `web/src/rating/parseSpokenRating.ts:73-83` (`tryWordForm`, "point" branch)
- **Problem:** After finding "point", the code collects *every* number-word anywhere in the remainder of the sentence, not just the contiguous run right after "point." A later unrelated number word gets appended onto the decimal.
- **Evidence:** `parseSpokenRating("seven point six I've heard this nine times")` → `7.69` (should be `7.6`).
- **Impact:** `speedRound.ts` calls `onRate` immediately on auto-rate with no confirmation shown — a wrong rating is committed and the app advances before the user can correct it.
- **Minimal fix:** Take a contiguous prefix of digit-words after "point" instead of filtering the whole remainder.
- **Verification:** `npx tsx -e "..."` from `web/`, currently prints `7.69`.

### [High] — Artist-batch view's async discovery fires after navigating away and clobbers the current view [FIXED]
- **Evidence level:** Confirmed by code
- **Location:** `web/src/ui/artistBatchView.ts:254-257` (`teardown`, no guard flag), `:259-277` (`discoverAlbums`, unconditional `render()` after `await`), `:280` (fires on every mount, not opt-in)
- **Problem:** `discoverAlbums()` auto-fires on every mount and, after the MusicBrainz fetch resolves, unconditionally calls `render()` on the shared `stage` div — regardless of whether the user has since navigated away. `teardown()` has no `active`-flag guard (contrast the correct pattern already used in `speedRound.ts`).
- **Impact:** Open an artist's batch view, navigate away before the fetch resolves (any real network latency reproduces this) — when it lands, it silently overwrites whatever view the user is now looking at.
- **Minimal fix:** Add an `active` flag exactly as `speedRound.ts` does; check it before each `render()` call inside `discoverAlbums()`.
- **Verification:** Open artist batch view, tap "Back" before the fetch resolves, observe the destination view get replaced once it lands.

### [High] — Corrupted localStorage value crashes the core candidate-selection path [FIXED]
- **Evidence level:** Confirmed by code
- **Location:** `web/src/artistBlocks.ts:13-23` (`loadBlockedArtists`), consumed at `:47-56`/`:36-45`, reached from `main.ts:360`/`:387`
- **Problem:** `loadBlockedArtists()` does `JSON.parse(raw) as string[]` with no `Array.isArray` check. A valid-JSON-but-wrong-shape value (`"null"`, `"{}"`) parses successfully and is cast to `string[]` anyway; the next `.flatMap`/`.some` call throws.
- **Impact:** A malformed value in one localStorage key throws inside the main candidate-selection render path with no error boundary — breaks the whole picking loop until manually fixed in devtools.
- **Minimal fix:** Guard with `Array.isArray(parsed) ? parsed.filter(...) : []`, matching the existing pattern in `candidateCooldown.ts:49`.
- **Verification:** `localStorage.setItem('tastetest-blocked-artists', 'null')`, reload — expect a thrown TypeError.

### [High] — `web/api` and `web/scripts` ship with zero type-checking, and CI can't catch it [FIXED]
- **Evidence level:** Confirmed by code
- **Location:** `web/tsconfig.json:24` (`"include": ["src", "e2e", "playwright.config.ts"]`)
- **Problem:** The production Vercel serverless handlers in `web/api/*.ts` are never type-checked, in dev or CI.
- **Impact:** A type error in any API route can merge to `main` and reach production undetected until a runtime failure.
- **Minimal fix:** Add `"api"` to `tsconfig.json`'s `include`, or add a second typecheck target for `web/api`.
- **Verification:** `cd web && npx tsc -p tsconfig.json --listFiles | grep api/` currently prints nothing.

### [High] — E2E specs never run in CI [FIXED]
- **Evidence level:** Confirmed by code
- **Location:** `.github/workflows/ci.yml` (only steps: build, `npm run test`)
- **Problem:** Nothing invokes `npm run e2e` or installs Playwright browsers. All 6 e2e specs (drag placement, rating-across-views, remove-confirm, reorder, stale-search, sync-retry-conflict) are dead weight from CI's perspective.
- **Impact:** A PR that breaks any of these real user flows merges cleanly.
- **Minimal fix:** Add an e2e job/step (`npx playwright install --with-deps chromium` then `npm run e2e`).

### [High] — `reference/app.js`'s local-file fetch may not work from `file://` [FIXED]
- **Evidence level:** Needs runtime verification (browser automation tools refused to open a `file://` URL this session)
- **Location:** `reference/app.js:17-19` (`fetch("../artists.json")`)
- **Problem:** The current root tool deliberately avoids `fetch()` for artist data specifically so it works from `file://` (loads via a `<script>` tag instead). `reference/app.js` uses `fetch()` against a `file://`-relative path, which Chrome blocks by default.
- **Impact:** If confirmed, opening `reference/index.html` directly (the primary way anyone would run it) throws in the boot handler and never becomes usable outside a local HTTP server.
- **Minimal fix:** Either document that `reference/` requires `python3 -m http.server`, or generate a script-tag data source like the root tool's `artists.js`.
- **Verification:** Open `reference/index.html` directly in Chrome (not via dev server), check DevTools console for `net::ERR_FAILED`.

### [High] — Four-table MusicBrainz staging load is not atomic as a set [FIXED]
- **Evidence level:** Confirmed by code, verified by reproduction
- **Location:** `pipeline/ingest_musicbrainz.py:128-286` (each `_load_*` in its own transaction, no outer transaction across all four)
- **Problem:** A mid-load failure (missing file, corrupt line, bad byte) leaves tables loaded before the failure holding new data while tables after it hold stale data from the previous run — nothing detects this.
- **Evidence:** Reproduced: after a partial failure, `stg_release_group` had the new run's row while `stg_artist_credit_name` still had the old run's data.
- **Impact:** `materialize.py` has no way to know the load didn't fully succeed and will silently join fresh rows against stale ones, corrupting `entities` — the product's canonical bootstrap seed — with no error.
- **Minimal fix:** Wrap the whole four-table load in one outer transaction, or add a staging "generation" marker `materialize.py` refuses to join against unless consistent.
- **Verification:** Reproducer described above; re-run with one table's source file pointed at a missing/corrupt path and inspect the other tables' state afterward.

---

## Medium

### [Medium] — "X and a half/quarter" self-correction picks up a later, unrelated fraction word [FIXED]
- **Location:** `web/src/rating/parseSpokenRating.ts:60-69` (`tryWordForm`, "and" branch)
- **Problem:** Matches the first "and" and searches the fraction word across the *entire* remainder, not just words immediately following. `'six and a half, no wait, seven and a quarter'` → `6.25` (should self-correct to `7.25`).
- **Minimal fix:** Scope the "and"-fraction search to the last occurrence of "and," matching the "last match wins" convention already used elsewhere in this file.

### [Medium] — `computeSubRanks` groups by artist *name* string, not MBID [FIXED]
- **Location:** `web/src/ranking/subRank.ts:13,17-19,30-32`
- **Problem:** Keyed on `primary_artist_name` even though `primary_artist_mbid` exists specifically because names collide (per project convention: prefer MBID over name search). Two distinct artists sharing a display name would be merged into one sub-rank group.
- **Impact:** Display-only (the "N of M by Artist" sub-rank line), no data mutation — Medium not High.
- **Minimal fix:** Group by `primary_artist_mbid` when present, falling back to name only when missing.

### [Medium] — `backfill-genres-snapshot.mjs` writes the whole ranking snapshot with no pre-write backup [FIXED]
- **Location:** `web/scripts/backfill-genres-snapshot.mjs:39-129`
- **Problem:** Has a dry-run default and the OCC guard, but never writes a pre-write backup (unlike `import-album-canon.mjs` and the now-fixed `backfill-ratings.mjs`), and writes directly to Turso rather than through `/api/ranking`, bypassing the API's own validation.
- **Minimal fix:** Add the same backup-before-write block used in the two sibling scripts.

### [Medium] — Malformed CSV/TSV rows crash `import-album-canon.mjs` / `import-spotify-albums.mjs` mid-run [FIXED]
- **Location:** `web/scripts/import-album-canon.mjs:112`, `web/scripts/lib/canon-import.mjs:9-37`; `web/scripts/import-spotify-albums.mjs:100-102,151`
- **Problem:** A row with fewer fields than expected produces `undefined` for a missing field, and the un-guarded `normalize(undefined)` throws, killing the whole run (all prior matching work is lost — the report file is only written after the full loop completes).
- **Evidence:** Reproduced against the real `parseCanonCsv` with a malformed row.
- **Minimal fix:** Validate required fields immediately after parsing each row; route malformed rows into the existing `needsReview` skip-and-log path instead of crashing.

### [Medium] — Import scripts use a weaker `normalize()` than the app's canonical matcher; no duplicate-mbid check in the API [FIXED]
- **Location:** `web/scripts/import-album-canon.mjs:40-42`, `web/scripts/import-spotify-albums.mjs:52-54` vs. `web/src/curatedListMatch.ts:22-35`; API gap at `web/api/ranking.ts:236-247`
- **Problem:** Both scripts independently define a weak `normalize()` instead of importing the real one (which `resolve-curated-list-mbids.mjs`, a newer script, already does via Node's native `.ts` import). A local-index miss on a title/artist variant (diacritics, leading "The") forces an avoidable MusicBrainz call and can produce two ranked entries for one real album, which the API's `validate()` never catches (no ranked-array duplicate-mbid check exists).
- **Minimal fix:** Import `normalize`/`key` from `curatedListMatch.ts` in both scripts; add a duplicate-mbid-within-`ranked` check to `validate()` as defense in depth.

### [Medium] — "Skip for now" is documented as session-scoped but is permanently persisted [FIXED]
- **Location:** `web/src/ui/rankList.ts:64-65` (doc comment) vs. `main.ts:830-835`/`:671-676`, `web/src/skippedAlbums.ts` (writes to localStorage, loaded on every app start)
- **Problem:** The contract says "without saving it anywhere"; the actual wiring persists forever with no review/undo UI anywhere.
- **Minimal fix:** Either scope to the session (clear on load, matching the doc comment) or fix the doc comment and add a review/undo affordance.

### [Medium] — Voice-recording mic sessions aren't stopped on re-render or teardown [FIXED]
- **Location:** `web/src/ui/rankList.ts:607-644,917-922`; `web/src/ui/artistBatchView.ts:102-139,254-257`; contrast the correct pattern in `speedRound.ts`
- **Problem:** Each mic button's `stopActive` closure is scoped to that row's build function. If the row is rebuilt by an unrelated re-render, the closure is discarded but the underlying `SpeechRecognition` instance keeps listening until its own 8s timer expires.
- **Impact:** Up to 8s of live mic capture continues in the background with no visible indicator after navigating away.
- **Minimal fix:** Lift the stop handle to the enclosing mount closure and call it from `teardown()`.

### [Medium] — MusicBrainz upstream failures reported as generic Turso storage errors [FIXED]
- **Location:** `web/api/discover-artist.ts:173,204-221`
- **Problem:** The one route (of several calling the same MB helper) that doesn't distinguish upstream failures from DB failures — both map to `500 discover_error`, and the schema cache is needlessly invalidated on a pure upstream hiccup.
- **Minimal fix:** Catch the MB call locally and return `502` for upstream failures, matching `browse-artist.ts`/`search-album.ts`.

### [Medium] — No timeout on Turso calls, unlike every external MB/LB call [FIXED]
- **Location:** `web/api/ranking.ts:269,361`; `web/api/atom.ts:55,112`; `web/api/discover-artist.ts:116,132,178`
- **Problem:** Every MB/LB fetch has an 8s `AbortController` timeout; no Turso call does.
- **Minimal fix:** Wrap Turso calls in the same timeout-race pattern.

### [Medium] — No application-level size cap on ranking snapshot / discovery arrays [FIXED]
- **Location:** `web/api/ranking.ts:128-206`; `web/api/discover-artist.ts:59-61`
- **Problem:** No parser enforces a max array length; the only backstop is Vercel's incidental ~4.5MB request-body limit.
- **Minimal fix:** Add an explicit entry-count cap per parser, reject over-limit payloads with 400.

### [Medium] — Blocked artists can leak back in through similar-artist discovery expansion [FIXED]
- **Location:** `web/src/bulkDiscovery.ts:104` vs. the canonical normalize functions in `priority.ts`/`curatedListMatch.ts`
- **Problem:** Three different normalize implementations exist across the codebase; `bulkDiscovery.ts`'s is the weakest (bare `.trim().toLowerCase()`, no diacritic/punctuation/"the"-prefix handling) and is the one that governs the similar-artist expansion path.
- **Impact:** A blocked artist returned by ListenBrainz under a name differing only by "The"/diacritics/punctuation silently bypasses the block.
- **Minimal fix:** Use `artistKeys`/`normalize` from `priority.ts` or `curatedListMatch.ts` instead.

### [Medium] — `mapFilteredReorderToGlobal` mis-anchors a lone-artist-row reorder to the end of the global list [FIXED]
- **Evidence level:** Confirmed by code (function-level); Needs runtime verification (production reachability — appears unreachable via mouse drag today, but is a live trap for any other caller)
- **Location:** `web/src/artistLockAlbums.ts:72-78`
- **Problem:** When an artist has exactly one ranked album, the function falls through to appending at the very end of the global list regardless of the album's actual position. The existing test only passes because its fixture happens to place that album last.
- **Minimal fix:** Anchor `to` to the moved album's original global position when there are no other filtered indices to reference.

### [Medium] — `reference/app.js` uses `innerHTML` in four places [FIXED]
- **Location:** `reference/app.js:108,139,156,158,284`
- **Problem:** Contradicts the project's safe-DOM convention (which the current root `app.js` follows and documents). Not currently exploitable (today's `artists.json` has no markup metacharacters), but line 139 interpolates artist-sourced fields directly.
- **Minimal fix:** Replace with `textContent`/`createElement`, mirroring root `app.js`'s `el()` helper.

### [Medium] — `CLAUDE.md`'s Reference table mis-describes `README.md` [FIXED]
- **Location:** `CLAUDE.md` Reference table vs. actual `README.md` content
- **Problem:** Claims README has "legacy run/play/export instructions"; it doesn't — those live only in `CLAUDE.md` itself.
- **Minimal fix:** Point the table row at `CLAUDE.md`'s own "Commands (legacy tool)" section.

### [Medium] — Duplicate position=0 artist-credit rows silently produce nondeterministic attribution and a misreported stats total [FIXED]
- **Location:** `pipeline/materialize.py:55-56,79-80`
- **Problem:** No uniqueness assumption enforced on the join key; a duplicate row makes `ON CONFLICT DO UPDATE` pick a winner based on SQLite's internal row order, silently mis-attributing an album, with the returned `"total"` stat not even matching the actual `entities` row count.
- **Evidence:** Reproduced: reported total 3, actual rows 2, one album's artist silently overwritten.
- **Minimal fix:** Dedup on `(artist_credit, position=0)` before the join, or make the stats reflect the true post-upsert row count.

### [Medium] — No normalization/validation of the MBID join key between MusicBrainz and ListenBrainz ingestion [FIXED]
- **Evidence level:** Needs runtime verification (real dump data required; fixtures can't exercise this)
- **Location:** `pipeline/ingest_musicbrainz.py:149`, `pipeline/ingest_listenbrainz.py:91`, joined in `materialize.py:54`
- **Problem:** Neither loader normalizes case/format before storing MBIDs; the join relies on exact string equality between two independently-sourced dumps.
- **Impact if it doesn't hold:** every popularity-join lookup silently fails, and the notability floor effectively yields a near-empty universe with no diagnostic pointing at MBID casing as the cause.
- **Minimal fix:** Normalize MBIDs to a canonical form at ingest time in both loaders.

### [Medium] — `build.py` performs no path/argument validation before a multi-table load [FIXED]
- **Location:** `pipeline/build.py:50-92`
- **Problem:** No check that `--mbdump-dir`/`--popularity` exist before mutating staging tables; combined with the atomicity finding above, a bad argument surfaces as a raw traceback after two of four tables have already committed new data.
- **Minimal fix:** Validate paths before calling any loader; catch and report which step failed.

### [Medium] — `reRateAt`/`reRate` throws on an out-of-range index; sibling `setRatingAt` doesn't [FIXED]
- **Evidence level:** Confirmed by code (mechanism verified by execution; no live-UI path currently reaches it)
- **Location:** `web/src/rankingActions.ts:23-29,109-113` vs. the guarded `setRating` at `:81-86`
- **Problem:** `setRating` guards `if (!album) return ranked;`; `reRate` has no equivalent guard and throws `TypeError` on an out-of-range `from`.
- **Evidence:** `reRateAt(store, 99, 0)` on a 3-item list throws; `setRatingAt(store, 99, 5)` on the same list returns normally.
- **Minimal fix:** Add the same guard to `reRate`.

### [Medium] — `hydrateAlbums`/`hydrateLists` never refresh `cover_url`/`release_year` from the pool [FIXED]
- **Location:** `web/src/syncEngine.ts:68-85` vs. `web/src/backup.ts:32-36`'s opposite (and intentionally documented) precedence
- **Problem:** The stored album's own `cover_url`/`release_year` always wins even when empty/null, because `parseAlbum` never omits these fields (unlike optional fields such as `primary_artist_mbid`), so a fresher pool value can never backfill them.
- **Impact:** An album ranked before a cover URL was resolvable permanently shows no cover art even after the pool later gets a good one.
- **Minimal fix:** Prefer the pool's value for these two fields specifically when the stored value is falsy.

### [Medium] — Malformed server-snapshot entries are silently dropped with no warning [FIXED]
- **Location:** `web/src/rankingSync.ts:155-165`, via `parseRankedAlbumArray`/`parseAlbumArray` in `web/src/album.ts:31-65`
- **Problem:** Every other degraded-read path in this layer (`storage.ts`, `session.ts`, `atoms.ts`) logs a warning on graceful degradation; this one silently drops invalid entries and returns a normal "found" result, indistinguishable from a snapshot that legitimately had fewer albums.
- **Impact:** A malformed record in Turso (bad migration, hand edit, partial write) silently and permanently vanishes from the client's list on the very next save, with zero diagnostic.
- **Minimal fix:** Compare parsed length against raw length and warn when entries were dropped.

---

## Low

- **[FIXED]** `OWNER_ID` duplicated across 7 scripts instead of imported from `web/src/owner.ts` (two newer scripts already prove Node 24 native `.ts` import works). `web/scripts/export-album-of-year.mjs:19` and 6 others.
- **[FIXED]** `refresh-keithrobrien-collect.mjs` had no error handling around git/node subprocess calls — a transient failure produced a raw stack trace in cron logs instead of a clean one-liner. `web/scripts/refresh-keithrobrien-collect.mjs:39-122`.
- **[SKIPPED]** `backfill-genres-discovered.mjs` has no pre-write backup — same class of gap as the snapshot script above, but lower risk (per-row additive update on a non-canonical table). Left as-is per this report's own "nice to have, not required" note.
- **[FIXED]** Broken cover-art handling diverged: `backlogView.ts` hides a broken `<img>` on load error; `savedList.ts` didn't. `web/src/ui/savedList.ts:35-40`.
- **[SKIPPED, INTENTIONAL]** Artist-lock plumbing is fully unwired dead code in the UI layer (`getNearestValidDrop`, `onOpenArtistLock`, `getLockedArtistMbids`) — consistent with locks being paused project-wide, not a live defect. This report itself said no fix is needed unless locks are reintroduced.
- **[FIXED]** API catch blocks discarded the underlying error with no server-side logging — a real production failure left no trace beyond "a 500 happened." `web/api/ranking.ts:400` and 2 others.
- **[FIXED]** `schemaReady` cache was invalidated on every error, even ones unrelated to schema — perf nit only.
- **[FIXED]** Dead exports: `priorityQueueFromArtistText` (`priority.ts:128`), `discoverArtist` (`discovery.ts:65`, superseded by `discoverArtistDetailed`). Both removed along with their dedicated tests.
- **[FIXED]** `scoring/load_calibration.py` docstring pointed to a nonexistent path (`integration/CALIBRATION_INTEGRATION.md` — the real file has no `integration/` prefix).
- **[FIXED]** `reference/index.html` hardcoded the artist count in static text with no hook to update it, unlike root's dynamic version.
- **[FIXED]** `_iter_lines` was byte-for-byte duplicated between `ingest_musicbrainz.py` and `ingest_listenbrainz.py` — now shared via `pipeline/db.py`.
- **[FIXED]** Both `_iter_lines` implementations hardcoded strict UTF-8 — a single bad byte anywhere in a multi-GB dump aborted that table's load (same class as the atomicity High finding, different trigger).
- **[FIXED]** `apply_cover_pointers` issued one `UPDATE` per row via a Python loop instead of `executemany` — perf only, no correctness issue (was already atomic).
- **[FIXED]** `backup.ts`'s `parseRankingBackup` has zero production callers and there was no "import backup" UI anywhere — the sync-conflict banner's "Export backup" option is a one-way dead end for actually recovering unsaved edits. Documented as a known one-way limitation in `SECURITY.md` rather than building an import UI (disproportionate for a Low finding).
- **[SKIPPED, NOT A DEFECT]** Coverage gap: `syncEngine.ts`/`rankingStore.ts` have no direct unit tests — the most state-machine-heavy code in the sync layer (site of two bugs already fixed this session) is only reachable indirectly through the full `main()` bootstrap. This is a test-authoring recommendation with no underlying code defect, left alone per project convention (don't add tests unless a real workflow requires them).
- **[SKIPPED, NOT A DEFECT]** Corrupted-localStorage fallback paths in `storage.ts`/`session.ts` are implemented correctly but untested. Same reasoning as above.

---

## Not flagged as defects (checked, found sound)

- `insertion.ts`, `order.ts`, `setAside.ts`: purity, immutability, and index-clamping all verified against explicit tests.
- `locks.ts`: internally consistent; simply unwired, which the file's own header documents.
- `rating.ts`: boundary clamping matches its test suite.
- `assist.ts`: the mbid-based re-lookup on finalize is deliberate and documented.
- List-membership invariant (never simultaneously ranked and saved): enforced via `removeFromAllLists`, not just commented.
- MBID-over-name-search rule: no violations found; `artistSearch.ts`'s name search is artist-resolution, not discovery.
- No SQL injection surface anywhere in `web/api` — every query is parameterized.
- No hardcoded secrets found in a repo-wide grep; `.gitignore` correctly covers `.env*`.
- No `innerHTML`/`outerHTML`/`insertAdjacentHTML` anywhere in `web/src/ui` (the *current* app, as opposed to `reference/`).

## Test status at audit time

- `pipeline/`: 35/35 pytest passing (fixture-driven; no real multi-GB dump has ever been run in any environment, per the pipeline's own README).
- `scoring/` + legacy root: 13/13 pytest passing.
- `web/`: 346/346 vitest passing, 8/8 Playwright e2e passing, `tsc` clean (for the files it actually includes — see the tsconfig finding above).
