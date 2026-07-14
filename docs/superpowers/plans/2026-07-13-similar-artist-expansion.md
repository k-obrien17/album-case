# Similar-Artist Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When "Fill in more albums" finds nothing left in the top-10 artists' own catalogs (which is every press right now), expand to *similar* artists via ListenBrainz and queue their studio LPs as candidates.

**Architecture:** One new read-only proxy route (`/api/similar-artists`, mirroring `search-album.ts`'s hardening), one pure scoring/exclusion function, one new orchestrator in `bulkDiscovery.ts` shaped exactly like the existing `runBulkDiscovery` (dependencies injected, sequential with pacing), and a two-tier chain in `main.ts`'s `handleBulkDiscover`. Album discovery itself reuses the existing write-gated `/api/discover-artist` path unchanged.

**Tech Stack:** TypeScript, Vite, Vitest, Vercel serverless — no new dependencies.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-13-similar-artist-expansion-design.md`.
- ListenBrainz Labs endpoint (verified live during spec-writing): `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=<mbid>&algorithm=session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30` → a **top-level JSON array** of `{ artist_mbid, name, score, ... }`.
- Tier 2 runs ONLY when Tier 1 adds 0 albums and was not short-circuited by locked writes.
- New albums go to the candidate queue only — never auto-ranked, no pairwise atoms.
- Artist locks stay PAUSED: do not import or reference `./ranking/locks` anywhere.
- `SIMILAR_ARTISTS_PER_RUN = 5`, `TOP_ARTIST_DISCOVERY_COUNT = 10` (existing) — constants, not UI-configurable.
- Discovery pacing stays sequential with the existing 300ms default. The similar-artists fetches go through our own edge-cached route, but still pace them with the same `delayMs` — ListenBrainz Labs has no published rate limit and 10 paced calls is polite by construction.
- **Do not unlock writes during manual verification.** Discovery calls are write-key-gated; verify Tier 2 up to the "Unlock writes…" message with writes locked. Full end-to-end confirmation happens on Keith's unlocked device after deploy.
- Test convention: colocate `.test.ts`. Run from `web/`: `npx tsc --noEmit`, `npm run test`, `npm run build`.

---

### Task 1: `rankSimilarArtists` — pure scoring, aggregation, exclusion

**Files:**
- Modify: `web/src/bulkDiscovery.ts`
- Modify: `web/src/bulkDiscovery.test.ts`

**Interfaces:**
- Produces (exact signatures later tasks rely on):
  ```ts
  export const SIMILAR_ARTISTS_PER_RUN = 5;
  export type SimilarArtist = { mbid: string; name: string; score: number };
  export function rankSimilarArtists(
    seedLists: SimilarArtist[][],
    excludedArtistMbids: Set<string>,
    blockedNames: string[],
    n: number
  ): { mbid: string; name: string }[];
  ```

- [ ] **Step 1: Write the failing tests**

Append to `web/src/bulkDiscovery.test.ts` (import `rankSimilarArtists` and `SimilarArtist` from `./bulkDiscovery`):

```ts
describe('rankSimilarArtists', () => {
  const sa = (mbid: string, name: string, score: number): SimilarArtist => ({ mbid, name, score });

  it('normalizes each seed list before summing, so one seed\'s larger raw scale cannot dominate', () => {
    // Seed A scores in the thousands, seed B in single digits. "shared" is
    // mid-strength in both: normalized 600/1000 + 6/10 = 1.2, strictly above
    // "loud" (1000/1000 = 1.0) despite loud's huge raw score.
    const seedA = [sa('loud', 'Loud', 1000), sa('shared', 'Shared', 600)];
    const seedB = [sa('shared', 'Shared', 6), sa('quiet', 'Quiet', 10)];
    const out = rankSimilarArtists([seedA, seedB], new Set(), [], 3);
    expect(out[0]).toEqual({ mbid: 'shared', name: 'Shared' });
  });

  it('an artist similar to several seeds outranks one similar to a single seed', () => {
    // multi: 60/100 + 60/100 = 1.2 -- strictly above the per-list maxes
    // (topA/topB at 1.0 each) and solo (80/100 = 0.8). No ties anywhere.
    const seedA = [sa('topA', 'TopA', 100), sa('multi', 'Multi', 60), sa('solo', 'Solo', 80)];
    const seedB = [sa('topB', 'TopB', 100), sa('multi', 'Multi', 60)];
    const out = rankSimilarArtists([seedA, seedB], new Set(), [], 4);
    expect(out[0].mbid).toBe('multi');
    expect(out.findIndex((a) => a.mbid === 'multi')).toBeLessThan(out.findIndex((a) => a.mbid === 'solo'));
  });

  it('excludes artists already represented in the library (by mbid)', () => {
    const seed = [sa('have', 'Have', 100), sa('new', 'New', 50)];
    const out = rankSimilarArtists([seed], new Set(['have']), [], 5);
    expect(out.map((a) => a.mbid)).toEqual(['new']);
  });

  it('excludes blocked artists by name, case-insensitively', () => {
    const seed = [sa('x', 'Coldplay', 100), sa('y', 'Pixies', 90)];
    const out = rankSimilarArtists([seed], new Set(), ['coldplay'], 5);
    expect(out.map((a) => a.name)).toEqual(['Pixies']);
  });

  it('caps at n', () => {
    const seed = [sa('a', 'A', 5), sa('b', 'B', 4), sa('c', 'C', 3)];
    expect(rankSimilarArtists([seed], new Set(), [], 2)).toHaveLength(2);
  });

  it('returns empty for no seed lists', () => {
    expect(rankSimilarArtists([], new Set(), [], 5)).toEqual([]);
  });

  it('ignores empty seed lists without dividing by zero', () => {
    const seed = [sa('a', 'A', 10)];
    expect(rankSimilarArtists([seed, []], new Set(), [], 5).map((a) => a.mbid)).toEqual(['a']);
  });
});
```

**Note on the second test:** trace the math before writing the implementation — with those fixtures, `multi` sums to 1.0 and `solo`/`other` each hit exactly 1.0 (they're their list's max). Fix the fixture so the property actually holds, e.g. make `solo` score 80 vs a 100-max in its list (0.8 < 1.0). Do NOT ship a test whose assertion passes only by tie-break luck — adjust the fixture numbers so the intended ordering is strict, and note the final numbers in your report.

- [ ] **Step 2: Run to verify failure**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts
```
Expected: FAIL — `rankSimilarArtists` doesn't exist.

- [ ] **Step 3: Implement**

Append to `web/src/bulkDiscovery.ts`:

```ts
export const SIMILAR_ARTISTS_PER_RUN = 5;

export type SimilarArtist = { mbid: string; name: string; score: number };

/**
 * Aggregate per-seed similar-artist lists into one ranked shortlist.
 *
 * Scores are normalized per seed list (divided by that list's max) before
 * summing, so one seed's larger raw score scale can't dominate -- and an
 * artist similar to SEVERAL of the owner's top artists outranks one similar
 * to just one. Artists already represented in the library (by mbid) or
 * blocked (by name, case-insensitive) are excluded before the top-n cut.
 */
export function rankSimilarArtists(
  seedLists: SimilarArtist[][],
  excludedArtistMbids: Set<string>,
  blockedNames: string[],
  n: number
): { mbid: string; name: string }[] {
  const blocked = new Set(blockedNames.map((name) => name.trim().toLowerCase()));
  const totals = new Map<string, { name: string; total: number }>();

  for (const list of seedLists) {
    if (list.length === 0) continue;
    const max = Math.max(...list.map((a) => a.score));
    if (max <= 0) continue;
    for (const artist of list) {
      const entry = totals.get(artist.mbid) ?? { name: artist.name, total: 0 };
      entry.total += artist.score / max;
      totals.set(artist.mbid, entry);
    }
  }

  return [...totals.entries()]
    .filter(
      ([mbid, { name }]) =>
        !excludedArtistMbids.has(mbid) && !blocked.has(name.trim().toLowerCase())
    )
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, n)
    .map(([mbid, { name }]) => ({ mbid, name }));
}
```

- [ ] **Step 4: Run to verify pass, then commit**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts
git add web/src/bulkDiscovery.ts web/src/bulkDiscovery.test.ts
git commit -m "feat(discovery): add similar-artist scoring and exclusion"
```

---

### Task 2: `/api/similar-artists` route

**Files:**
- Create: `web/api/similar-artists.ts`
- Create: `web/api/similar-artists.test.ts`

**Interfaces:**
- Produces: `GET /api/similar-artists?artist_mbid=<uuid>` → `200 { artists: { mbid, name, score }[] }` (max 50). `400 invalid_artist_mbid`, `405`, `502 listenbrainz_unavailable`.

Read `web/api/search-album.ts` first and mirror its hardening exactly (method check, input validation, `Cache-Control`, `AbortController` timeout, 502 on upstream failure).

- [ ] **Step 1: Write the route**

Create `web/api/similar-artists.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LB_BASE = 'https://labs.api.listenbrainz.org';
// ListenBrainz's current recommended session-based similarity model. If LB
// retires this algorithm string, the upstream call fails and this route 502s
// -- the client reports that cleanly rather than showing stale/empty data.
const LB_ALGORITHM =
  'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const MAX_RESULTS = 50;
const FETCH_TIMEOUT_MS = 8000;

type LbRow = { artist_mbid?: string; name?: string; score?: number };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const mbid = typeof req.query.artist_mbid === 'string' ? req.query.artist_mbid : '';
  if (!UUID_RE.test(mbid)) {
    res.status(400).json({ error: 'invalid_artist_mbid' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ artist_mbids: mbid, algorithm: LB_ALGORITHM });
    const lb = await fetch(`${LB_BASE}/similar-artists/json?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!lb.ok) throw new Error(`listenbrainz_${lb.status}`);

    const rows = (await lb.json()) as LbRow[];
    const artists = (Array.isArray(rows) ? rows : [])
      .filter((r) => typeof r.artist_mbid === 'string' && typeof r.name === 'string' && typeof r.score === 'number')
      .slice(0, MAX_RESULTS)
      .map((r) => ({ mbid: r.artist_mbid as string, name: r.name as string, score: r.score as number }));

    // Similarity data changes rarely; a day of edge caching makes repeat
    // presses of the button nearly free for the same seed artists.
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.status(200).json({ artists });
  } catch {
    res.status(502).json({ error: 'listenbrainz_unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Thin test, matching `search-album.test.ts`'s level**

Read `web/api/search-album.test.ts` and copy its structure (`makeRes()`, `vi.stubGlobal('fetch', ...)`, `afterEach` cleanup). Cover: 405 on POST, 400 on a non-UUID `artist_mbid`, and a happy path where a mocked top-level-array response is filtered/mapped/capped into `{ artists }`.

- [ ] **Step 3: Verify + commit**

```bash
cd web && npx vitest run api/similar-artists.test.ts && npx tsc --noEmit
git add web/api/similar-artists.ts web/api/similar-artists.test.ts
git commit -m "feat(api): add read-only ListenBrainz similar-artists proxy"
```

---

### Task 3: `runBulkDiscovery` reports `found` and `locked`

**Files:**
- Modify: `web/src/bulkDiscovery.ts`
- Modify: `web/src/bulkDiscovery.test.ts`

**Interfaces:**
- Produces: `runBulkDiscovery`'s return type becomes `{ priorityQueue: string[]; summary: string; found: number; locked: boolean }`. Task 5's tier-chaining depends on exactly these two new fields — the summary STRING must not be what the trigger keys on.

- [ ] **Step 1: Extend the return values**

In `runBulkDiscovery`:
- the "Rank some albums first." early return → add `found: 0, locked: false`;
- the locked short-circuit → add `found: 0, locked: true`;
- the final return → add `found: foundCount, locked: false`.

- [ ] **Step 2: Update existing tests honestly**

`bulkDiscovery.test.ts` has tests asserting the full result object with `toEqual` (the locked short-circuit and "rank some albums first" cases). Add the two new fields to their expected objects — extend the assertions, don't weaken them to partial matching.

- [ ] **Step 3: Verify + commit**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts && npx tsc --noEmit
git add web/src/bulkDiscovery.ts web/src/bulkDiscovery.test.ts
git commit -m "feat(discovery): expose found/locked from runBulkDiscovery for tier chaining"
```

---

### Task 4: `runSimilarExpansion` — the Tier 2 orchestrator

**Files:**
- Modify: `web/src/bulkDiscovery.ts`
- Modify: `web/src/bulkDiscovery.test.ts`

**Interfaces:**
- Consumes: `topRankedArtists`, `rankSimilarArtists`, `SIMILAR_ARTISTS_PER_RUN`, `BulkDiscoverDeps['discover']`.
- Produces:
  ```ts
  export type SimilarExpansionDeps = {
    fetchSimilar: (artistMbid: string) => Promise<SimilarArtist[] | null>; // null = that seed's fetch failed
    discover: BulkDiscoverDeps['discover'];
    onProgress?: (message: string) => void;
    delayMs?: number;
  };
  export async function runSimilarExpansion(
    ranked: Album[],
    pool: Album[],
    priorityQueue: string[],
    blockedNames: string[],
    deps: SimilarExpansionDeps
  ): Promise<{ priorityQueue: string[]; summary: string }>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `bulkDiscovery.test.ts`, reusing the file's existing `album()`/`rankedFor()` fixtures and mocked-`discover` style:

- **All seeds fail:** `fetchSimilar` always resolves `null` → summary `'Couldn\'t reach ListenBrainz — try again.'`, no `discover` calls, queue unchanged.
- **Exclusion wiring:** ranked contains Radiohead; `fetchSimilar` returns `[{mbid:'artist-radiohead',...}, {mbid:'artist-new', name:'Pixies', score: 90}]` → only Pixies is discovered (Radiohead's mbid is excluded because it's represented in `ranked`/`pool`).
- **Locked short-circuit:** first `discover` returns `{status:'locked'}` → summary `'Unlock writes to fill in more albums.'`, queue unchanged.
- **Happy path:** two similar artists, each discovery finds 1 new album → both albums prepended to the queue ahead of existing entries, summary names the artists: `Added 2 albums from 2 similar artists: Pixies, Slowdive.`
- **Nothing eligible:** `fetchSimilar` returns only already-represented artists → summary `'No new similar artists found.'`, no discover calls.
- **Per-artist failure tolerance:** one artist's discovery errors, the other succeeds → both counted honestly in the summary (`… 1 failed.` clause).

- [ ] **Step 2: Run to verify failure, then implement**

```ts
export async function runSimilarExpansion(
  ranked: Album[],
  pool: Album[],
  priorityQueue: string[],
  blockedNames: string[],
  deps: SimilarExpansionDeps
): Promise<{ priorityQueue: string[]; summary: string }> {
  const seeds = topRankedArtists(ranked, TOP_ARTIST_DISCOVERY_COUNT);
  if (seeds.length === 0) {
    return { priorityQueue, summary: 'Rank some albums first.' };
  }

  const delayMs = deps.delayMs ?? 300;

  // Phase 1: similar-artist lists per seed (via our edge-cached proxy).
  const seedLists: SimilarArtist[][] = [];
  let seedFailures = 0;
  for (let i = 0; i < seeds.length; i++) {
    deps.onProgress?.(`Finding similar artists (${i + 1}/${seeds.length})…`);
    const list = await deps.fetchSimilar(seeds[i].mbid);
    if (list === null) seedFailures++;
    else seedLists.push(list);
    if (i < seeds.length - 1) await delay(delayMs);
  }
  if (seedFailures === seeds.length) {
    return { priorityQueue, summary: 'Couldn\'t reach ListenBrainz — try again.' };
  }

  // Artists already represented anywhere in the library are not "new".
  const represented = new Set<string>();
  for (const a of [...ranked, ...pool]) {
    if (a.primary_artist_mbid) represented.add(a.primary_artist_mbid);
  }

  const targets = rankSimilarArtists(seedLists, represented, blockedNames, SIMILAR_ARTISTS_PER_RUN);
  if (targets.length === 0) {
    return { priorityQueue, summary: 'No new similar artists found.' };
  }

  // Phase 2: pull each new artist's studio LPs -- same shape as runBulkDiscovery.
  const newQueue: string[] = [];
  const succeeded: string[] = [];
  let foundCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const artist = targets[i];
    deps.onProgress?.(`Discovering ${artist.name} (${i + 1}/${targets.length})…`);
    const knownMbids = pool
      .filter((a) => a.primary_artist_mbid === artist.mbid)
      .map((a) => a.mbid);
    const result = await deps.discover(artist.name, artist.mbid, knownMbids);

    if (result.status === 'locked') {
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.' };
    } else if (result.status === 'error') {
      errorCount++;
    } else if (result.status === 'found') {
      const poolIds = new Set(pool.map((a) => a.mbid));
      const newToPool = result.albums.filter((a) => !poolIds.has(a.mbid));
      pool.push(...newToPool);
      newQueue.push(...result.albums.map((a) => a.mbid));
      foundCount += newToPool.length;
      if (newToPool.length > 0) succeeded.push(artist.name);
    }
    if (i < targets.length - 1) await delay(delayMs);
  }

  let summary = `Added ${foundCount} albums from ${succeeded.length} similar artists`;
  summary += succeeded.length > 0 ? `: ${succeeded.join(', ')}.` : '.';
  if (errorCount > 0) summary += ` ${errorCount} failed.`;

  return { priorityQueue: [...newQueue, ...priorityQueue], summary };
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts && npx tsc --noEmit && npm run test
git add web/src/bulkDiscovery.ts web/src/bulkDiscovery.test.ts
git commit -m "feat(discovery): add runSimilarExpansion, the tier-2 orchestrator"
```

---

### Task 5: Chain the tiers in `handleBulkDiscover`

**Files:**
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `runSimilarExpansion` + the `found`/`locked` fields from Task 3. No new props, no UI changes — the existing button and `showStatus` channel carry everything.

- [ ] **Step 1: Wire the chain**

In `main.ts`, extend the import from `./bulkDiscovery` with `runSimilarExpansion`, and rewrite `handleBulkDiscover`'s try block (around line 588 — the surrounding in-flight guard and `finally` stay exactly as they are):

```ts
    try {
      const deps = {
        discover: (name: string, mbid: string, known: string[]) =>
          discoverArtistDetailed(session.session_id, name, mbid, known),
        onProgress: (msg: string) => rankList.showStatus(msg),
      };
      const result = await runBulkDiscovery(state.ranked, pool, priorityQueue, deps);
      priorityQueue = result.priorityQueue;
      savePriorityQueue(priorityQueue);
      let summary = result.summary;

      // Tier 2: the top artists' own catalogs are exhausted -- expand to
      // similar artists via ListenBrainz. Not on locked writes (every call
      // would fail identically) and not when Tier 1 actually found albums.
      if (!result.locked && result.found === 0) {
        const expansion = await runSimilarExpansion(
          state.ranked,
          pool,
          priorityQueue,
          blockedArtists,
          {
            ...deps,
            fetchSimilar: async (artistMbid) => {
              try {
                const res = await fetch(`/api/similar-artists?artist_mbid=${artistMbid}`);
                if (!res.ok) return null;
                const body = (await res.json()) as { artists: SimilarArtist[] };
                return body.artists ?? [];
              } catch {
                return null;
              }
            },
          }
        );
        priorityQueue = expansion.priorityQueue;
        savePriorityQueue(priorityQueue);
        summary = expansion.summary;
      }

      reselectCandidate();
      rankList.render();
      rankList.showStatus(summary);
    } finally {
```

Import `SimilarArtist` as a type from `./bulkDiscovery`. `blockedArtists` is the existing module-scope names array — confirm its exact binding name in the file before using it.

- [ ] **Step 2: Full verification**

```bash
cd web && npx tsc --noEmit && npm run test && npm run build
```

- [ ] **Step 3: Manual verification (writes stay LOCKED — do not unlock)**

```bash
cd web && vercel dev --listen 3311 --yes
```
With Playwright MCP against `http://localhost:3311`: press "Fill in more albums". Expected sequence with real data: Tier 1 progress ("Discovering 1/10 artists…") → 0 found → Tier 2 progress ("Finding similar artists (1/10)…") → real similar artists chosen → first discovery call → **"Unlock writes to fill in more albums."** (writes are locked — that message is the expected terminal state and proves the whole chain up to the gated write works). Also verify `/api/similar-artists?artist_mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711` returns real artists via curl.

Full queue-landing verification happens on Keith's unlocked device after deploy — note this explicitly in your report.

- [ ] **Step 4: Commit**

```bash
git add web/src/main.ts
git commit -m "feat(discovery): expand to similar artists when own catalogs are exhausted"
```
