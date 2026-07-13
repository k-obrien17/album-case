# Search + Bulk-Add Floor Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search box to the ranked view that filters the 376-album list locally and falls back to a MusicBrainz search for albums not yet in the library, and make the import script's 8.0 rating floor a parameter.

**Architecture:** Search filtering reuses machinery that already exists — `mountRankList` already separates `getRanked` (rows to render) from `getGlobalRanked` (full list, for index mapping), and the rating/overall-rank editors already resolve a filtered row back to its global index by mbid. So filtering is mostly wiring. The MusicBrainz half needs a new read-only serverless route (the browser cannot set the `User-Agent` MusicBrainz requires — this is why `discover-artist.ts` is a route, not a client fetch).

**Tech Stack:** TypeScript, Vite, Vitest, Vercel serverless — no new dependencies.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-13-search-and-bulk-add-design.md`.
- Ratings are **0-10** everywhere in the app. The only 8.0 floor is in the import script, and Task 5 makes it a parameter.
- **`Number('') === 0`, and 0 is a legal rating.** Every rating input MUST reject empty/whitespace explicitly before calling `Number()`, then reject non-finite and out-of-range. An empty field silently rating an album `0.00` was a real bug caught in review. Existing handlers in `rankList.ts` already do this correctly — copy their exact validation shape.
- **Never append-then-sort** when inserting by rating. Use the exported `insertAtRating(ranked, album, rating)` from `main.ts` (remove-then-splice). Append-then-sort breaks on rating ties because a stable sort strands the album behind an equal-rated incumbent. Regression test: "splice at the computed index" in `main.test.ts`.
- **Artist locks are PAUSED.** Do not re-introduce `nearestValidDropIndex`, `wouldViolateLock`, `getNearestValidDrop`, or `getLockedArtistMbids` anywhere. `main.ts` no longer imports `./ranking/locks` at all — keep it that way.
- Test convention: colocate `.test.ts` next to source. Run from `web/`: `npx tsc --noEmit`, `npm run test`, `npm run build`.

---

### Task 1: The pure filter function

**Files:**
- Create: `web/src/search.ts`
- Create: `web/src/search.test.ts`

**Interfaces:**
- Produces: `export function filterAlbums<T extends Album>(albums: T[], query: string): T[]` — later tasks call this exact signature. Generic over `T` so passing `RankedAlbum[]` returns `RankedAlbum[]` (preserving `rating`) rather than widening to `Album[]`. This mirrors the `hydrateAlbums<T extends Album>` and `artistAlbumsFor<T extends Album>` generic-widening pattern already used elsewhere in this codebase.

- [ ] **Step 1: Write the failing tests**

Create `web/src/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import { filterAlbums } from './search';

function album(overrides: Partial<Album> & { mbid: string }): Album {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Unknown Artist',
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

const albums = [
  album({ mbid: 'a', title: 'OK Computer', primary_artist_name: 'Radiohead' }),
  album({ mbid: 'b', title: 'Kid A', primary_artist_name: 'Radiohead' }),
  album({ mbid: 'c', title: 'Dummy', primary_artist_name: 'Portishead' }),
];

describe('filterAlbums', () => {
  it('returns everything for an empty query', () => {
    expect(filterAlbums(albums, '')).toHaveLength(3);
  });

  it('returns everything for a whitespace-only query', () => {
    expect(filterAlbums(albums, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(filterAlbums(albums, 'ok comp').map((a) => a.mbid)).toEqual(['a']);
  });

  it('matches on artist, case-insensitively', () => {
    expect(filterAlbums(albums, 'RADIOHEAD').map((a) => a.mbid)).toEqual(['a', 'b']);
  });

  it('matches a substring anywhere in the field', () => {
    expect(filterAlbums(albums, 'head').map((a) => a.mbid)).toEqual(['a', 'b', 'c']);
  });

  it('trims the query before matching', () => {
    expect(filterAlbums(albums, '  dummy  ').map((a) => a.mbid)).toEqual(['c']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterAlbums(albums, 'zzz')).toEqual([]);
  });

  it('preserves the input order', () => {
    expect(filterAlbums(albums, 'head').map((a) => a.mbid)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd web && npx vitest run src/search.test.ts
```
Expected: FAIL — `search.ts` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/search.ts`:

```ts
import type { Album } from './ranking/types';

/**
 * Case-insensitive substring filter over an album list, matching either the
 * title or the primary artist name. An empty or whitespace-only query returns
 * the list unchanged (search inactive).
 *
 * Generic over `T` so a `RankedAlbum[]` in yields a `RankedAlbum[]` out --
 * keeping `rating` -- rather than widening to the base `Album`.
 */
export function filterAlbums<T extends Album>(albums: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return albums;
  return albums.filter(
    (album) =>
      album.title.toLowerCase().includes(needle) ||
      album.primary_artist_name.toLowerCase().includes(needle)
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd web && npx vitest run src/search.test.ts
```
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add web/src/search.ts web/src/search.test.ts
git commit -m "feat(search): add the pure album filter"
```

---

### Task 2: The `/api/search-album` route

**Files:**
- Create: `web/api/search-album.ts`
- Create: `web/api/search-album.test.ts`

**Interfaces:**
- Produces: `GET /api/search-album?q=<free text>` → `200 { albums: DiscoveredAlbum[] }`. The client consumes this exact shape in Task 4.

Read `web/api/discover-artist.ts` first and mirror its conventions exactly (its `USER_AGENT`, `MB_BASE`, `coverUrlFor`, `releaseYear` helpers, and its error-handling shape). This route is **read-only**: no write key, no Turso, no schema. It is a thin MusicBrainz proxy — which is the entire reason it must exist server-side (the browser cannot set the `User-Agent` MusicBrainz requires).

- [ ] **Step 1: Write the route**

Create `web/api/search-album.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isLpReleaseGroup, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';

const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MAX_RESULTS = 10;

function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

function releaseYear(group: ReleaseGroup): number | null {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

type SearchReleaseGroup = ReleaseGroup & {
  'artist-credit'?: { name?: string; artist?: { id?: string } }[];
};

function toAlbum(group: SearchReleaseGroup): DiscoveredAlbum {
  const credit = group['artist-credit']?.[0];
  return {
    mbid: group.id,
    title: group.title,
    primary_artist_name: credit?.name ?? 'Unknown Artist',
    ...(credit?.artist?.id ? { primary_artist_mbid: credit.artist.id } : {}),
    release_year: releaseYear(group),
    cover_url: coverUrlFor(group.id),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ error: 'missing_query' });
    return;
  }

  try {
    // Lucene-escape double quotes so a quoted query can't break the syntax.
    const params = new URLSearchParams({ query: q.replace(/"/g, '\\"'), fmt: 'json' });
    const mb = await fetch(`${MB_BASE}/release-group/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!mb.ok) throw new Error(`musicbrainz_${mb.status}`);

    const data = (await mb.json()) as { 'release-groups'?: SearchReleaseGroup[] };
    const albums = (data['release-groups'] ?? [])
      .filter(isLpReleaseGroup)
      .slice(0, MAX_RESULTS)
      .map(toAlbum);

    res.status(200).json({ albums });
  } catch {
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  }
}
```

- [ ] **Step 2: Write a thin test, matching `discover-artist.test.ts`'s level**

Read `web/api/discover-artist.test.ts` first — match whatever it actually does (it is deliberately thin). At minimum, create `web/api/search-album.test.ts` covering:
- a non-GET method returns 405,
- a missing/empty `q` returns 400,
- a successful MusicBrainz response (mock `fetch`) filters out non-studio-LP release groups and maps the rest into the `DiscoveredAlbum` shape.

Write these using the same mocking approach `discover-artist.test.ts` already uses. Do not invent a different one.

- [ ] **Step 3: Run**

```bash
cd web && npx vitest run api/search-album.test.ts
npx tsc --noEmit
```
Expected: tests pass, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add web/api/search-album.ts web/api/search-album.test.ts
git commit -m "feat(api): add a read-only MusicBrainz album search route"
```

---

### Task 3: `rankList` renders a filtered list and suppresses drag

**Files:**
- Modify: `web/src/ui/rankList.ts`
- Modify: `web/src/style.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: two new optional props on `RankListOptions`:
  - `getSearchQuery?: () => string` — the live query; when non-empty, the view is "filtered".
  - `onSearchQueryChange?: (query: string) => void` — fired on every keystroke of the search input.

  When `getSearchQuery` returns a non-empty (trimmed) string, this component MUST:
  - render **no row grips** (drag would compute a drop index against a partial list and produce a wrong rating), and
  - render **no candidate card** (placing a candidate into a filtered list has the same problem).

  The rating editor and overall-rank editor stay fully available — both already map a filtered row back to its global index by mbid (`getGlobalRanked().findIndex(...)`), so they are index-safe by construction.

- [ ] **Step 1: Add the two props to `RankListOptions`**

Add to the type, documented in the same style as its neighbors:

```ts
  /** The live search query. When non-empty, this instance is rendering a
   *  FILTERED subset: row grips and the candidate card are suppressed, because
   *  a drop index computed against a partial list would produce a wrong rating.
   *  The rating and overall-rank editors remain available -- both resolve a
   *  filtered row back to its global index by mbid, so they are index-safe.
   *  Omit to disable search entirely. */
  getSearchQuery?: () => string;
  /** Fired on every keystroke of the search input. */
  onSearchQueryChange?: (query: string) => void;
```

- [ ] **Step 2: Render the search input at the top of the ranked view**

In `render()`, before the ranked list is appended, render a search input when `opts.onSearchQueryChange` is provided. Match this file's existing DOM-construction conventions (`document.createElement`, className, no `innerHTML`).

```ts
function buildSearchBox(): HTMLElement | null {
  if (!opts.onSearchQueryChange) return null;
  const wrap = document.createElement('div');
  wrap.className = 'rank-search';

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'rank-search-input';
  input.placeholder = 'Search your albums';
  input.setAttribute('aria-label', 'Search your albums');
  input.value = opts.getSearchQuery?.() ?? '';
  input.addEventListener('input', () => {
    opts.onSearchQueryChange?.(input.value);
  });

  wrap.append(input);
  return wrap;
}
```

**Focus preservation is critical.** `render()` rebuilds the DOM, so a naive re-render on every keystroke destroys the input and loses focus + caret. Handle it exactly as this file already handles the rating/overall editors' focus: after `render()`, if the search input was focused, restore focus and caret position. Implement by tracking a module-scope `searchFocused` boolean and caret offset, set on `input`/`focus` and restored after render. Verify this manually in Step 6 — a search box that drops focus after one character is unusable.

- [ ] **Step 3: Suppress grips when filtered**

Find where the row grip is created (search for `rank-grip`). Wrap its creation and append:

```ts
    const filtered = (opts.getSearchQuery?.() ?? '').trim() !== '';
    if (!filtered) {
      // A dedicated grip so the row body still flick-scrolls on touch; only the
      // grip disables native scrolling (touch-action:none via .rank-grip).
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'rank-grip';
      grip.setAttribute('aria-label', `Reorder ${album.title}`);
      grip.textContent = '⇅';
      grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));
      li.append(grip);
    }
```

- [ ] **Step 4: Suppress the candidate card when filtered**

Find where the candidate card is built and appended in `render()`. Skip it entirely when `filtered` is true (same expression as Step 3). Hoist `filtered` to the top of `render()` so both uses share it.

- [ ] **Step 5: Show a "no local matches" state**

When `filtered` is true and `opts.getRanked()` is empty, render a message instead of an empty list — plain text, e.g. `No albums in your list match "<query>".` This is also the anchor point Task 4 attaches the MusicBrainz action to, so give it a stable class (`rank-search-empty`).

- [ ] **Step 6: Add CSS + verify manually**

Add `.rank-search`, `.rank-search-input`, `.rank-search-empty` rules to `web/src/style.css`, matching the file's existing conventions (and the project's 44px minimum tap target for the input).

```bash
cd web && npm run dev
```
Verify: typing filters the list live; **focus and caret are preserved across keystrokes** (type several characters in a row without the box losing focus); grips disappear while filtering; the candidate card disappears while filtering; clearing the box restores the full list, grips, and candidate.

- [ ] **Step 7: Typecheck, test, commit**

```bash
cd web && npx tsc --noEmit && npm run test && npm run build
git add web/src/ui/rankList.ts web/src/style.css
git commit -m "feat(rank-list): add a search box that filters the ranked list"
```

---

### Task 4: Wire search in `main.ts` + the MusicBrainz fallback

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/ui/rankList.ts` (the MusicBrainz results UI hangs off the empty state from Task 3)
- Modify: `web/src/main.test.ts`

**Interfaces:**
- Consumes: `filterAlbums` (Task 1), `GET /api/search-album` (Task 2), `getSearchQuery`/`onSearchQueryChange` (Task 3), and the existing exported `insertAtRating` + `removeFromList`.
- Produces: a third new optional prop on `RankListOptions`:
  - `onSearchMusicBrainz?: (query: string) => void` — fired when the user taps the "Search MusicBrainz" action in the empty state.
  - `getSearchResults?: () => { status: 'idle' | 'loading' | 'error'; albums?: never } | { status: 'done'; albums: Album[] }` — the current MusicBrainz result state, rendered in the empty state.
  - `onRateSearchResult?: (album: Album, rating: number) => void` — add a MusicBrainz result to the ranked list at a typed rating.

  (Shape these however is cleanest given Task 3's actual code — the point is: the empty state needs to show a "Search MusicBrainz" button, then a loading state, then a list of results each with a 0-10 rating input. Keep the state in `main.ts`, not in `rankList.ts`.)

- [ ] **Step 1: Add search state and wire the filter in `main.ts`**

```ts
import { filterAlbums } from './search';
```

Add module-scope state near the other `let` bindings in the app closure:

```ts
  let searchQuery = '';
  let searchResults:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'done'; albums: Album[] } = { status: 'idle' };
```

In the `mountRankList` call for the ranked view (around line 571), change `getRanked` to return the filtered list, add `getGlobalRanked` returning the true full list, and wire the query props:

```ts
    getRanked: () => filterAlbums(state.ranked, searchQuery),
    getGlobalRanked: () => state.ranked,
    getSearchQuery: () => searchQuery,
    onSearchQueryChange: (query) => {
      searchQuery = query;
      searchResults = { status: 'idle' }; // a new query invalidates old results
      rankList.render();
    },
```

**`getGlobalRanked` is load-bearing**: without it, the rating and overall-rank editors would compute indices against the *filtered* array and re-rate the wrong album. The prop already exists for exactly this purpose (it was built for the artist-lock view).

- [ ] **Step 2: Wire the MusicBrainz search**

```ts
    onSearchMusicBrainz: (query) => {
      void (async () => {
        searchResults = { status: 'loading' };
        rankList.render();
        try {
          const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}`);
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { albums: Album[] };
          searchResults = { status: 'done', albums: body.albums ?? [] };
        } catch {
          searchResults = { status: 'error' };
        }
        rankList.render();
      })();
    },
    getSearchResults: () => searchResults,
```

- [ ] **Step 3: Wire adding a searched album — and remove it from the saved lists**

```ts
    onRateSearchResult: (album, rating) => {
      state = { ranked: insertAtRating(state.ranked, album, rating), pending: null };

      // HARD REQUIREMENT: api/ranking.ts rejects any snapshot where an album is
      // both ranked and in a saved list (400 ranked_album_in_saved_list). A
      // searched album may already be sitting in one. Omitting this produces a
      // confusing 400 on the NEXT save, not at the point of the mistake -- this
      // exact bug already blocked the canon import once.
      lists = removeFromList(lists, album.mbid, 'wantToListen');
      lists = removeFromList(lists, album.mbid, 'notHeard');
      lists = removeFromList(lists, album.mbid, 'dontCare');

      searchQuery = '';
      searchResults = { status: 'idle' };
      persistRankingState();
      persistLists();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
```

No pairwise atom is recorded — no comparison happened, matching the existing `onDirectRate` precedent.

Confirm `insertAtRating`, `removeFromList`, `persistLists`, and `reselectCandidate` are all already in scope in `main.ts` (they are — `removeFromList` is imported at line 20 and used at line 678; `insertAtRating` is exported from this same file).

- [ ] **Step 4: Render the MusicBrainz results in `rankList.ts`'s empty state**

Extend the `rank-search-empty` block from Task 3:
- `idle` → a button: `Search MusicBrainz for "<query>"` → calls `opts.onSearchMusicBrainz?.(query)`.
- `loading` → `Searching MusicBrainz…`
- `error` → `Couldn't reach MusicBrainz. Try again.` (plus the retry button again)
- `done` with 0 albums → `No albums found.`
- `done` with albums → a list. Each row: title, artist, year, and a rating input.

Each result's rating input **must reuse the exact validation shape already used by the other rating inputs in this file** (`buildRatingControl` / the direct-rate input):

```ts
        const raw = input.value.trim();
        if (raw === '') { showStatus('Enter 0-10.'); return; }
        const rating = Number(raw);
        if (!Number.isFinite(rating) || rating < 0 || rating > 10) { showStatus('Enter 0-10.'); return; }
        opts.onRateSearchResult?.(album, Math.round(rating * 100) / 100);
```

Set `form.noValidate = true` on the form (native HTML5 validation silently blocks submit otherwise — this bit us before).

A result whose `mbid` is already in `opts.getGlobalRanked?.() ?? opts.getRanked()` renders as "Already in your list" instead of a rating input.

- [ ] **Step 5: Test the add path**

In `web/src/main.test.ts`, add a test asserting that adding a searched album removes it from all three saved lists. Build it on the exported `insertAtRating` + `removeFromList` (both are already exported/importable — do not re-implement a local copy; a prior review caught exactly that mistake). Follow the file's existing test style.

- [ ] **Step 6: Typecheck, test, build, verify manually**

```bash
cd web && npx tsc --noEmit && npm run test && npm run build
npm run dev
```
Verify end to end: search an album you HAVE (filters to it, edit its rating, works). Search something you DON'T have (empty state → tap MusicBrainz → results appear → type a rating → it's added at that rating, in the right position, and the search clears). Search a nonsense string (→ "No albums found."). Confirm an empty rating input on a result shows "Enter 0-10." and adds nothing.

- [ ] **Step 7: Commit**

```bash
git add web/src/main.ts web/src/ui/rankList.ts web/src/main.test.ts
git commit -m "feat(search): wire local filtering and the MusicBrainz fallback"
```

---

### Task 5: Parameterize the import script's rating floor

**Files:**
- Modify: `web/scripts/import-album-canon.mjs`

**Interfaces:** none — a script-only change.

- [ ] **Step 1: Replace the hardcoded 8.0 floor**

The current guard (around line 196) is:

```js
const belowFloor = ratingSorted.filter((a) => typeof a.rating !== 'number' || Number.isNaN(a.rating) || a.rating < 8);
if (belowFloor.length > 0) {
  console.error(`\nABORT: ${belowFloor.length} album(s) rated below 8.0 or not a valid number:`);
```

Replace with a parameterized floor. Add near the other consts at the top of the file:

```js
// The canon import was 8-to-10 by construction, so it ran with a hard 8.0
// floor. Ratings now run 0-10 app-wide, so the floor is opt-in: default 0.
// The type/NaN/range check below is NOT optional -- that's the real invariant.
const RATING_FLOOR = Number(process.env.RATING_FLOOR ?? 0);
```

And the guard becomes:

```js
const invalid = ratingSorted.filter(
  (a) =>
    typeof a.rating !== 'number' ||
    !Number.isFinite(a.rating) ||
    a.rating < 0 ||
    a.rating > 10 ||
    a.rating < RATING_FLOOR
);
if (invalid.length > 0) {
  console.error(
    `\nABORT: ${invalid.length} album(s) have an invalid rating (must be a number in 0-10${
      RATING_FLOOR > 0 ? `, and >= the RATING_FLOOR of ${RATING_FLOOR}` : ''
    }):`
  );
  for (const a of invalid.slice(0, 10)) {
    console.error(`  - ${a.title} (${a.primary_artist_name}) = ${a.rating}`);
  }
  if (invalid.length > 10) console.error(`  ...and ${invalid.length - 10} more.`);
  console.error('Nothing was written. Fix the source data first.');
  process.exit(1);
}
console.log(
  `Rating check passed: all ${ratingSorted.length} albums are valid 0-10 ratings${
    RATING_FLOOR > 0 ? ` and >= ${RATING_FLOOR}` : ''
  }.`
);
```

Also add `RATING_FLOOR` to the script's usage comment at the top of the file.

Note: `RATING_FLOOR` guards the ratings in the FINAL replace list, which includes any `untouched` albums carried over from the existing library. That is the correct scope — it is asserting an invariant about the resulting library, not just about the CSV.

- [ ] **Step 2: Verify both modes with a dry run**

Default (no floor) — the real canon CSV is 8-to-10 so it passes trivially, but the message must now say "valid 0-10 ratings" with no floor clause:

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
node --env-file=web/.env.local web/scripts/import-album-canon.mjs 2>&1 | grep -i "rating check"
```
Expected: `Rating check passed: all 376 albums are valid 0-10 ratings.`

Then with the old behavior restored explicitly:

```bash
RATING_FLOOR=8 node --env-file=web/.env.local web/scripts/import-album-canon.mjs 2>&1 | grep -i "rating check"
```
Expected: `Rating check passed: all 376 albums are valid 0-10 ratings and >= 8.`

**This is a DRY RUN — `CONFIRM_CANON_IMPORT` is NOT set, so it writes nothing.** Do NOT set it. Each run takes ~2.5 min (152 read-only MusicBrainz calls).

- [ ] **Step 3: Verify the floor actually rejects**

Prove the guard fires. Make a tiny throwaway CSV with a sub-8 rating, run with `RATING_FLOOR=8`, and confirm it ABORTS; then run the same CSV with no floor and confirm it PASSES the rating check.

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
printf 'Ranking,Album,Artist,Year,Rating\n1,Kid A,Radiohead,2000,7.5\n' > /tmp/floor-test.csv

CANON_CSV=/tmp/floor-test.csv RATING_FLOOR=8 node --env-file=web/.env.local web/scripts/import-album-canon.mjs 2>&1 | tail -4
# Expected: ABORT ... invalid rating ... exit 1

CANON_CSV=/tmp/floor-test.csv node --env-file=web/.env.local web/scripts/import-album-canon.mjs 2>&1 | grep -i "rating check"
# Expected: Rating check passed ...

rm /tmp/floor-test.csv
```

Note: these runs use a 1-row CSV, so they finish in seconds (1 local hit, 0 or 1 MusicBrainz calls). Still a dry run — no `CONFIRM_CANON_IMPORT`, nothing written.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/import-album-canon.mjs
git commit -m "fix(scripts): make the import rating floor a parameter, default 0

The 8.0 floor was correct for the canon import (8-to-10 by construction)
but ratings now run 0-10 app-wide, so a normal bulk-add CSV containing a
7 would abort. The floor is now opt-in via RATING_FLOOR (default 0); the
type/NaN/0-10 range check is unconditional, since that's the real
invariant."
```
