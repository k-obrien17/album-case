# EP Search Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the free-text search route (`/api/search-album`) return clean EPs (e.g. Pixies' *Come On Pilgrim*) alongside clean albums, without touching artist-MBID bulk discovery, schema, or types.

**Architecture:** Add a new pure predicate `isAlbumOrEpReleaseGroup` in `web/api/_lp.ts`, sibling to the existing `isLpReleaseGroup` (which stays unchanged for `discover-artist.ts`). Swap the filter used in `web/api/search-album.ts` to the new predicate. No other files change.

**Tech Stack:** TypeScript, Vercel serverless functions, Vitest.

## Global Constraints

- `isLpReleaseGroup` must not change — `discover-artist.ts` still depends on it for LP-only bulk discovery (spec decision: search-only scope).
- The new predicate's secondary-types rule matches the existing LP rule exactly: `(group['secondary-types']?.length ?? 0) === 0`. A "Live EP" or "Remix EP" is still excluded.
- No schema, migration, or type changes (`Album`, `DiscoveredAlbum`, `RankedAlbum`, `discovered_albums` table all stay as-is).
- Run tests from `web/`: `npm run test -- <path>` (Vitest).

---

### Task 1: Add `isAlbumOrEpReleaseGroup` predicate with tests

**Files:**
- Modify: `web/api/_lp.ts`
- Test: `web/api/_lp.test.ts`

**Interfaces:**
- Produces: `isAlbumOrEpReleaseGroup(group: ReleaseGroup): boolean`, exported from `web/api/_lp.ts`, for Task 2 to import.

- [ ] **Step 1: Write the failing tests**

Add to `web/api/_lp.test.ts`. First update the import at the top of the file to also pull in the new function:

```ts
import {
  isLpReleaseGroup,
  isAlbumOrEpReleaseGroup,
  mergeDiscovered,
  type ReleaseGroup,
  type DiscoveredAlbum,
} from './_lp';
```

Then add a new `describe` block, placed after the existing `describe('isLpReleaseGroup', ...)` block (i.e. after line 24, before `function album(mbid: string)`):

```ts
describe('isAlbumOrEpReleaseGroup', () => {
  it('accepts a plain Album release-group with no secondary types', () => {
    expect(isAlbumOrEpReleaseGroup(group())).toBe(true);
  });

  it('accepts a plain EP release-group with no secondary types', () => {
    expect(isAlbumOrEpReleaseGroup(group({ 'primary-type': 'EP' }))).toBe(true);
  });

  it('rejects an EP with a secondary type (e.g. Live)', () => {
    expect(
      isAlbumOrEpReleaseGroup(group({ 'primary-type': 'EP', 'secondary-types': ['Live'] }))
    ).toBe(false);
  });

  it('rejects an Album with a secondary type (e.g. Compilation)', () => {
    expect(
      isAlbumOrEpReleaseGroup(group({ 'secondary-types': ['Compilation'] }))
    ).toBe(false);
  });

  it('rejects a non-Album, non-EP primary type (e.g. Single)', () => {
    expect(isAlbumOrEpReleaseGroup(group({ 'primary-type': 'Single' }))).toBe(false);
  });

  it('rejects a release-group with a missing primary type', () => {
    expect(isAlbumOrEpReleaseGroup(group({ 'primary-type': undefined }))).toBe(false);
  });
});
```

Note: this reuses the existing `group()` helper already defined in the file (line 4-6), which defaults `'primary-type': 'Album'`.

- [ ] **Step 2: Run tests to verify they fail**

Run from `web/`: `npm run test -- api/_lp.test.ts`
Expected: FAIL — `isAlbumOrEpReleaseGroup` is not exported from `./_lp` (import error / undefined function).

- [ ] **Step 3: Implement the predicate**

In `web/api/_lp.ts`, add directly below the existing `isLpReleaseGroup` function (after line 13):

```ts
// Same secondary-types rule as isLpReleaseGroup, widened to also admit EPs
// (e.g. Pixies' "Come On Pilgrim") for free-text search results only.
export function isAlbumOrEpReleaseGroup(group: ReleaseGroup): boolean {
  const type = group['primary-type'];
  return (type === 'Album' || type === 'EP') && (group['secondary-types']?.length ?? 0) === 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `web/`: `npm run test -- api/_lp.test.ts`
Expected: PASS, all tests in the file including the new `isAlbumOrEpReleaseGroup` block.

- [ ] **Step 5: Commit**

```bash
cd web
git add api/_lp.ts api/_lp.test.ts
git commit -m "feat(search): add isAlbumOrEpReleaseGroup predicate"
```

---

### Task 2: Wire the predicate into `/api/search-album`

**Files:**
- Modify: `web/api/search-album.ts:2,80`
- Test: `web/api/search-album.test.ts`

**Interfaces:**
- Consumes: `isAlbumOrEpReleaseGroup(group: ReleaseGroup): boolean` from Task 1 (`./_lp.js`, matching the existing `.js`-suffixed relative import convention already used at line 2 for `isLpReleaseGroup`).

- [ ] **Step 1: Write the failing test**

Add a new test case to `web/api/search-album.test.ts`, inside the existing `describe('/api/search-album GET', ...)` block, after the `'filters non-studio-LP release groups...'` test (after line 96, before the closing `});` of the describe block):

```ts
  it('includes a clean EP alongside albums, and still excludes an EP with a secondary type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            {
              id: 'rg-ep-clean',
              title: 'Come On Pilgrim',
              'first-release-date': '1987-01-01',
              'primary-type': 'EP',
              'secondary-types': [],
              'artist-credit': [{ name: 'Pixies', artist: { id: 'artist-pixies' } }],
            },
            {
              id: 'rg-ep-live',
              title: 'Live EP',
              'first-release-date': '1988-01-01',
              'primary-type': 'EP',
              'secondary-types': ['Live'],
              'artist-credit': [{ name: 'Pixies', artist: { id: 'artist-pixies' } }],
            },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ q: 'Pixies' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      albums: [
        {
          mbid: 'rg-ep-clean',
          title: 'Come On Pilgrim',
          primary_artist_name: 'Pixies',
          primary_artist_mbid: 'artist-pixies',
          release_year: 1987,
          cover_url: 'https://coverartarchive.org/release-group/rg-ep-clean/front-500',
        },
      ],
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run from `web/`: `npm run test -- api/search-album.test.ts`
Expected: FAIL — the new test's `res.body` includes only `rg-ep-clean` is expected, but the current handler (still using `isLpReleaseGroup`) filters out both EPs, so `albums` comes back `[]` and the assertion fails.

- [ ] **Step 3: Swap the filter in the handler**

In `web/api/search-album.ts`, change the import at line 2 from:

```ts
import { isLpReleaseGroup, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';
```

to:

```ts
import { isAlbumOrEpReleaseGroup, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';
```

Then change the filter call at line 80 from:

```ts
      .filter(isLpReleaseGroup)
```

to:

```ts
      .filter(isAlbumOrEpReleaseGroup)
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `web/`: `npm run test -- api/search-album.test.ts`
Expected: PASS, all tests in the file including the new EP test case. The pre-existing `'filters non-studio-LP release groups...'` test must still pass unmodified — it doesn't use EPs, so widening the predicate doesn't affect its expected output.

- [ ] **Step 5: Run the full test suite**

Run from `web/`: `npm run test`
Expected: PASS, no regressions elsewhere (in particular `discover-artist.test.ts`, which still imports and relies on `isLpReleaseGroup` unchanged).

- [ ] **Step 6: Commit**

```bash
cd web
git add api/search-album.ts api/search-album.test.ts
git commit -m "feat(search): include EPs in /api/search-album results"
```

---

## Self-Review Notes

- **Spec coverage:** Change 1 (new predicate) → Task 1. Change 2 (search-album.ts swap) → Task 2. "Result shape unchanged" → verified by Task 2's test asserting the exact `DiscoveredAlbum` shape. "Testing" section's four predicate cases → all four present in Task 1 Step 1, plus a fifth (missing primary type, matching the existing LP test's coverage) and a sixth (Single, an explicit non-Album/non-EP case) for parity with `isLpReleaseGroup`'s test suite. Non-goals (discover-artist.ts, schema, UI) → no task touches any of those files.
- **Placeholder scan:** none found; every step has literal code.
- **Type consistency:** `isAlbumOrEpReleaseGroup(group: ReleaseGroup): boolean` matches between Task 1's produced interface and Task 2's consumed interface, including the `.js` import suffix convention already used in `search-album.ts`.
