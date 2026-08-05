# Unified Artist Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge artist ("band") search into the existing "Search your albums" box, and split artist discovery into a locked browse-only path and an unlocked persist path behind one shared client function, replacing the separate "+ Add a band" view shipped earlier this session.

**Architecture:** A new unauthenticated `GET /api/browse-artist` route shares its MusicBrainz-browse logic with the existing (write-key-gated) `POST /api/discover-artist` via a helper extracted into `web/api/_lp.ts`. `discoverArtistDetailed` in `web/src/discovery.ts` picks browse vs. persist based on whether a write key is present, so every caller gets the split for free. `web/src/ui/rankList.ts`'s existing MusicBrainz fallback grows a second result kind (band hits) rendered in its own labeled section below album hits.

**Tech Stack:** Vite 8 + TypeScript 6, Vercel serverless functions (`@vercel/node`), Turso/libSQL (`@libsql/client`), Vitest.

## Global Constraints

- No `ALBUM_CASE_WRITE_KEY` in source, screenshots, logs, or `VITE_*` env vars.
- Don't use Elo or any self-contradicting ranking model; the personal list stays transitive-by-construction (unaffected by this feature, noted per project convention).
- Mobile is the primary device: tap targets >= 44px, usable at 360px, no horizontal scroll.
- Render with safe DOM construction (`createElement`/`textContent`), never `innerHTML`.
- Match existing code style: safe DOM construction, optional-prop-hides-feature convention in `RankListOptions`, stale-response guards on in-flight async work keyed off the live query/view.

## Deviations from the approved design spec

Two points in `docs/superpowers/specs/2026-08-05-unified-artist-search-design.md` needed correction once grounded against the real code, both re-confirmed with Keith via AskUserQuestion before this plan was written:

1. **Band-hit copy.** MusicBrainz's artist-search endpoint (`/api/search-artist`) returns no album count, so a literal "See all N albums" isn't available before the click. The row reads **"See albums"** instead; the real count appears once the discovery fetch resolves into the artist-batch view. This matches how the now-deleted `artistSearchView.ts` already behaved ("Rank all albums", no count).
2. **Result layout.** Merged results render as **two labeled sections** ("Albums" then "Bands"), each shown only when it has >= 1 result, rather than interleaved.

Also, the spec's testing section said `main.test.ts` would gain tests for the merged-results wiring. Grounding against the actual file found `main.test.ts` only unit-tests pure functions exported from `main.ts` (`resolveInitialState`, `hydrateAlbums`, etc.) -- none of the existing DOM-wired view logic (including the artist-search flow being replaced) has ever had unit tests, because it lives in non-exported closures over `main.ts`'s module state. This plan follows that existing convention: no new `main.test.ts` cases for the click-wiring in Task 5, verified by manual browser walkthrough instead. New *pure* logic (the shared MusicBrainz browse helper, the new API route) does get automated tests.

---

### Task 1: Extract shared MusicBrainz artist-browse helper into `_lp.ts`

**Files:**
- Modify: `web/api/_lp.ts`
- Modify: `web/api/discover-artist.ts:1-30` (imports/consts), `:96-113` (`fetchArtistLps` removal), `:192` (call site)
- Test: `web/api/_lp.test.ts`

**Interfaces:**
- Produces: `USER_AGENT: string`, `MB_BASE: string`, `coverUrlFor(mbid: string): string`, `browseArtistLps(artistMbid: string, artistName: string): Promise<DiscoveredAlbum[]>` -- all exported from `web/api/_lp.ts`. `browseArtistLps` throws `Error('musicbrainz_browse_<status>')` on a non-ok MusicBrainz response, and `Error('musicbrainz_browse_timeout')` when an 8s `AbortController` timeout fires.
- Consumed by: `discover-artist.ts` (this task), `browse-artist.ts` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `web/api/_lp.test.ts` (after the existing `mergeDiscovered` describe block):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
// (afterEach/vi already imported at the top of this file for the other
// describes -- extend the existing import line instead of duplicating it.)

describe('browseArtistLps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches, filters to studio LPs, and maps to DiscoveredAlbum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            { id: 'rg-1', title: 'Studio Album', 'first-release-date': '1975-01-01', 'primary-type': 'Album', 'secondary-types': [] },
            { id: 'rg-2', title: 'Live Album', 'first-release-date': '1976-01-01', 'primary-type': 'Album', 'secondary-types': ['Live'] },
          ],
        }),
      })
    );

    const result = await browseArtistLps('artist-1', 'Some Artist');

    expect(result).toEqual([
      {
        mbid: 'rg-1',
        title: 'Studio Album',
        primary_artist_name: 'Some Artist',
        primary_artist_mbid: 'artist-1',
        release_year: 1975,
        cover_url: 'https://coverartarchive.org/release-group/rg-1/front-500',
      },
    ]);
  });

  it('throws on a non-ok MusicBrainz response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(browseArtistLps('artist-1', 'Some Artist')).rejects.toThrow('musicbrainz_browse_503');
  });
});
```

Update the top-of-file import in `_lp.test.ts` to also pull in `browseArtistLps`:

```ts
import {
  isLpReleaseGroup,
  isAlbumOrEpReleaseGroup,
  mergeDiscovered,
  browseArtistLps,
  type ReleaseGroup,
  type DiscoveredAlbum,
} from './_lp';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- _lp.test.ts`
Expected: FAIL -- `browseArtistLps` is not exported from `./_lp`.

- [ ] **Step 3: Implement `browseArtistLps` in `_lp.ts`**

Add to `web/api/_lp.ts` (after the existing `DiscoveredAlbum` type, before `mergeDiscovered`):

```ts
export const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
export const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_TIMEOUT_MS = 8000;

export function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

function releaseYear(group: ReleaseGroup): number | null {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

/** Fetches an artist's studio LPs directly from MusicBrainz -- no
 *  persistence. Shared by discover-artist.ts's write-key-gated persist path
 *  and browse-artist.ts's unauthenticated browse-only path, so both always
 *  apply the same LP filter and the same upstream timeout. */
export async function browseArtistLps(
  artistMbid: string,
  artistName: string
): Promise<DiscoveredAlbum[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MB_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({ artist: artistMbid, type: 'album', limit: '100', fmt: 'json' });
    const res = await fetch(`${MB_BASE}/release-group?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`musicbrainz_browse_${res.status}`);
    const data = (await res.json()) as { 'release-groups'?: ReleaseGroup[] };
    return (data['release-groups'] ?? []).filter(isLpReleaseGroup).map((group) => ({
      mbid: group.id,
      title: group.title,
      primary_artist_name: artistName,
      primary_artist_mbid: artistMbid,
      release_year: releaseYear(group),
      cover_url: coverUrlFor(group.id),
    }));
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('musicbrainz_browse_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- _lp.test.ts`
Expected: PASS

- [ ] **Step 5: Point `discover-artist.ts` at the shared helper**

In `web/api/discover-artist.ts`:
- Delete the local `USER_AGENT`, `MB_BASE` consts (currently lines 8-9).
- Delete the local `coverUrlFor` function (currently lines 20-22).
- Delete the local `releaseYear` function and `fetchArtistLps` function (currently lines 91-113).
- Add to the top-of-file import block: `import { isLpReleaseGroup, mergeDiscovered, browseArtistLps, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';` (replaces the existing `_lp.js` import line, which already imports `isLpReleaseGroup`, `mergeDiscovered`, and the two types -- just add `browseArtistLps` to it).
- At the call site (currently line 192), change `const lps = await fetchArtistLps(validated.artistMbid, validated.artistName);` to `const lps = await browseArtistLps(validated.artistMbid, validated.artistName);`.

- [ ] **Step 6: Run the full API test suite**

Run: `cd web && npm run test -- api/`
Expected: PASS (existing `discover-artist.test.ts` GET test and all `_lp.test.ts` tests green; no behavior change to `discover-artist.ts` other than the new 8s timeout it now inherits, which does not affect the existing GET-only test).

- [ ] **Step 7: Commit**

```bash
cd web
git add api/_lp.ts api/_lp.test.ts api/discover-artist.ts
git commit -m "refactor: extract shared MusicBrainz artist-browse helper into _lp.ts"
```

---

### Task 2: New `GET /api/browse-artist` route (unauthenticated, no persistence)

**Files:**
- Create: `web/api/browse-artist.ts`
- Test: `web/api/browse-artist.test.ts`

**Interfaces:**
- Consumes: `browseArtistLps` from `./_lp.js` (Task 1).
- Produces: `GET /api/browse-artist?artist_mbid=<uuid>&artist_name=<string>` -> `200 { albums: DiscoveredAlbum[] }` | `400 { error: 'invalid_artist_mbid' | 'missing_artist_name' | 'artist_name_too_long' }` | `405 { error: 'method_not_allowed' }` | `502 { error: 'musicbrainz_unavailable' }`.
- Consumed by: `web/src/discovery.ts` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `web/api/browse-artist.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './browse-artist';

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

function getReq(query: Record<string, string>) {
  return { method: 'GET', query };
}

const VALID_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';

describe('/api/browse-artist GET', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-GET methods', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('rejects an invalid artist_mbid', async () => {
    const res = makeRes();
    await handler(getReq({ artist_mbid: 'not-a-uuid', artist_name: 'Radiohead' }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_artist_mbid' });
  });

  it('rejects a missing artist_name', async () => {
    const res = makeRes();
    await handler(getReq({ artist_mbid: VALID_MBID, artist_name: '' }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'missing_artist_name' });
  });

  it('returns the filtered, mapped albums on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            { id: 'rg-1', title: 'OK Computer', 'first-release-date': '1997-01-01', 'primary-type': 'Album', 'secondary-types': [] },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ artist_mbid: VALID_MBID, artist_name: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      albums: [
        {
          mbid: 'rg-1',
          title: 'OK Computer',
          primary_artist_name: 'Radiohead',
          primary_artist_mbid: VALID_MBID,
          release_year: 1997,
          cover_url: 'https://coverartarchive.org/release-group/rg-1/front-500',
        },
      ],
    });
  });

  it('returns 502 when the MusicBrainz fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = makeRes();

    await handler(getReq({ artist_mbid: VALID_MBID, artist_name: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'musicbrainz_unavailable' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- browse-artist.test.ts`
Expected: FAIL -- `./browse-artist` module does not exist.

- [ ] **Step 3: Implement the route**

Create `web/api/browse-artist.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { browseArtistLps } from './_lp.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const artistMbid = typeof req.query.artist_mbid === 'string' ? req.query.artist_mbid : '';
  if (!UUID_RE.test(artistMbid)) {
    res.status(400).json({ error: 'invalid_artist_mbid' });
    return;
  }

  const artistName = typeof req.query.artist_name === 'string' ? req.query.artist_name.trim() : '';
  if (!artistName) {
    res.status(400).json({ error: 'missing_artist_name' });
    return;
  }
  if (artistName.length > MAX_NAME_LENGTH) {
    res.status(400).json({ error: 'artist_name_too_long' });
    return;
  }

  // Unauthenticated public route proxying MusicBrainz, same reasoning as
  // search-album.ts / search-artist.ts: let Vercel's edge absorb repeat
  // browses of the same artist rather than every hit going to MusicBrainz.
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  try {
    const albums = await browseArtistLps(artistMbid, artistName);
    res.status(200).json({ albums });
  } catch {
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- browse-artist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd web
git add api/browse-artist.ts api/browse-artist.test.ts
git commit -m "feat: add unauthenticated read-only /api/browse-artist route"
```

---

### Task 3: Route `discoverArtistDetailed` through browse when locked; remove the dead `'locked'` status

**Files:**
- Modify: `web/src/discovery.ts`
- Modify: `web/src/discovery.test.ts`
- Modify: `web/src/ui/artistBatchView.ts:8-10` (type), `:271-272` (dead branch)
- Modify: `web/src/main.ts:581-584` (dead branch in `handleDiscoverArtist`), `:813` (dead line in the pre-existing `handleSelectSearchedArtist` -- see Step 6.5), `:621` (Tier-2 gating -- see Step 7)
- Modify: `web/src/bulkDiscovery.ts` (see Step 7)
- Modify: `web/src/bulkDiscovery.test.ts` (see Step 7)

**Interfaces:**
- Produces: `DiscoverArtistResult = { status: 'found'; albums: Album[] } | { status: 'empty' } | { status: 'error' }` (the `'locked'` member is removed) from `web/src/discovery.ts`. Same exported function names (`discoverArtistDetailed`, `discoverArtist`, `loadDiscoveredAlbums`) and signatures as before.
- Consumes: `GET /api/browse-artist` (Task 2).
- Consumed by: `web/src/ui/artistBatchView.ts`'s `ArtistDiscoverViewResult` (now also drops `'locked'`), `web/src/main.ts`'s `handleDiscoverArtist` and (Task 5) `handleSelectSearchedArtist`, and `web/src/bulkDiscovery.ts`'s `runBulkDiscovery`/`runSimilarExpansion` (Step 7 -- a call site missed in the original grounding pass for this plan, found when Task 3 was first attempted and `npm run build` surfaced it).
- Produces (Step 7): `runBulkDiscovery`'s return type drops its `locked: boolean` field -- it's now always `false`, since a locked `discover` call browses instead of failing identically every time.

### Deviation found during Task 3's first attempt

The original plan for this task covered `discovery.ts`, `discovery.test.ts`, `artistBatchView.ts`, and `main.ts`'s `handleDiscoverArtist` -- four call sites of `discoverArtistDetailed` that the grounding pass (see the plan's own commit history) found before writing this document. A fifth and sixth existed and were missed: `main.ts:813`, a line inside the *pre-existing* `handleSelectSearchedArtist` that Task 4 deletes wholesale but which still breaks compilation the moment `'locked'` leaves the type; and `web/src/bulkDiscovery.ts`, whose "discover more albums" bulk-action short-circuits on `result.status === 'locked'` and whose caller in `main.ts` (`handleBulkDiscover`, around line 621) gates Tier-2 similar-artist expansion on a `result.locked` field that only that module produces. Confirmed with Keith via AskUserQuestion before extending this task: apply the same locked-browse treatment consistently rather than leaving `bulkDiscovery.ts` with permanently-dead (but type-legal, since it's an `if` on a union member that still exists until this task runs) `'locked'` branches. Steps 6.5 and 7 below cover this.

- [ ] **Step 1: Update the failing/changing test**

In `web/src/discovery.test.ts`, replace the existing "returns a locked status when no write key is stored" test with one that verifies the browse path is used instead:

```ts
it('browses instead of persisting when no write key is stored', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ albums: [album('a')] }),
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);

  const result = await discoverArtistDetailed(
    '11111111-1111-4111-8111-111111111111',
    'Radiohead',
    'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    []
  );

  expect(result).toEqual({ status: 'found', albums: [album('a')] });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/browse-artist?artist_mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711&artist_name=Radiohead'
  );
});

it('returns an empty status when browsing finds nothing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ albums: [] }) } as unknown as Response)
  );

  const result = await discoverArtistDetailed(
    '11111111-1111-4111-8111-111111111111',
    'Radiohead',
    'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    []
  );

  expect(result).toEqual({ status: 'empty' });
});

it('returns an error status when the browse fetch fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

  const result = await discoverArtistDetailed(
    '11111111-1111-4111-8111-111111111111',
    'Radiohead',
    'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    []
  );

  expect(result).toEqual({ status: 'error' });
});
```

Leave the rest of `discovery.test.ts` (the `describe('discoverArtist', ...)` block covering the unlocked/persist path) untouched -- that behavior isn't changing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- discovery.test.ts`
Expected: FAIL -- current `discoverArtistDetailed` still short-circuits to `{ status: 'locked' }` without calling `fetch`.

- [ ] **Step 3: Implement the browse branch in `discovery.ts`**

Replace the full contents of `web/src/discovery.ts` with:

```ts
import type { Album } from './ranking/types';
import { getWriteKey, writeKeyHeaders } from './writeKey';
import { parseAlbumArray } from './album';

export type DiscoverArtistResult =
  | { status: 'found'; albums: Album[] }
  | { status: 'empty' }
  | { status: 'error' };

export async function loadDiscoveredAlbums(sessionId: string): Promise<Album[]> {
  let response: Response;
  try {
    response = await fetch(`/api/discover-artist?session_id=${encodeURIComponent(sessionId)}`);
  } catch {
    return [];
  }
  if (!response.ok) return [];

  try {
    const body = (await response.json()) as { albums?: unknown };
    return parseAlbumArray(body.albums);
  } catch {
    return [];
  }
}

async function browseArtist(artistName: string, artistMbid: string): Promise<DiscoverArtistResult> {
  let response: Response;
  try {
    response = await fetch(
      `/api/browse-artist?artist_mbid=${encodeURIComponent(artistMbid)}&artist_name=${encodeURIComponent(artistName)}`
    );
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };

  try {
    const body = (await response.json()) as { albums?: unknown };
    const albums = parseAlbumArray(body.albums);
    return albums.length > 0 ? { status: 'found', albums } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}

export async function discoverArtistDetailed(
  sessionId: string,
  artistName: string,
  artistMbid: string,
  knownMbids: string[]
): Promise<DiscoverArtistResult> {
  // No write key: browse-only, no persistence -- see docs/superpowers/specs/
  // 2026-08-05-unified-artist-search-design.md's "Write-key branching
  // mechanism". `knownMbids` is ignored here: browse never persists, so
  // there's no server-side "previously discovered" set to merge against;
  // every caller already dedupes the returned albums against its own local
  // pool by mbid.
  if (!getWriteKey()) return browseArtist(artistName, artistMbid);

  let response: Response;
  try {
    response = await fetch('/api/discover-artist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...writeKeyHeaders() },
      body: JSON.stringify({
        session_id: sessionId,
        artist_name: artistName,
        artist_mbid: artistMbid,
        known_mbids: knownMbids,
      }),
    });
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };

  try {
    const body = (await response.json()) as { albums?: unknown };
    const albums = parseAlbumArray(body.albums);
    return albums.length > 0 ? { status: 'found', albums } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}

export async function discoverArtist(
  sessionId: string,
  artistName: string,
  artistMbid: string,
  knownMbids: string[]
): Promise<Album[]> {
  const result = await discoverArtistDetailed(sessionId, artistName, artistMbid, knownMbids);
  return result.status === 'found' ? result.albums : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Remove the now-dead `'locked'` handling from `artistBatchView.ts`**

In `web/src/ui/artistBatchView.ts`:
- Change (currently lines 8-10):
  ```ts
  export type ArtistDiscoverViewResult =
    | { status: 'found'; count: number }
    | { status: 'empty' | 'locked' | 'error' };
  ```
  to:
  ```ts
  export type ArtistDiscoverViewResult =
    | { status: 'found'; count: number }
    | { status: 'empty' | 'error' };
  ```
- Delete the now-unreachable branch (currently lines 271-272):
  ```ts
  } else if (result.status === 'locked') {
    discoverMessage = 'Unlock writes to discover more albums.';
  ```
  leaving the surrounding `if/else if/else` in `discoverAlbums()` as a plain `found` / `empty` / else-error chain.

- [ ] **Step 6: Remove the now-dead `'locked'` handling from `main.ts`'s `handleDiscoverArtist`**

In `web/src/main.ts`, delete this block (currently lines 581-584):

```ts
    if (discoveredResult.status === 'locked') {
      rankList.showStatus('Unlock writes to discover more albums.');
      return;
    }
```

`handleDiscoverArtist` will now type-check straight through: `discoveredResult.status` can only be `'error' | 'empty' | 'found'` at that point, matching the updated `DiscoverArtistResult`.

- [ ] **Step 6.5: Delete the one dead line in the pre-existing `handleSelectSearchedArtist`**

`web/src/main.ts` currently has an *older* `handleSelectSearchedArtist` function (the one Task 4 deletes wholesale, replaced by a differently-shaped one in Task 5). Leave the rest of that function exactly as-is -- Task 4 owns its removal -- but delete just this one line so the file compiles at this task's commit (currently line 813):

```ts
    if (result.status === 'locked') return { status: 'locked' };
```

This changes nothing observable: `ArtistSelectResult` (defined in the soon-to-be-deleted `artistSearchView.ts`) still has a `'locked'` member of its own -- unrelated to `DiscoverArtistResult` -- so the surrounding `return { status: 'error' | 'empty' }` lines and the function's return type are untouched. Only the now-uncompilable `result.status === 'locked'` check goes.

- [ ] **Step 7: Apply the same locked-browse treatment to `bulkDiscovery.ts`**

In `web/src/bulkDiscovery.ts`:
- In `runBulkDiscovery`, delete the now-dead branch (currently lines 62-63):
  ```ts
    if (result.status === 'locked') {
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.', found: 0, locked: true };
    } else if (result.status === 'error') {
  ```
  becomes:
  ```ts
    if (result.status === 'error') {
  ```
  (the `} else if (result.status === 'error') {` loses its `else`, becoming a plain `if`).
- Drop the `locked: boolean` field from `runBulkDiscovery`'s return type (line 41) and from its two other return statements (lines 44, 84): `{ priorityQueue, summary: 'Rank some albums first.', found: 0 }` and `{ priorityQueue: [...newQueue, ...priorityQueue], summary, found: foundCount }`.
- In `runSimilarExpansion`, delete the same dead branch (currently lines 191-192):
  ```ts
    if (result.status === 'locked') {
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.' };
    } else if (result.status === 'error') {
  ```
  becomes:
  ```ts
    if (result.status === 'error') {
  ```

In `web/src/main.ts`'s `handleBulkDiscover`, simplify the Tier-2 gate (currently line 621):
```ts
      if (!result.locked && result.found === 0) {
```
becomes:
```ts
      if (result.found === 0) {
```
(the comment above it, "Not on locked writes (every call would fail identically)", no longer applies -- a locked call now browses instead of failing, so delete that clause from the comment, keeping the "not when Tier 1 actually found albums" reasoning.)

In `web/src/bulkDiscovery.test.ts` (uses this file's existing `album()`, `rankedFor()`, `radiohead`, `bjork` fixtures already defined at the top of the file -- don't invent new ones):

- Replace the `runBulkDiscovery` test `'short-circuits with an unlock message when the first call is locked'` (currently lines 88-104) with:
  ```ts
  it('continues past a single error and reports the failure, instead of short-circuiting', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'error' }));

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      ['existing-mbid'],
      { discover, delayMs: 0 }
    );

    expect(result.found).toBe(0);
    expect(result.summary).toBe('Added 0 new albums from 2 artists. 0 already fully discovered, 2 failed.');
    expect(discover).toHaveBeenCalledTimes(2);
  });
  ```
  (this is the direct replacement for the old locked-short-circuit test -- `discover` failing on every call no longer stops the loop early, it just accumulates failures like any other artist-level error already covered by the neighboring `'continues the batch when one artist errors...'` test.)
- In the `'returns a "rank some albums first" message and makes no calls when nothing is ranked'` test (currently around line 160-169), remove `locked: false,` from the expected object (currently line 167), leaving `{ priorityQueue: ['old-mbid'], summary: 'Rank some albums first.', found: 0 }`.
- Replace the `runSimilarExpansion` test `'short-circuits with an unlock message when a discovery call is locked'` (currently lines 293-311) with:
  ```ts
  it('continues past a discover error instead of short-circuiting', async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => [
      { mbid: 'artist-pixies', name: 'Pixies', score: 90 },
    ]);
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'error' }));

    const result = await runSimilarExpansion(
      rankedFor([radiohead]),
      [],
      ['old-mbid'],
      [],
      { fetchSimilar, discover, delayMs: 0 }
    );

    expect(result.priorityQueue).toEqual(['old-mbid']);
    expect(result.summary).toContain('1 failed');
  });
  ```

- [ ] **Step 8: Run the full test suite and build**

Run: `cd web && npm run test && npm run build`
Expected: All tests PASS; `tsc` reports no type errors (this is the check that catches any remaining reference to the removed `'locked'` member, across all six files this task now touches).

- [ ] **Step 9: Commit**

```bash
cd web
git add src/discovery.ts src/discovery.test.ts src/ui/artistBatchView.ts src/main.ts src/bulkDiscovery.ts src/bulkDiscovery.test.ts
git commit -m "feat: split artist discovery into locked-browse and unlocked-persist paths"
```

---

### Task 4: Delete the separate "Add a band" view and its wiring

**Files:**
- Delete: `web/src/ui/artistSearchView.ts`
- Modify: `web/src/main.ts` (removals listed below)
- Modify: `web/src/ui/rankList.ts:126-130` (option), `:934-941` (button)
- Modify: `web/src/style.css:388-392`

**Interfaces:**
- Removes: `mountArtistSearchView`, `ArtistSearchViewOptions`, `ArtistSearchViewController`, `ArtistSelectResult`, `ArtistSearchResultsState` (all from the deleted file). Nothing downstream of this task depends on any of them (confirmed: only `main.ts` imports from `artistSearchView.ts`).
- Removes: `RankListOptions.onOpenArtistSearch` from `web/src/ui/rankList.ts` (Task 5 replaces the button this option drove with a different mechanism -- band-hit rows in the merged results, not a standalone button).

This task is a pure deletion/revert with no new behavior, so there is no TDD red/green cycle -- verify with the existing test suite and a build instead.

- [ ] **Step 1: Delete the view file**

```bash
cd web
rm src/ui/artistSearchView.ts
```

- [ ] **Step 2: Remove the "+ Add a band" button and its option from `rankList.ts`**

In `web/src/ui/rankList.ts`:
- Delete the `onOpenArtistSearch` option from `RankListOptions` (currently lines 126-130):
  ```ts
    /** Open the dedicated artist-name search ("Add a band"), a second entry
     *  point alongside the album-title search above it -- lets the owner jump
     *  straight into the artist-batch view for a band with no albums owned
     *  yet. Omit to hide the button entirely. */
    onOpenArtistSearch?: () => void;
  ```
- In `buildSearchBox()`, delete the button block (currently lines 934-941):
  ```ts
    if (opts.onOpenArtistSearch) {
      const addBandBtn = document.createElement('button');
      addBandBtn.type = 'button';
      addBandBtn.className = 'candidate-action rank-search-add-band';
      addBandBtn.textContent = '+ Add a band';
      addBandBtn.addEventListener('click', () => opts.onOpenArtistSearch?.());
      wrap.append(addBandBtn);
    }
  ```

(Leave the rest of `buildSearchBox` -- the input element and its placeholder/aria-label -- untouched here; Task 5 updates those.)

- [ ] **Step 3: Remove the CSS rule**

In `web/src/style.css`, delete (currently lines 388-392):

```css
/* Keeps the "+ Add a band" button at its natural width instead of being
   squeezed by .rank-search's flex row when the search input grows. */
.rank-search-add-band {
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Remove the artist-search wiring from `main.ts`**

In `web/src/main.ts`, remove each of the following (content-anchored; exact line numbers will have shifted slightly after Task 3's edits to this same file -- locate by the code shown):

1. The import block:
   ```ts
   import {
     mountArtistSearchView,
     type ArtistSelectResult,
     type ArtistSearchResultsState,
   } from './ui/artistSearchView';
   ```
2. `'artistSearch'` from the `ViewMode` union:
   ```ts
   type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistBatch' | 'artistSearch' | 'speedRound';
   ```
   becomes:
   ```ts
   type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistBatch' | 'speedRound';
   ```
3. The artist-search state block and its leading comment:
   ```ts
   // Artist-name search ("Add a band"): a second, dedicated search separate
   // from the one above, for jumping straight into the artist-batch view for
   // a band with none of its albums owned yet.
   let artistSearchQuery = '';
   let artistSearchResults: ArtistSearchResultsState = { status: 'idle' };
   let artistSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
   const ARTIST_SEARCH_DEBOUNCE_MS = 400;
   const ARTIST_SEARCH_MIN_LENGTH = 2;
   ```
4. `let artistSearchController: ReturnType<typeof mountArtistSearchView> | null = null;`
5. `handleOpenArtistSearch`, `handleArtistSearchQueryChange`, `handleSelectSearchedArtist`, and `renderArtistSearchView` in full (including `renderArtistSearchView`'s preceding multi-line comment) -- everything between the line `function handleOpenArtistSearch(): void {` and the closing brace of `renderArtistSearchView`. (Task 5 adds a *new*, differently-shaped `handleSelectSearchedArtist` back in -- deleting the old one here first keeps the two changes from tangling in one diff.)
6. Inside `showView`, the artist-search leave-teardown block:
   ```ts
       if (view === 'artistSearch' && next !== 'artistSearch') {
         artistSearchController?.teardown();
         artistSearchController = null;
         if (artistSearchDebounceTimer !== null) {
           clearTimeout(artistSearchDebounceTimer);
           artistSearchDebounceTimer = null;
         }
       }
   ```
   and the render branch:
   ```ts
       } else if (view === 'artistSearch') {
         renderArtistSearchView();
   ```
   (folding back into the preceding `if/else if` chain -- e.g. if it currently reads `... } else if (view === 'artistBatch') { renderArtistBatchView(); } else if (view === 'artistSearch') { renderArtistSearchView(); } else if (view === 'speedRound') { ...`, the artist-search arm simply drops out).
7. In the `mountRankList(stage, { ... })` call, delete the line `onOpenArtistSearch: handleOpenArtistSearch,`.

Leave `import { searchArtists, type ArtistResult } from './artistSearch';` (near the top of the file) untouched -- Task 5 reuses both.

- [ ] **Step 5: Run the full test suite and build**

Run: `cd web && npm run test && npm run build`
Expected: All tests PASS; `tsc` reports no type errors and no unused-import/unused-variable errors (this catches any leftover reference to the deleted view or its removed state).

- [ ] **Step 6: Commit**

```bash
cd web
git add -A src/ui/artistSearchView.ts src/main.ts src/ui/rankList.ts src/style.css
git commit -m "refactor: delete the separate Add-a-band view ahead of the merged search"
```

---

### Task 5: Merge band results into the album search box

**Files:**
- Modify: `web/src/ui/rankList.ts` (type, options, new row builder, `buildMusicBrainzFallback`, `buildSearchBox` copy)
- Modify: `web/src/main.ts` (state, `onSearchMusicBrainz` rewrite, new `handleSelectSearchedArtist`, `mountRankList` wiring)
- Modify: `web/src/style.css` (new section-label rule)

**Interfaces:**
- Produces (from `rankList.ts`): `SearchResultsState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'done'; albums: Album[]; artists: ArtistResult[] }` (exported; replaces the album-only version). New `RankListOptions` members: `onSelectArtist?: (artist: ArtistResult) => void`, `getSelectingArtistMbid?: () => string | null`, `getArtistSelectMessage?: () => string | null`.
- Consumes (in `main.ts`): `searchArtists` from `./artistSearch` (already imported, untouched by Task 4), `discoverArtistDetailed` from `./discovery` (Task 3's updated signature, no `'locked'` status).

- [ ] **Step 1: Extend `SearchResultsState` and the options in `rankList.ts`**

Add the import at the top of `web/src/ui/rankList.ts`:

```ts
import type { ArtistResult } from '../artistSearch';
```

Replace the existing `SearchResultsState` type (currently lines 28-32):

```ts
export type SearchResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; albums: Album[] };
```

with:

```ts
export type SearchResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; albums: Album[]; artists: ArtistResult[] };
```

In `RankListOptions`, add these three members (a natural place is right after `onRateSearchResult`, where `onOpenArtistSearch` used to sit before Task 4 removed it):

```ts
  /** Tapped "See albums" on a band hit from the merged MusicBrainz search --
   *  album hits rate directly via onRateSearchResult above; band hits go
   *  through this instead. The caller owns the discovery fetch and any
   *  resulting view navigation. Omit to hide band-hit rows entirely. */
  onSelectArtist?: (artist: ArtistResult) => void;
  /** mbid of the band-hit row currently fetching its albums, for the
   *  "Loading…" button state. Omit (or return null) when nothing is in
   *  flight. */
  getSelectingArtistMbid?: () => string | null;
  /** A one-shot message to show below the results after a band-hit
   *  selection resolves (e.g. "No albums found for X."). Omit (or return
   *  null) to show nothing. */
  getArtistSelectMessage?: () => string | null;
```

- [ ] **Step 2: Update the search box placeholder/aria-label**

In `buildSearchBox()`, change:

```ts
    input.placeholder = 'Search your albums';
    input.setAttribute('aria-label', 'Search your albums');
```

to:

```ts
    input.placeholder = 'Search your albums or bands';
    input.setAttribute('aria-label', 'Search your albums or bands');
```

- [ ] **Step 3: Add `artistSubtitle` and `buildArtistResultRow`**

Add these two functions to `rankList.ts`, just above `buildMusicBrainzFallback` (they follow the same shape as `artistSearchView.ts`'s deleted `subtitle`/`buildResultRow`, adapted to this file's existing `opts.getSelectingArtistMbid`/`onSelectArtist` options instead of module-local state):

```ts
  function artistSubtitle(artist: ArtistResult): string {
    const parts = [artist.disambiguation, artist.type, artist.country].filter(
      (part): part is string => !!part
    );
    return parts.join(' · ');
  }

  function buildArtistResultRow(artist: ArtistResult): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-search-result';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const name = document.createElement('p');
    name.className = 'rank-title';
    name.textContent = artist.name;
    meta.append(name);
    const sub = artistSubtitle(artist);
    if (sub) {
      const subEl = document.createElement('p');
      subEl.className = 'rank-sub';
      subEl.textContent = sub;
      meta.append(subEl);
    }
    li.append(meta);

    const selectingMbid = opts.getSelectingArtistMbid?.() ?? null;
    const isSelecting = selectingMbid === artist.mbid;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate-action';
    btn.textContent = isSelecting ? 'Loading…' : 'See albums';
    btn.disabled = selectingMbid !== null;
    btn.setAttribute('aria-label', `See albums by ${artist.name}`);
    btn.addEventListener('click', () => opts.onSelectArtist?.(artist));
    li.append(btn);

    return li;
  }
```

(Note: this file already has a module-level `subtitle(album: Album)` at line 162 for album rows -- `artistSubtitle` is a distinct name specifically to avoid colliding with it.)

- [ ] **Step 4: Render both sections in `buildMusicBrainzFallback`**

Replace the `'done'` branch of `buildMusicBrainzFallback` (currently the tail of the function, from `// status === 'done'` through its closing `return wrap;`):

```ts
    // status === 'done'
    if (results.albums.length === 0) {
      const none = document.createElement('p');
      none.className = 'rank-search-status';
      none.textContent = 'No albums found.';
      wrap.append(none);
      return wrap;
    }

    const resultsList = document.createElement('ul');
    resultsList.className = 'rank-search-results';
    for (const album of results.albums) {
      resultsList.append(buildSearchResultRow(album));
    }
    wrap.append(resultsList);
    return wrap;
```

with:

```ts
    // status === 'done'
    if (results.albums.length === 0 && results.artists.length === 0) {
      const none = document.createElement('p');
      none.className = 'rank-search-status';
      none.textContent = 'No albums or bands found.';
      wrap.append(none);
      return wrap;
    }

    if (results.albums.length > 0) {
      const label = document.createElement('p');
      label.className = 'rank-search-section-label';
      label.textContent = 'Albums';
      const albumsList = document.createElement('ul');
      albumsList.className = 'rank-search-results';
      for (const album of results.albums) albumsList.append(buildSearchResultRow(album));
      wrap.append(label, albumsList);
    }

    if (results.artists.length > 0) {
      const label = document.createElement('p');
      label.className = 'rank-search-section-label';
      label.textContent = 'Bands';
      const artistsList = document.createElement('ul');
      artistsList.className = 'rank-search-results';
      for (const artist of results.artists) artistsList.append(buildArtistResultRow(artist));
      wrap.append(label, artistsList);
    }

    const selectMessage = opts.getArtistSelectMessage?.() ?? null;
    if (selectMessage) {
      const msg = document.createElement('p');
      msg.className = 'rank-search-status';
      msg.textContent = selectMessage;
      wrap.append(msg);
    }

    return wrap;
```

- [ ] **Step 5: Add the section-label CSS**

Add to `web/src/style.css`, near the other `.rank-search-*` rules (e.g. right after `.rank-search-status`):

```css
.rank-search-section-label {
  margin: 0.75rem 0 0.25rem;
  color: var(--color-muted);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.rank-search-section-label:first-child {
  margin-top: 0;
}
```

- [ ] **Step 6: Update `main.ts`'s search state and import**

Change the `mountRankList` import (currently `import { mountRankList } from './ui/rankList';`) to also pull in the type:

```ts
import { mountRankList, type SearchResultsState } from './ui/rankList';
```

Delete the local, now-redundant type declaration (currently part of lines 397-403):

```ts
  type SearchResultsState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'done'; albums: Album[] };
```

leaving `let searchQuery = '';` and `let searchResults: SearchResultsState = { status: 'idle' };` in place (now typed against the imported, extended union).

Add two new state variables near that block (where the artist-search state used to live before Task 4 removed it):

```ts
  // Band-hit selection from the merged search box below: which artist (if
  // any) is mid-fetch, and the one-shot message to show once it resolves.
  let selectingArtistMbid: string | null = null;
  let artistSelectMessage: string | null = null;
```

- [ ] **Step 7: Rewrite `onSearchMusicBrainz` to fetch both albums and artists**

Replace the existing `onSearchMusicBrainz` handler inside the `mountRankList(stage, { ... })` call:

```ts
    onSearchMusicBrainz: (query) => {
      void (async () => {
        // Guard against a stale response landing after the user kept typing:
        // capture the query this fetch is FOR, and discard the result if the
        // live search box has since moved on to a different query.
        const forQuery = query.trim();
        searchResults = { status: 'loading' };
        rankList.render();
        let next: SearchResultsState;
        try {
          const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}`);
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { albums: Album[] };
          next = { status: 'done', albums: body.albums ?? [] };
        } catch {
          next = { status: 'error' };
        }
        if (searchQuery.trim() !== forQuery) return; // stale response, discard
        searchResults = next;
        rankList.render();
      })();
    },
```

with:

```ts
    onSearchMusicBrainz: (query) => {
      void (async () => {
        // Guard against a stale response landing after the user kept typing:
        // capture the query this fetch is FOR, and discard the result if the
        // live search box has since moved on to a different query.
        const forQuery = query.trim();
        searchResults = { status: 'loading' };
        rankList.render();

        // Album and band results come from two independent MusicBrainz
        // endpoints, fired together. Each is caught on its own so one
        // failing doesn't blank out the other -- only report 'error' when
        // BOTH fail.
        const albumsPromise: Promise<Album[] | null> = (async () => {
          try {
            const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error(String(res.status));
            const body = (await res.json()) as { albums: Album[] };
            return body.albums ?? [];
          } catch {
            return null;
          }
        })();

        const [albums, artistOutcome] = await Promise.all([albumsPromise, searchArtists(query)]);
        const artists = artistOutcome.status === 'found' ? artistOutcome.artists : [];

        const next: SearchResultsState =
          albums === null && artistOutcome.status === 'error'
            ? { status: 'error' }
            : { status: 'done', albums: albums ?? [], artists };

        if (searchQuery.trim() !== forQuery) return; // stale response, discard
        searchResults = next;
        rankList.render();
      })();
    },
```

- [ ] **Step 8: Add the new `handleSelectSearchedArtist` and wire it in**

Add this function (in place of where Task 4 deleted the old `handleSelectSearchedArtist`/`handleOpenArtistSearch`/`handleArtistSearchQueryChange`/`renderArtistSearchView` block):

```ts
  async function handleSelectSearchedArtist(artist: ArtistResult): Promise<void> {
    if (selectingArtistMbid) return; // a selection is already in flight
    selectingArtistMbid = artist.mbid;
    artistSelectMessage = null;
    rankList.render();

    const result = await discoverArtistDetailed(session.session_id, artist.name, artist.mbid, []);

    // The owner may have navigated away from the ranked view (where the
    // merged search box lives) while this was in flight -- discard a
    // response that no longer applies.
    if (view !== 'ranked') return;
    selectingArtistMbid = null;

    if (result.status === 'error') {
      artistSelectMessage = `Could not load ${artist.name}'s albums.`;
      rankList.render();
      return;
    }
    if (result.status === 'empty') {
      artistSelectMessage = `No albums found for ${artist.name}.`;
      rankList.render();
      return;
    }

    const found = result.albums;
    const poolIds = new Set(pool.map((a) => a.mbid));
    for (const album of found) {
      if (!poolIds.has(album.mbid)) {
        pool.push(album);
        poolIds.add(album.mbid);
      }
    }
    // Pool just grew: if every existing album was already placed, candidate
    // was null -- same reselect-if-exhausted convention as markAsHeard /
    // restoreArtist / the old artist-search flow this replaces.
    if (!candidate) reselectCandidate();

    searchQuery = '';
    searchResults = { status: 'idle' };
    batchArtistMbid = artist.mbid;
    showView('artistBatch');
  }
```

In the `mountRankList(stage, { ... })` call, add (near `onRateSearchResult`, where `onOpenArtistSearch` used to be before Task 4 removed it):

```ts
    onSelectArtist: (artist) => {
      void handleSelectSearchedArtist(artist);
    },
    getSelectingArtistMbid: () => selectingArtistMbid,
    getArtistSelectMessage: () => artistSelectMessage,
```

- [ ] **Step 9: Run the full test suite and build**

Run: `cd web && npm run test && npm run build`
Expected: All tests PASS; `tsc` reports no type errors.

- [ ] **Step 10: Manual verification in the browser**

Run: `cd web && npm run dev`, open the printed local URL.

Walk through, on the "Ranked list" view:
1. Type an album title that exists locally (already ranked) -- confirm local filtering still works unchanged (this path doesn't touch MusicBrainz).
2. Type a query with no local match -- confirm the "Search MusicBrainz" prompt appears, and tapping it shows "Searching MusicBrainz…" then results.
3. Search for a well-known band name (e.g. "Radiohead") with no local album matches -- confirm both an "Albums" section (individual releases matching the text search) and a "Bands" section (the artist itself) can appear, each only when non-empty.
4. Tap "See albums" on a band hit:
   - With no write key set (locked): confirm it still resolves (via the new browse-only path) and navigates into the artist-batch view showing that band's albums, with NO record written to Turso (spot-check: reload the page, confirm the browsed-but-unrated albums are gone, since browse never persists).
   - With a write key set (`Unlock writes`): confirm the same tap now persists via `/api/discover-artist` as before (reload the page, confirm the discovered albums are still present even without rating them).
5. Confirm the search box placeholder reads "Search your albums or bands".
6. Confirm the old "+ Add a band" button is gone from the search box.
7. At 360px viewport width, confirm both result sections and their buttons remain usable with no horizontal scroll.

- [ ] **Step 11: Commit**

```bash
cd web
git add src/ui/rankList.ts src/main.ts src/style.css
git commit -m "feat: merge band results into the album search box"
```

---

## Self-review notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-08-05-unified-artist-search-design.md` maps to a task -- data flow and write-key mechanism to Tasks 1-3 and 5, file-level changes to Tasks 1-5, error handling (MusicBrainz timeout/502, partial-failure merge, shared rate limit via `Cache-Control`) to Tasks 1-2 and 5, testing to each task's own test steps. The two spec items marked "deferred to planning" are resolved above (band-hit copy, result layout) and confirmed with Keith before this plan was written.
- **Type consistency checked:** `DiscoverArtistResult` (Task 3) drops `'locked'`; every consumer of that type (`artistBatchView.ts`'s `ArtistDiscoverViewResult`, `main.ts`'s `handleDiscoverArtist` and new `handleSelectSearchedArtist`) is updated in the same task or built directly against the new 3-member union, so no task leaves a dangling reference to the removed status. `SearchResultsState` (Task 5) is defined once in `rankList.ts` and imported (not re-declared) in `main.ts`, so the two can't drift out of sync the way the pre-existing duplicate did.
- **No placeholders:** every step has literal code or an exact command; no "add error handling"-style steps.
