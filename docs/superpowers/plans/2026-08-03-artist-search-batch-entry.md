# Artist Search "Add a Band" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner search for a band by name and land directly in the existing artist-batch ranking view with that band's full discography already loaded, without first needing to own one of their albums.

**Architecture:** A new read-only MusicBrainz-proxying API route (`search-artist`) plus a thin client wrapper and a new mount/teardown view module, wired into a new `'artistSearch'` `ViewMode` in `main.ts`. Selecting a result reuses the existing `discoverArtistDetailed` call and the existing `artistBatchView` — no changes to either.

**Tech Stack:** Vite 8 + TypeScript 6, Vercel serverless functions (`@vercel/node`), Vitest.

## Global Constraints

- Render with safe DOM construction (`createElement`/`textContent`), never `innerHTML`.
- Mobile is the primary device: tap targets ≥ 44px, usable at 360px width, no horizontal scroll.
- File size cap: 300 lines per file. All new files here are well under that.
- New files use this project's established camelCase filename convention (`discovery.ts`, `artistBatchView.ts`, `speedRound.ts`), not the generic kebab-case default — match what's already in `web/src` and `web/src/ui`.
- Don't use artist-name search where an MBID is already available for discovery — not violated here: the artist *search* is necessarily name-based (that's its purpose), but the actual discovery call after a result is picked always uses the MBID, exactly like the existing "discover more albums" flow.

---

## File Structure

- Create `web/api/search-artist.ts` — serverless route proxying MusicBrainz artist search.
- Create `web/api/search-artist.test.ts` — route tests.
- Create `web/src/artistSearch.ts` — client fetch wrapper + response validation.
- Create `web/src/artistSearch.test.ts` — wrapper tests.
- Create `web/src/ui/artistSearchView.ts` — mount/teardown view module (input + results list).
- Modify `web/src/ui/rankList.ts` — add `onOpenArtistSearch` option and the "+ Add a band" button.
- Modify `web/src/style.css` — one small rule so the new button doesn't get squeezed by the search input on narrow screens.
- Modify `web/src/main.ts` — new `ViewMode`, state, handlers, and view wiring.

---

### Task 1: `search-artist` API route

**Files:**
- Create: `web/api/search-artist.ts`
- Test: `web/api/search-artist.test.ts`

**Interfaces:**
- Produces: `GET /api/search-artist?q=<text>` → `200 { artists: ArtistResult[] }` where `ArtistResult = { mbid: string; name: string; disambiguation: string | null; type: string | null; country: string | null }`. Error responses: `405 { error: 'method_not_allowed' }`, `400 { error: 'missing_query' }`, `400 { error: 'query_too_long' }`, `502 { error: 'musicbrainz_unavailable' }`.

- [ ] **Step 1: Write the failing tests**

Create `web/api/search-artist.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './search-artist';

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

describe('/api/search-artist GET', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-GET methods', async () => {
    const res = makeRes();

    await handler({ method: 'POST', query: {} } as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('rejects a missing query', async () => {
    const res = makeRes();

    await handler(getReq({}) as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'missing_query' });
  });

  it('rejects a query over the length cap', async () => {
    const res = makeRes();

    await handler(getReq({ q: 'x'.repeat(201) }) as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'query_too_long' });
  });

  it('maps a MusicBrainz artist search response to ArtistResult[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          artists: [
            {
              id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
              name: 'Radiohead',
              type: 'Group',
              country: 'GB',
              disambiguation: 'English rock band',
            },
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Genesis',
              type: 'Group',
              country: 'GB',
            },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ q: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      artists: [
        {
          mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          name: 'Radiohead',
          disambiguation: 'English rock band',
          type: 'Group',
          country: 'GB',
        },
        {
          mbid: '11111111-1111-4111-8111-111111111111',
          name: 'Genesis',
          disambiguation: null,
          type: 'Group',
          country: 'GB',
        },
      ],
    });
  });

  it('returns 502 when MusicBrainz is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as unknown as Response));
    const res = makeRes();

    await handler(getReq({ q: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'musicbrainz_unavailable' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run api/search-artist.test.ts`
Expected: FAIL — `Cannot find module './search-artist'` (the handler doesn't exist yet).

- [ ] **Step 3: Write the route**

Create `web/api/search-artist.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 200;
const MB_TIMEOUT_MS = 8000;

type MbArtist = {
  id: string;
  name: string;
  disambiguation?: string;
  type?: string;
  country?: string;
};

export type ArtistResult = {
  mbid: string;
  name: string;
  disambiguation: string | null;
  type: string | null;
  country: string | null;
};

function toArtistResult(artist: MbArtist): ArtistResult {
  return {
    mbid: artist.id,
    name: artist.name,
    disambiguation: artist.disambiguation ?? null,
    type: artist.type ?? null,
    country: artist.country ?? null,
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
  if (q.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: 'query_too_long' });
    return;
  }

  // Same reasoning as search-album.ts: an unauthenticated public route
  // proxying MusicBrainz, which rate-limits per User-Agent (~1 req/s). Let
  // Vercel's edge absorb repeat queries for the same string.
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MB_TIMEOUT_MS);

  try {
    // Lucene-escape double quotes so a quoted query can't break the syntax.
    const params = new URLSearchParams({
      query: q.replace(/"/g, '\\"'),
      fmt: 'json',
      limit: String(MAX_RESULTS),
    });
    const mb = await fetch(`${MB_BASE}/artist/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!mb.ok) throw new Error(`musicbrainz_${mb.status}`);

    const data = (await mb.json()) as { artists?: MbArtist[] };
    const artists = (data.artists ?? []).slice(0, MAX_RESULTS).map(toArtistResult);

    res.status(200).json({ artists });
  } catch {
    // Covers both a non-ok MusicBrainz response and the AbortController
    // firing on a hung upstream.
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run api/search-artist.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd web
git add api/search-artist.ts api/search-artist.test.ts
git commit -m "feat(api): add MusicBrainz artist search route"
```

---

### Task 2: `artistSearch.ts` client wrapper

**Files:**
- Create: `web/src/artistSearch.ts`
- Test: `web/src/artistSearch.test.ts`

**Interfaces:**
- Consumes: `GET /api/search-artist?q=` from Task 1, response shape `{ artists: ArtistResult[] }`.
- Produces:
  ```ts
  export type ArtistResult = {
    mbid: string;
    name: string;
    disambiguation: string | null;
    type: string | null;
    country: string | null;
  };
  export type ArtistSearchOutcome =
    | { status: 'found'; artists: ArtistResult[] }
    | { status: 'empty' }
    | { status: 'error' };
  export async function searchArtists(query: string): Promise<ArtistSearchOutcome>
  ```
  Both consumed directly by `main.ts` (Task 5) and `artistSearchView.ts` (Task 3, for the `ArtistResult` type only).

- [ ] **Step 1: Write the failing tests**

Create `web/src/artistSearch.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchArtists } from './artistSearch';

function artist(mbid: string) {
  return {
    mbid,
    name: 'Radiohead',
    disambiguation: 'English rock band',
    type: 'Group',
    country: 'GB',
  };
}

describe('searchArtists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('short-circuits on a blank query without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchArtists('   ');

    expect(result).toEqual({ status: 'empty' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the artists from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ artists: [artist('a74b1b7f-71a5-4011-9441-d0b5e4122711')] }),
      } as unknown as Response)
    );

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({
      status: 'found',
      artists: [artist('a74b1b7f-71a5-4011-9441-d0b5e4122711')],
    });
  });

  it('returns an empty status for a successful response with no artists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ artists: [] }),
      } as unknown as Response)
    );

    const result = await searchArtists('zzzzzz');

    expect(result).toEqual({ status: 'empty' });
  });

  it('returns an error status on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({ status: 'error' });
  });

  it('returns an error status on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as unknown as Response));

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({ status: 'error' });
  });

  it('returns an error status on malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      } as unknown as Response)
    );

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({ status: 'error' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/artistSearch.test.ts`
Expected: FAIL — `Cannot find module './artistSearch'`.

- [ ] **Step 3: Write the wrapper**

Create `web/src/artistSearch.ts`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ArtistResult = {
  mbid: string;
  name: string;
  disambiguation: string | null;
  type: string | null;
  country: string | null;
};

export type ArtistSearchOutcome =
  | { status: 'found'; artists: ArtistResult[] }
  | { status: 'empty' }
  | { status: 'error' };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseArtistResult(value: unknown): ArtistResult | null {
  if (!isObject(value)) return null;
  const { mbid, name } = value;
  if (typeof mbid !== 'string' || !UUID_RE.test(mbid)) return null;
  if (typeof name !== 'string' || !name.trim()) return null;

  return {
    mbid,
    name,
    disambiguation: typeof value.disambiguation === 'string' ? value.disambiguation : null,
    type: typeof value.type === 'string' ? value.type : null,
    country: typeof value.country === 'string' ? value.country : null,
  };
}

function parseArtistResultArray(value: unknown): ArtistResult[] {
  if (!Array.isArray(value)) return [];
  const artists: ArtistResult[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const artist = parseArtistResult(item);
    if (!artist || seen.has(artist.mbid)) continue;
    seen.add(artist.mbid);
    artists.push(artist);
  }
  return artists;
}

export async function searchArtists(query: string): Promise<ArtistSearchOutcome> {
  const q = query.trim();
  if (!q) return { status: 'empty' };

  let response: Response;
  try {
    response = await fetch(`/api/search-artist?q=${encodeURIComponent(q)}`);
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };

  try {
    const body = (await response.json()) as { artists?: unknown };
    const artists = parseArtistResultArray(body.artists);
    return artists.length > 0 ? { status: 'found', artists } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/artistSearch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/artistSearch.ts src/artistSearch.test.ts
git commit -m "feat: add artistSearch client wrapper"
```

---

### Task 3: `artistSearchView.ts` view module

**Files:**
- Create: `web/src/ui/artistSearchView.ts`

No test file — matches the existing convention for this codebase's other view modules (`rankList.ts`, `artistBatchView.ts`, `speedRound.ts` have none); verified in Task 6.

**Interfaces:**
- Consumes: `ArtistResult` from `web/src/artistSearch.ts` (Task 2).
- Produces:
  ```ts
  export type ArtistSearchResultsState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'done'; artists: ArtistResult[] };

  export type ArtistSelectResult =
    | { status: 'ok' }
    | { status: 'locked' | 'empty' | 'error' };

  export type ArtistSearchViewOptions = {
    getQuery: () => string;
    onQueryChange: (query: string) => void;
    getResults: () => ArtistSearchResultsState;
    onSelectArtist: (artist: ArtistResult) => Promise<ArtistSelectResult>;
    onClose: () => void;
  };

  export type ArtistSearchViewController = {
    render: () => void;
    teardown: () => void;
  };

  export function mountArtistSearchView(
    container: HTMLElement,
    opts: ArtistSearchViewOptions
  ): ArtistSearchViewController
  ```
  `main.ts` (Task 5) mounts this once per view-open, calling `.render()` on state changes rather than remounting on every keystroke (remounting mid-keystroke would race a fresh instance against an in-flight `onSelectArtist` continuation from the old one, both writing to the same `container`).

  On `'ok'`, the caller has already navigated away (`showView('artistBatch')`) by the time the promise resolves — this module's own `render()` never needs to show a "success" state, only the three failure statuses, which keep the view open so the owner can retry or pick another artist.

- [ ] **Step 1: Write the view module**

Create `web/src/ui/artistSearchView.ts`:

```ts
import type { ArtistResult } from '../artistSearch';

export type ArtistSearchResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; artists: ArtistResult[] };

export type ArtistSelectResult =
  | { status: 'ok' }
  | { status: 'locked' | 'empty' | 'error' };

export type ArtistSearchViewOptions = {
  getQuery: () => string;
  onQueryChange: (query: string) => void;
  getResults: () => ArtistSearchResultsState;
  onSelectArtist: (artist: ArtistResult) => Promise<ArtistSelectResult>;
  onClose: () => void;
};

export type ArtistSearchViewController = {
  render: () => void;
  teardown: () => void;
};

function subtitle(artist: ArtistResult): string {
  const parts = [artist.disambiguation, artist.type, artist.country].filter(
    (part): part is string => !!part
  );
  return parts.join(' · ');
}

/**
 * Dedicated artist-name search ("Add a band"), separate from the existing
 * album-title search in rankList.ts. Selecting a result triggers discovery
 * and, on success, the caller (main.ts) navigates straight into the
 * existing artist-batch view -- this module only ever needs to render the
 * search UI and the failure states that keep the owner here to retry.
 */
export function mountArtistSearchView(
  container: HTMLElement,
  opts: ArtistSearchViewOptions
): ArtistSearchViewController {
  let selectingMbid: string | null = null;
  let selectMessage: string | null = null;

  async function handleSelect(artist: ArtistResult): Promise<void> {
    if (selectingMbid) return; // a selection is already in flight
    selectingMbid = artist.mbid;
    selectMessage = null;
    render();

    const result = await opts.onSelectArtist(artist);
    selectingMbid = null;

    if (result.status === 'locked') {
      selectMessage = 'Unlock writes to add a band.';
    } else if (result.status === 'empty') {
      selectMessage = `No albums found for ${artist.name}.`;
    } else if (result.status === 'error') {
      selectMessage = `Could not load ${artist.name}'s albums.`;
    } else {
      return; // 'ok' -- caller is navigating away, nothing left to render
    }
    render();
  }

  function buildResultRow(artist: ArtistResult): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-search-result';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const name = document.createElement('p');
    name.className = 'rank-title';
    name.textContent = artist.name;
    meta.append(name);
    const sub = subtitle(artist);
    if (sub) {
      const subEl = document.createElement('p');
      subEl.className = 'rank-sub';
      subEl.textContent = sub;
      meta.append(subEl);
    }
    li.append(meta);

    const isSelecting = selectingMbid === artist.mbid;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate-action';
    btn.textContent = isSelecting ? 'Loading…' : 'Rank all albums';
    btn.disabled = selectingMbid !== null;
    btn.setAttribute('aria-label', `Rank all of ${artist.name}'s albums`);
    btn.addEventListener('click', () => {
      void handleSelect(artist);
    });
    li.append(btn);

    return li;
  }

  function buildResults(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rank-search-fallback';
    const results = opts.getResults();

    if (results.status === 'loading') {
      const p = document.createElement('p');
      p.className = 'rank-search-status';
      p.textContent = 'Searching…';
      wrap.append(p);
      return wrap;
    }
    if (results.status === 'error') {
      const p = document.createElement('p');
      p.className = 'rank-search-status';
      p.textContent = "Couldn't reach MusicBrainz. Try again.";
      wrap.append(p);
      return wrap;
    }
    if (results.status === 'done') {
      if (results.artists.length === 0) {
        const p = document.createElement('p');
        p.className = 'rank-search-status';
        p.textContent = 'No bands found.';
        wrap.append(p);
        return wrap;
      }
      const list = document.createElement('ul');
      list.className = 'rank-search-results';
      for (const artist of results.artists) list.append(buildResultRow(artist));
      wrap.append(list);
      return wrap;
    }
    return wrap; // 'idle' -- nothing typed yet
  }

  function render(): void {
    // Same focus/caret preservation as rankList.ts's own search box: capture
    // BEFORE clearing the container, since removing a focused element fires
    // a synchronous blur that would otherwise clear this first.
    const prevInput = container.querySelector<HTMLInputElement>('.rank-search-input');
    const wasFocused = !!prevInput && document.activeElement === prevInput;
    const caret = wasFocused ? prevInput!.selectionStart : null;

    container.textContent = '';

    const wrap = document.createElement('div');
    wrap.className = 'lock-view';

    const header = document.createElement('div');
    header.className = 'lock-view-header';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lock-view-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => opts.onClose());
    const heading = document.createElement('h2');
    heading.className = 'lock-view-title';
    heading.textContent = 'Add a band';
    header.append(backBtn, heading);
    wrap.append(header);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'rank-search';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'rank-search-input';
    input.placeholder = 'Search for a band';
    input.setAttribute('aria-label', 'Search for a band');
    input.value = opts.getQuery();
    input.addEventListener('input', () => opts.onQueryChange(input.value));
    searchWrap.append(input);
    wrap.append(searchWrap);

    if (selectMessage) {
      const msg = document.createElement('p');
      msg.className = 'rank-search-status';
      msg.textContent = selectMessage;
      wrap.append(msg);
    }

    wrap.append(buildResults());
    container.append(wrap);

    if (wasFocused) {
      const mounted = container.querySelector<HTMLInputElement>('.rank-search-input');
      if (mounted) {
        mounted.focus();
        if (caret != null) mounted.setSelectionRange(caret, caret);
      }
    }
  }

  function teardown(): void {
    // No timers or listeners owned outside the DOM tree render() clears.
  }

  render();
  return { render, teardown };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors from this file (unused-export errors are fine at this point -- `main.ts` and `rankList.ts` wire it up in later tasks).

- [ ] **Step 3: Commit**

```bash
cd web
git add src/ui/artistSearchView.ts
git commit -m "feat(ui): add artist-search view module"
```

---

### Task 4: Wire the entry point into `rankList.ts`

**Files:**
- Modify: `web/src/ui/rankList.ts:34-126` (the `RankListOptions` type), `web/src/ui/rankList.ts:913-930` (`buildSearchBox`)
- Modify: `web/src/style.css` (near the `.rank-search-input` rules, ~line 381)

**Interfaces:**
- Produces: `RankListOptions.onOpenArtistSearch?: () => void`, consumed by `main.ts` in Task 5.

- [ ] **Step 1: Add the option to `RankListOptions`**

In `web/src/ui/rankList.ts`, find the end of the `RankListOptions` type (the `onRateSearchResult` field, currently the last one before the closing `};`):

```ts
  /** Add a MusicBrainz search result to the ranked list at a typed 0-10
   *  rating. No comparison happened, so unlike onPlace this never fires a
   *  pairwise atom -- same precedent as onDirectRate. */
  onRateSearchResult?: (album: Album, rating: number) => void;
};
```

Replace with:

```ts
  /** Add a MusicBrainz search result to the ranked list at a typed 0-10
   *  rating. No comparison happened, so unlike onPlace this never fires a
   *  pairwise atom -- same precedent as onDirectRate. */
  onRateSearchResult?: (album: Album, rating: number) => void;
  /** Open the dedicated artist-name search ("Add a band"), a second entry
   *  point alongside the album-title search above it -- lets the owner jump
   *  straight into the artist-batch view for a band with no albums owned
   *  yet. Omit to hide the button entirely. */
  onOpenArtistSearch?: () => void;
};
```

- [ ] **Step 2: Add the button to `buildSearchBox`**

Find `buildSearchBox` (currently):

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

Replace with:

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

    if (opts.onOpenArtistSearch) {
      const addBandBtn = document.createElement('button');
      addBandBtn.type = 'button';
      addBandBtn.className = 'candidate-action rank-search-add-band';
      addBandBtn.textContent = '+ Add a band';
      addBandBtn.addEventListener('click', () => opts.onOpenArtistSearch?.());
      wrap.append(addBandBtn);
    }

    return wrap;
  }
```

- [ ] **Step 3: Add the CSS rule**

In `web/src/style.css`, find the `.rank-search-input:focus` rule (~line 383-386):

```css
.rank-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
}
```

Add immediately after it:

```css

/* Keeps the "+ Add a band" button at its natural width instead of being
   squeezed by .rank-search's flex row when the search input grows. */
.rank-search-add-band {
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/ui/rankList.ts src/style.css
git commit -m "feat(ui): add \"+ Add a band\" entry point to the search box"
```

---

### Task 5: Orchestrate in `main.ts`

**Files:**
- Modify: `web/src/main.ts` (imports, `ViewMode`, state, new handlers, `showView`, the `mountRankList(...)` call)

**Interfaces:**
- Consumes: `searchArtists`, `ArtistResult` (Task 2); `mountArtistSearchView`, `ArtistSearchResultsState`, `ArtistSelectResult` (Task 3); `onOpenArtistSearch` option (Task 4); existing `discoverArtistDetailed` (`web/src/discovery.ts`), existing `pool`, `batchArtistMbid`, `showView`, `session`.

- [ ] **Step 1: Add imports**

In `web/src/main.ts`, find:

```ts
import { mountRankList } from './ui/rankList';
import { mountArtistBatchView } from './ui/artistBatchView';
import { mountSpeedRound } from './ui/speedRound';
import { artistAlbumsFor } from './artistLockAlbums';
```

Replace with:

```ts
import { mountRankList } from './ui/rankList';
import { mountArtistBatchView } from './ui/artistBatchView';
import { mountSpeedRound } from './ui/speedRound';
import { mountArtistSearchView, type ArtistSelectResult } from './ui/artistSearchView';
import { artistAlbumsFor } from './artistLockAlbums';
```

Find:

```ts
import { loadRankingSnapshotDetailed, saveRankingSnapshot } from './rankingSync';
import { discoverArtistDetailed, loadDiscoveredAlbums } from './discovery';
```

Replace with:

```ts
import { loadRankingSnapshotDetailed, saveRankingSnapshot } from './rankingSync';
import { discoverArtistDetailed, loadDiscoveredAlbums } from './discovery';
import { searchArtists, type ArtistResult } from './artistSearch';
```

- [ ] **Step 2: Extend `ViewMode`**

Find:

```ts
type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistBatch' | 'speedRound';
```

Replace with:

```ts
type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistBatch' | 'artistSearch' | 'speedRound';
```

- [ ] **Step 3: Add artist-search state**

Find the existing search-state block:

```ts
  // Local search over the ranked list, plus the MusicBrainz fallback when
  // nothing local matches. Kept in main.ts, not rankList.ts -- rankList is a
  // pure render layer over whatever state it's handed.
  let searchQuery = '';
  type SearchResultsState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'done'; albums: Album[] };
  let searchResults: SearchResultsState = { status: 'idle' };
```

Add immediately after it:

```ts

  // Artist-name search ("Add a band"): a second, dedicated search separate
  // from the one above, for jumping straight into the artist-batch view for
  // a band with none of its albums owned yet.
  let artistSearchQuery = '';
  type ArtistSearchResultsState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'done'; artists: ArtistResult[] };
  let artistSearchResults: ArtistSearchResultsState = { status: 'idle' };
  let artistSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const ARTIST_SEARCH_DEBOUNCE_MS = 400;
  const ARTIST_SEARCH_MIN_LENGTH = 2;
```

- [ ] **Step 4: Add the controller variable and handlers**

Find:

```ts
  let batchArtistMbid: string | null = null;
  let artistBatchController: ReturnType<typeof mountArtistBatchView> | null = null;
```

Replace with:

```ts
  let batchArtistMbid: string | null = null;
  let artistBatchController: ReturnType<typeof mountArtistBatchView> | null = null;
  let artistSearchController: ReturnType<typeof mountArtistSearchView> | null = null;
```

Find the end of `handleOpenArtistBatch` (right before `let speedRoundController`):

```ts
  function handleOpenArtistBatch(album: Album): void {
    if (!album.primary_artist_mbid) {
      rankList.showStatus(`Refresh Album Case to view ${album.primary_artist_name}'s albums.`);
      return;
    }
    batchArtistMbid = album.primary_artist_mbid;
    showView('artistBatch');
  }

  let speedRoundController: ReturnType<typeof mountSpeedRound> | null = null;
```

Replace with:

```ts
  function handleOpenArtistBatch(album: Album): void {
    if (!album.primary_artist_mbid) {
      rankList.showStatus(`Refresh Album Case to view ${album.primary_artist_name}'s albums.`);
      return;
    }
    batchArtistMbid = album.primary_artist_mbid;
    showView('artistBatch');
  }

  function handleOpenArtistSearch(): void {
    artistSearchQuery = '';
    artistSearchResults = { status: 'idle' };
    showView('artistSearch');
  }

  function handleArtistSearchQueryChange(query: string): void {
    artistSearchQuery = query;

    if (artistSearchDebounceTimer !== null) {
      clearTimeout(artistSearchDebounceTimer);
      artistSearchDebounceTimer = null;
    }

    const trimmed = query.trim();
    if (trimmed.length < ARTIST_SEARCH_MIN_LENGTH) {
      artistSearchResults = { status: 'idle' };
      renderArtistSearchView();
      return;
    }

    artistSearchDebounceTimer = setTimeout(() => {
      artistSearchDebounceTimer = null;
      void (async () => {
        const forQuery = trimmed;
        artistSearchResults = { status: 'loading' };
        renderArtistSearchView();

        const result = await searchArtists(forQuery);
        // The owner may have left the view or kept typing while this was
        // in flight -- discard a response that no longer applies.
        if (view !== 'artistSearch' || artistSearchQuery.trim() !== forQuery) return;

        artistSearchResults =
          result.status === 'error'
            ? { status: 'error' }
            : { status: 'done', artists: result.status === 'found' ? result.artists : [] };
        renderArtistSearchView();
      })();
    }, ARTIST_SEARCH_DEBOUNCE_MS);
  }

  async function handleSelectSearchedArtist(artist: ArtistResult): Promise<ArtistSelectResult> {
    const result = await discoverArtistDetailed(session.session_id, artist.name, artist.mbid, []);

    if (result.status === 'locked') return { status: 'locked' };
    if (result.status === 'error') return { status: 'error' };
    if (result.status === 'empty') return { status: 'empty' };

    const found = result.albums;
    const poolIds = new Set(pool.map((a) => a.mbid));
    for (const album of found) {
      if (!poolIds.has(album.mbid)) {
        pool.push(album);
        poolIds.add(album.mbid);
      }
    }

    batchArtistMbid = artist.mbid;
    showView('artistBatch');
    return { status: 'ok' };
  }

  /** Mounted once per view-open, then re-rendered in place on state changes
   *  -- NOT remounted on every keystroke like renderArtistBatchView /
   *  renderSpeedRound. Remounting mid-keystroke would race a fresh instance
   *  against an in-flight handleSelectSearchedArtist continuation from the
   *  old one, both writing into `stage`. showView's leave-teardown resets
   *  artistSearchController to null, so the next open mounts fresh. */
  function renderArtistSearchView(): void {
    if (!artistSearchController) {
      stage.textContent = '';
      artistSearchController = mountArtistSearchView(stage, {
        getQuery: () => artistSearchQuery,
        onQueryChange: handleArtistSearchQueryChange,
        getResults: () => artistSearchResults,
        onSelectArtist: handleSelectSearchedArtist,
        onClose: () => {
          showView('ranked');
        },
      });
      return;
    }
    artistSearchController.render();
  }

  let speedRoundController: ReturnType<typeof mountSpeedRound> | null = null;
```

- [ ] **Step 5: Wire `showView`**

Find:

```ts
  function showView(next: ViewMode): void {
    // Leaving the drag view: cancel any in-flight drag / listeners.
    if (view === 'ranked' && next !== 'ranked') {
      rankList.teardown();
    }
    if (view === 'artistBatch' && next !== 'artistBatch') {
      artistBatchController?.teardown();
    }
```

Replace with:

```ts
  function showView(next: ViewMode): void {
    // Leaving the drag view: cancel any in-flight drag / listeners.
    if (view === 'ranked' && next !== 'ranked') {
      rankList.teardown();
    }
    if (view === 'artistBatch' && next !== 'artistBatch') {
      artistBatchController?.teardown();
    }
    if (view === 'artistSearch' && next !== 'artistSearch') {
      artistSearchController?.teardown();
      artistSearchController = null;
      if (artistSearchDebounceTimer !== null) {
        clearTimeout(artistSearchDebounceTimer);
        artistSearchDebounceTimer = null;
      }
    }
```

Then find:

```ts
    if (view === 'ranked') {
      rankList.render();
    } else if (view === 'blockedArtists') {
      renderBlockedArtists();
    } else if (view === 'artistBatch') {
      renderArtistBatchView();
    } else if (view === 'speedRound') {
      renderSpeedRound();
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
  }
```

Replace with:

```ts
    if (view === 'ranked') {
      rankList.render();
    } else if (view === 'blockedArtists') {
      renderBlockedArtists();
    } else if (view === 'artistBatch') {
      renderArtistBatchView();
    } else if (view === 'artistSearch') {
      renderArtistSearchView();
    } else if (view === 'speedRound') {
      renderSpeedRound();
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
  }
```

- [ ] **Step 6: Pass the option into `mountRankList`**

Find the end of the `mountRankList({ ... })` call, the `getArtistAlbumCount` option that's currently last before the closing `});`:

```ts
    getArtistAlbumCount: (album) => {
      if (!album.primary_artist_mbid) return 0;
      const grouped = artistAlbumsFor(album.primary_artist_mbid, state.ranked, lists, pool);
      return grouped.ranked.length + grouped.unranked.length;
    },
  });
```

Replace with:

```ts
    getArtistAlbumCount: (album) => {
      if (!album.primary_artist_mbid) return 0;
      const grouped = artistAlbumsFor(album.primary_artist_mbid, state.ranked, lists, pool);
      return grouped.ranked.length + grouped.unranked.length;
    },
    onOpenArtistSearch: handleOpenArtistSearch,
  });
```

- [ ] **Step 7: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `cd web && npm run test`
Expected: PASS, no regressions (existing suite plus the 5 + 6 tests from Tasks 1-2).

- [ ] **Step 9: Commit**

```bash
cd web
git add src/main.ts
git commit -m "feat: wire artist search into a new 'Add a band' view"
```

---

### Task 6: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `cd web && npm run build`
Expected: succeeds (runs `tsc` then `vite build`).

- [ ] **Step 2: Start the dev server**

Run: `cd web && npm run dev`
Expected: Vite dev server starts, prints a local URL.

- [ ] **Step 3: Exercise the golden path in a browser**

Open the dev URL. On the ranked list view, confirm:
- "+ Add a band" is visible next to the existing search box and is tappable at a 360px viewport width without causing horizontal scroll.
- Typing a band name (e.g. "Radiohead") shows a debounced results list with disambiguation/type/country shown when MusicBrainz provides them.
- Selecting a result shows a brief "Loading…" state on that row, then lands directly in the artist-batch view with the band's albums populated.
- The "← Back" control returns to the ranked list without picking anything.

- [ ] **Step 4: Exercise edge cases**

- Search for a name with no MusicBrainz matches (e.g. a string of random characters) → "No bands found." shown, view stays open.
- With writes locked (default state, no write key set): select an artist → "Unlock writes to add a band." shown, view stays open, no crash.
- Type fewer than 2 characters → no request fires, no results shown (check the Network tab for no `/api/search-artist` call).

No code changes expected from this task unless a real defect surfaces — if one does, fix it, re-run the affected automated tests, and commit the fix separately before considering the plan complete.
