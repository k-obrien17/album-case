# Browse-by-Category Views and Gap-Aware Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the ranked list by artist/year/decade/genre with per-slice pages that also surface unranked candidates, backed by a genre backfill and a gap-aware suggestion bonus.

**Architecture:** A new pure grouping module (`web/src/ranking/groups.ts`) projects the ranked array into sections; new UI modules render section headers and slice pages on top of the existing filtered-`rankList` machinery (the `artistBatchView.ts` pattern). Genres arrive via a resumable offline script writing `discovered_albums.genres_json`, merged client-side through the existing pool hydration. Discovery changes are confined to `suggestions.ts` (a `sliceFilter` option and a bounded gap bonus).

**Tech Stack:** Vite 8 + TypeScript 6, Vitest, Vercel serverless (`@vercel/node` 3), Turso (`@libsql/client` 0.14), Node `.mjs` operational scripts.

**Spec:** `docs/superpowers/specs/2026-11-07-browse-and-discovery-design.md`

## Global Constraints

- Mobile first: usable at 360 px, tap targets >= 44 px, no horizontal scroll.
- Safe DOM construction (`createElement`/`textContent`), never `innerHTML`.
- Never hand-edit `te-tokens.css`; app styles go in `web/src/style.css`, brand overrides in `te-bridge.css`.
- Rating is the single source of truth for position. Slice/section ordering is always global rating order restricted to the slice; no per-view sorting. No Elo, no append-then-sort (splice via `insertAtRating`).
- Nothing new keys to the fixed owner id: new modules take data as parameters; the script takes `--session` (default `OWNER_ID` from `web/src/owner.ts`).
- MusicBrainz: max 1 request/second, offline script only, never at request time.
- Tests are colocated `*.test.ts`, run with `cd web && npm run test`. Build check: `cd web && npm run build`.
- Commits: Conventional Commits, each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never push or deploy without being asked.

## Review Focus

1. Empty ranked list: every browse dimension must render the existing empty-list message, never a blank screen (pinned in Task 1 and Task 3 tests).
2. `release_year: null` albums: year and decade views must collect them in a trailing "Year unknown" section, not crash or drop them (Task 1 test).
3. Rating-edit ties from a slice view: editing a rating from a filtered slice must land identically to the flat list, including when the new rating equals an incumbent's (mbid-resolved global index; Task 4 test).
4. Genre slice with zero genre-tagged candidates: the candidate strip must show the no-match message, never a blank strip or a non-genre album (Task 7 and Task 8 tests).
5. Backfill rerun after interruption: a rerun must not re-fetch mbids already written (including `[]` sentinels) and must not duplicate `discovered_albums` rows (Task 6 dry-run verification steps).

---

### Task 1: Pure grouping module `groups.ts`

**Files:**
- Create: `web/src/ranking/groups.ts`
- Test: `web/src/ranking/groups.test.ts`

**Interfaces:**
- Consumes: `RankedAlbum` from `web/src/ranking/types.ts`; the artist-key rule from `subRank.ts` (`primary_artist_mbid ?? primary_artist_name`).
- Produces (later tasks rely on these exact names):

```ts
export type GroupDimension = 'artist' | 'year' | 'decade' | 'genre';
export type RankedSection = {
  key: string;            // 'artist:<mbid|name>' | 'year:1994' | 'year:unknown'
                          // | 'decade:1990' | 'genre:<name>' | 'genre:more' | 'genre:none'
  label: string;          // 'Radiohead' | '1994' | 'Year unknown' | '1990s'
                          // | 'shoegaze' | 'More genres' | 'No genre yet'
  albums: RankedAlbum[];  // global rating order preserved
  count: number;          // albums.length
  meanRating: number;     // unrounded arithmetic mean
};
export function groupRanked(ranked: RankedAlbum[], dimension: GroupDimension): RankedSection[];
```

Rules the tests pin:
- Artist key/grouping identical to `subRank.ts`'s `artistGroupKey`. Decade = `Math.floor(year / 10) * 10`, label `` `${decade}s` ``.
- Section order for artist/year/decade: by global rank of each section's best album, ascending. Null-year albums go to one trailing `year:unknown` section (year and decade dimensions both).
- Genre dimension only: an album with N genres appears in N sections; sections sort by count descending (ties alphabetical by label); genres with exactly one album collapse into a single trailing `genre:more` section (albums deduped by mbid, global order); albums with no genres go to a final `genre:none` section. Order: multi-album genres, then `genre:more`, then `genre:none`.
- `groupRanked([], d)` returns `[]` for every dimension.

- [ ] **Step 1: Write the failing tests** in `web/src/ranking/groups.test.ts`, following `subRank.test.ts` fixture style. Required cases (exact assertions):
  - `groups by decade with best-album section order`: three albums rated 9.5/9.0/8.0 with years 1994, 2001, 1991 → sections `['decade:1990', 'decade:2000']`, first section albums `[a1994, a1991]`, `count: 2`, `meanRating: 8.75`.
  - `null year lands in trailing unknown section`: last section key `'year:unknown'`, label `'Year unknown'` (assert for both `'year'` and `'decade'` dimensions).
  - `genre sections sort by count and collapse singletons`: albums with genres `['rock','shoegaze']`, `['rock']`, `['ambient']`, and one with none → section keys exactly `['genre:rock', 'genre:more', 'genre:none']`, and the `genre:more` section contains the ambient album.
  - `multi-genre album appears in each of its sections` (use two 2-album genres so neither collapses).
  - `empty input returns no sections` for all four dimensions.
- [ ] **Step 2: Run to verify failure.** `cd web && npx vitest run src/ranking/groups.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement `groupRanked` in `web/src/ranking/groups.ts`.** No DOM, no imports beyond types (copy the two-line artist-key rule from `subRank.ts` rather than exporting it, matching that file's local style).
- [ ] **Step 4: Run to verify pass.** Same command — PASS. Then `npm run test` for the full suite.
- [ ] **Step 5: Commit.** `feat(web): add ranked-list grouping module for browse views`

### Task 2: `suppressReorder` option on `rankList`

**Files:**
- Modify: `web/src/ui/rankList.ts` (options type ~line 29-135; `render()`'s `filtered` computation ~line 851; `buildRow` call sites)
- Test: `web/src/ui/rankList.suppressReorder.test.ts`

**Interfaces:**
- Produces: `RankListOptions.suppressReorder?: boolean` — when true, rows render exactly as the search-filtered mode renders them (no drag grips, no candidate column, drop-index machinery off) while the mbid-resolved rating and overall-rank editors stay active. Search-specific chrome (the "Matches" section label, MusicBrainz fallback prompt) remains driven only by a non-empty query.

- [ ] **Step 1: Write the failing test.** Mount via `mountRankList` (fixture style from `rankList.assist.test.ts`) with `suppressReorder: true`, three ranked albums, `onSetRating` spy:
  - no element matching the row grip selector used by `rankListDrag` exists;
  - the per-row rating editor still exists and submitting a new value calls `onSetRating` with the row's global index;
  - no search-section label element is rendered.
- [ ] **Step 2: Run to verify failure.** `cd web && npx vitest run src/ui/rankList.suppressReorder.test.ts` — FAIL (option has no effect).
- [ ] **Step 3: Implement.** In `render()`, change the row-mode computation to `const filtered = query.trim() !== '' || opts.suppressReorder === true;` and audit each use of `filtered` below it: uses that gate grips/candidate/drop-index keep using the combined flag; uses that gate search chrome switch to a separate `const searching = query.trim() !== ''`.
- [ ] **Step 4: Run to verify pass**, plus the existing `rankList.assist.test.ts` and full `npm run test`.
- [ ] **Step 5: Commit.** `feat(web): add suppressReorder mode to rankList for slice views`

### Task 3: Browse control and section list in the ranked view

**Files:**
- Create: `web/src/ui/browseView.ts`
- Modify: `web/src/main.ts` (the `view === 'ranked'` branch of `showView` ~line 1383; a new `renderRankedView()`), `web/src/style.css`
- Test: `web/src/ui/browseView.test.ts`

**Interfaces:**
- Consumes: `groupRanked`, `GroupDimension`, `RankedSection` (Task 1).
- Produces:

```ts
// browseView.ts
export type BrowseViewOptions = {
  dimension: GroupDimension;
  sections: RankedSection[];
  onOpenSection: (section: RankedSection) => void;
};
export function renderBrowseView(container: HTMLElement, opts: BrowseViewOptions): void;
```

```ts
// main.ts (module-level inside main())
let browseDimension: 'list' | GroupDimension = 'list';
function renderRankedView(): void; // renders the dimension control, then either rankList.render() or renderBrowseView
```

- [ ] **Step 1: Write the failing test** for `renderBrowseView`: given two sections, renders one button per section whose text contains the label, the count, and the mean rating formatted to 2 decimals (e.g. `1990s · 12 albums · avg 7.43`); clicking the first button calls `onOpenSection` with that section; given `sections: []`, renders a paragraph (any non-empty message), not an empty container.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `renderBrowseView`.** One `<button class="browse-section">` per section (min-height 44 px via style.css), safe DOM only.
- [ ] **Step 4: Wire into `main.ts`.** Replace the bare `rankList.render()` call in `showView`'s `'ranked'` branch with `renderRankedView()`, which: renders a 5-chip control (List / Artist / Year / Decade / Genre, reusing the `view-filter` chip classes) into the stage, sets `browseDimension`, and below it either calls `rankList.render()` (List) or `renderBrowseView` with `groupRanked(rankingStore.getState().ranked, browseDimension)`. `onOpenSection`: for `dimension === 'artist'`, call the existing artist-batch open path (the handler feeding `mountArtistBatchView`, main.ts ~line 443) with the section's first album; other dimensions are a no-op until Task 4 (leave a `// Task 4` note).
- [ ] **Step 5: Verify manually.** `cd web && npm run dev` — at 360 px: chips don't overflow horizontally, Artist/Year/Decade/Genre views render sections, Artist sections open the batch view, Genre shows the "No genre yet" bucket.
- [ ] **Step 6: Run full tests and build.** `npm run test && npm run build`.
- [ ] **Step 7: Commit.** `feat(web): browse ranked list by artist, year, decade, and genre`

### Task 4: Slice view for year/decade/genre sections

**Files:**
- Create: `web/src/ui/sliceView.ts`
- Modify: `web/src/main.ts` (`ViewMode` union ~line 61, `showView` branches, slice state)
- Test: `web/src/ui/sliceView.test.ts`

**Interfaces:**
- Consumes: `mountRankList` with `suppressReorder` (Task 2), `RankedSection` keys (Task 1).
- Produces:

```ts
// sliceView.ts
export type SliceViewOptions = {
  label: string;                                  // section label, used in the heading
  getRanked: () => RankedAlbum[];                 // full global array
  getSliceAlbums: () => RankedAlbum[];            // filtered, global order
  onSetRating: (from: number, rating: number) => void;      // global index
  onSetOverallRank: (from: number, to: number) => void;     // global index
  onRemoveRanked: (album: Album) => void;
  onUndoRemove: () => void;
  onClose: () => void;
};
export function mountSliceView(container: HTMLElement, opts: SliceViewOptions):
  { render: () => void; teardown: () => void };
```

```ts
// main.ts
type ViewMode = /* existing */ | 'slice';
let sliceState: { dimension: GroupDimension; key: string; label: string } | null = null;
function sliceAlbumsFor(key: string, ranked: RankedAlbum[]): RankedAlbum[]; // resolves a section key back to its albums via groupRanked
```

- [ ] **Step 1: Write the failing tests** for `mountSliceView`:
  - renders a Back button (calls `onClose`) and a heading containing `label`;
  - renders the slice's rows through `rankList` with no grips (reuse Task 2's selector assertion);
  - `rating edit resolves ties against the global list`: global list `[A:9.0, B:8.5, C:8.5, D:7.0]`, slice `[B, D]`; submitting rating `8.5` on D's row calls `onSetRating(3, 8.5)` (D's global index), not a slice-local index.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `mountSliceView`** on the `artistBatchView.ts` skeleton (header + back + inner `mountRankList`), passing `getRanked: opts.getSliceAlbums`, `getGlobalRanked: opts.getRanked`, `suppressReorder: true`, `hideCandidateColumn: true`, and no-op `onPlace`/`onSetAside`/`onSkip`/`onBlockArtist`.
- [ ] **Step 4: Wire into `main.ts`.** Add `'slice'` to `ViewMode`; `showView('slice')` mounts a fresh slice view (teardown pattern as `artistBatchController`); Task 3's `onOpenSection` for year/decade/genre sets `sliceState` and calls `showView('slice')`; `onClose` returns to `showView('ranked')` (Browse re-renders with the preserved `browseDimension`). `sliceAlbumsFor` re-runs `groupRanked` and picks the section by `key` (falling back to `onClose` behavior if the key no longer exists).
- [ ] **Step 5: Run full tests, build, and manual check** (open a decade slice at 360 px, edit a rating, confirm the flat list shows the album moved).
- [ ] **Step 6: Commit.** `feat(web): per-slice ranked view for year, decade, and genre sections`

### Task 5: Bootstrap genre overlay

**Files:**
- Modify: `web/src/bootstrap.ts` (discovered-merge loop, ~lines 122-129)
- Test: `web/src/bootstrap.test.ts` (existing file; add cases)

**Interfaces:**
- Consumes: nothing new. Produces: no signature change — behavior only. Later tasks rely on pool records carrying `genres` whenever a matching `discovered_albums` row has them.

- [ ] **Step 1: Write the failing test:** bootstrap with a seed-pool album (no `genres`) and a discovered row for the same mbid carrying `genres: ['shoegaze']` → the returned `pool` entry for that mbid has `genres: ['shoegaze']`. Second case: pool album that already has genres keeps its own when the discovered row differs.
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/bootstrap.test.ts`.
- [ ] **Step 3: Implement:** in the merge loop, when `knownPoolIds.has(album.mbid)`, overlay `genres` onto the pool record only if the pool record has none (requires a `Map` of pool by mbid built before the loop; the later `poolById` can reuse it).
- [ ] **Step 4: Run to verify pass**, then full suite.
- [ ] **Step 5: Commit.** `fix(web): overlay discovered genres onto seed-pool albums at bootstrap`

### Task 6: Genre backfill script

**Files:**
- Create: `web/scripts/backfill-genres.mjs`
- Modify: `web/api/_lp.ts` (export `topGenres` if not already exported)

**Interfaces:**
- Consumes: `OWNER_ID` from `web/src/owner.ts`, `topGenres` from `web/api/_lp.ts`, Turso env credentials, usage conventions from `import-spotify-albums.mjs` (header comment, `--write` gate, `createClient`).
- Produces: `discovered_albums.genres_json` populated; `[]` written for release-groups MusicBrainz has no genres for ("checked, none").

Usage (goes in the header comment):
```
node --env-file=web/.env.local web/scripts/backfill-genres.mjs [--write] [--session <id>] [--pool]
```

- [ ] **Step 1: Implement the script.**
  - Collect targets: `discovered_albums` rows for the session where `genres_json IS NULL`; plus ranked-snapshot mbids with no `discovered_albums` row (insert rows for them, same column shape as `import-spotify-albums.mjs`); with `--pool`, also mbids from `web/public/seed/albums.json` with no row.
  - For each target: GET `https://musicbrainz.org/ws/2/release-group/<mbid>?inc=genres&fmt=json` with the same User-Agent string `discover-artist.ts`/`_lp.ts` uses, one request per 1100 ms; apply `topGenres`; write `genres_json` (`[]` when empty). 404/network errors: log and skip, leave NULL so a rerun retries.
  - Without `--write`: fetch nothing, print the target count per source (discovered / ranked-missing / pool) and exit.
  - Progress line per write to stdout.
- [ ] **Step 2: Verify dry-run.** `node --env-file=web/.env.local web/scripts/backfill-genres.mjs` — prints counts, touches nothing (confirm `discovered_albums` unchanged via a count query).
- [ ] **Step 3: Verify resume semantics.** Run with `--write` against the default session; interrupt after ~20 writes (Ctrl-C); rerun and confirm the log shows it skipping already-written mbids (including any `[]`) and the final row count has no mbid duplicated per session.
- [ ] **Step 4: Verify in the app.** `npm run dev`, open Browse → Genre: previously ranked albums now populate real genre sections (Task 5's overlay + existing `hydrateAlbums` does the merge).
- [ ] **Step 5: Commit.** `feat(scripts): resumable MusicBrainz genre backfill for discovered albums`

### Task 7: `sliceFilter` and gap bonus in the suggestion engine

**Files:**
- Modify: `web/src/suggestions.ts`
- Test: `web/src/suggestions.test.ts` (existing file; add cases)

**Interfaces:**
- Consumes: `SuggestionOptions`, `suggestAlbum` as they exist.
- Produces:

```ts
export type SliceFilter =
  | { dimension: 'year'; year: number }
  | { dimension: 'decade'; decade: number }   // 1990 covers 1990-1999
  | { dimension: 'genre'; genre: string };
// SuggestionOptions gains: sliceFilter?: SliceFilter
```

Pinned behavior:
- `sliceFilter` excludes non-matching candidates before scoring (a year filter needs `release_year === year`; decade needs the year's decade to match; genre needs `album.genres` to include the genre, so untagged candidates never match a genre slice). With a filter active, the familiar/discovery turn scheduling still applies within the matching set, and no match returns `null` (existing fallback messaging handles it).
- Gap bonus (no filter required; applies to every scored candidate): let `N` = ranked count, and for the candidate's decade and each of its genres compute slice count `n` and slice mean `m` over the ranked list. A slice is a gap when `N >= 20`, `m >= 7.5`, and `n / N <= 0.05`. Bonus = `8 * (1 - (n / N) / 0.05)` for the strongest qualifying slice only (no stacking), added to `score`. When the bonus fires, append to `reason`: `` `You rate ${label} ${m.toFixed(1)} on average but have only ranked ${n} ${label} album${n === 1 ? '' : 's'}.` `` where label is the genre name or `` `${decade}s` ``. Artist is deliberately out of scope (spec).

- [ ] **Step 1: Write the failing tests:**
  - `genre sliceFilter excludes untagged candidates`: pool of one tagged match and one untagged album → suggestion is the tagged one; pool of only untagged → `null`.
  - `decade sliceFilter matches by year range`: candidate with `release_year: 1994` matches `{ dimension: 'decade', decade: 1990 }`, one with 2001 does not.
  - `gap bonus fires and names the gap`: ranked list of 25 albums where exactly 1 is `['shoegaze']` with rating 8.0 (slice mean 8.0, share 0.04, bonus 1.6) → a shoegaze candidate's reason ends with `You rate shoegaze 8.0 on average but have only ranked 1 shoegaze album.`, and it outscores an otherwise identical candidate without the genre.
  - `gap bonus silent below the engagement floor`: same shape but slice mean 6.0 → reason unchanged.
  - `gap bonus silent on small lists`: `N = 10` → reason unchanged.
  - `gap bonus zero at the threshold boundary`: `N = 20`, `n = 1` (share exactly 0.05) → score unchanged and reason unchanged (the gap clause only applies when the bonus is positive).
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/suggestions.test.ts`.
- [ ] **Step 3: Implement** inside `suggestAlbum`: the filter as an early `continue` in the candidate loop; the bonus computed from a slice-occupancy map built once per call before the loop.
- [ ] **Step 4: Run to verify pass**, then full suite.
- [ ] **Step 5: Commit.** `feat(web): slice-filtered suggestions and gap-aware score bonus`

### Task 8: Inline candidates on slice pages and "Find more"

**Files:**
- Modify: `web/src/ui/sliceView.ts`, `web/src/main.ts`, `web/src/ui/backlogView.ts`
- Test: `web/src/ui/sliceView.test.ts` (extend), `web/src/main.test.ts` only if a pure helper lands there

**Interfaces:**
- Consumes: `SliceFilter`/`sliceFilter` (Task 7), `Suggestion` type, `albumCard` styling conventions from `backlogView.ts` (visual reference, not an import — it is module-private).
- Produces, added to `SliceViewOptions`:

```ts
getCandidates: () => Suggestion[];                       // up to 3, may be []
onRateCandidate: (album: Album, rating: number) => void; // normal insertAtRating path
onWantToListen: (album: Album) => void;
onSkipCandidate: (album: Album) => void;                 // this-session skip, refreshes strip
onFindMore: () => void;
candidatesTitle: string;                                 // e.g. 'Unranked picks for 1994'
```

And in `backlogView.ts`, added to `BacklogViewOptions`:

```ts
sliceFilterLabel: string | null;   // e.g. '1990s' — renders a chip on the suggestions shelf
onClearSliceFilter: () => void;    // chip's × button
```

- [ ] **Step 1: Write the failing tests** (extend `sliceView.test.ts`):
  - with 2 candidates, the strip renders 2 cards below the ranked rows, each showing title, reason text, a 0-10 rate form (submitting calls `onRateCandidate` with the rounded value), a Want to listen button, and a Skip button;
  - with 0 candidates, the strip area shows a single message paragraph (no cards, not blank) and the "Find more" button still renders and calls `onFindMore`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the strip in `sliceView.ts`.** Card markup mirrors `backlogView.ts`'s `albumCard` (cover, year, title, artist, reason, actions; reuse its CSS classes), built locally with safe DOM. Rate form uses the `candidate-place` validation shape (0-10, two decimals).
- [ ] **Step 4: Wire candidates in `main.ts`.** Per mounted slice: `sliceSeen: Album[] = []`; `getCandidates` calls `suggestAlbum` up to 3 times with the slice's `sliceFilter` (key → `SliceFilter` translation from Task 4's `sliceState`), accumulating each result into a local `seen` so the three differ; `onSkipCandidate` pushes to `sliceSeen` and re-renders; `onRateCandidate` routes through the same handler the backlog's "Rate now" uses; `onWantToListen` through the existing set-aside handler. Artist slices are out of scope (they use `artistBatchView`, which already lists the artist's unranked albums).
- [ ] **Step 5: Wire "Find more" into the backlog.** New main.ts state `suggestionSliceFilter: { filter: SliceFilter; label: string } | null`; `onFindMore` sets it and calls `showView('backlog')` with the suggestions shelf active; `refreshSuggestion` (main.ts ~line 1237) passes `sliceFilter: suggestionSliceFilter?.filter`; `backlogView` renders the chip from `sliceFilterLabel` with an `×` calling `onClearSliceFilter` (clears state, refreshes). Clearing or leaving the shelf does not persist the filter.
- [ ] **Step 6: Run full tests, build, and manual check** at 360 px: open a decade slice, rate a candidate, watch it join the slice's ranked rows in place; tap Find more and confirm the chip and constrained picks; clear the chip.
- [ ] **Step 7: Commit.** `feat(web): inline slice candidates and slice-constrained Find more`

---

## Self-review notes

- Spec coverage: Phase 1 → Tasks 1-4; Phase 2 → Tasks 5-6; Phase 3 → Tasks 7-8. Spec's acceptance bullets map to Task 3 step 5, Task 4 steps 1/5, Task 6 steps 2-3, Task 1/8 genre-degradation tests.
- The spec's "decade view sub-rank line" question is left to the builder (spec says so); default is reusing the existing year line untouched.
- Deliberately not built: artist gap bonus, slice filters persisting across views, any server/API change (phase 2 is script + client merge only).
