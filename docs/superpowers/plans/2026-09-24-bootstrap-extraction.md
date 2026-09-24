# Bootstrap Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `web/src/main.ts`'s app-boot sequence (seed pool load through snapshot hydration, ~110 lines) into a new `bootstrapApp()` function in `web/src/bootstrap.ts`, with no behavior change, and add the one vitest that pins its previously-untested `missing`/`error`/`pendingSync` branches.

**Architecture:** One new file, `web/src/bootstrap.ts`, holding a single exported async function `bootstrapApp(ownerId: string): Promise<BootstrapResult>` that is `main.ts`'s current bootstrap block moved verbatim (same order, same try/catch degrade paths, same console.warn calls). `main()` calls it once and destructures the result into the same closure-local names it uses today (`pool`, `priorityQueue`, `preferred`, `playsByArtist`, `blockedArtists`, `curatedSkips`, `serverSnapshot`, `snapshotBaseUpdatedAt`, `pendingSync`, plus `cachedState`/`cachedLists`/`cachedArtistLocks`). No other file changes. No store/wrapper is introduced around `pool`/`priorityQueue`: they keep being plain closure locals, mutated the same way (`.push()`, reassignment) at every existing call site.

**Tech Stack:** TypeScript, Vite, vitest, Playwright (unchanged).

**Spec:** `docs/superpowers/specs/2026-09-23-candidate-discovery-ownership-bootstrap-design.md`

## Global Constraints

- No behavior change: bootstrap steps stay in their exact current order with their exact current error handling (`loadPreferredArtists` degrades to uniform selection on failure; `loadPriorityAlbumPlan` degrades to no-op on failure).
- Do not move `blockedArtists`/`curatedSkips` ownership out of `rankingStore.ts`. `bootstrapApp` only produces their one-time initial values, exactly as `main.ts` does today.
- Do not introduce a `candidateStore.ts` or any get/set wrapper around `pool`/`priorityQueue`/`candidateArtistCooldown`/`skippedAlbums`/`sessionSkipped`. Every existing call site in `main.ts` outside the moved block stays untouched.
- Do not touch `discovery.ts`, `bulkDiscovery.ts`, or `artistLockAlbums.ts`.
- Do not write any test beyond the one `bootstrap.test.ts` covering `missing`/`error`/`pendingSync`, per the project's no-unrequested-tests convention (this one is pre-approved).
- The existing 358 vitest unit tests and 11 Playwright e2e specs must stay green throughout, unmodified.

## Review Focus

- **`serverLoadStatus` distinguishes `missing` from `error`.** `main.ts` (post-extraction, in the code that stays there) branches on `serverLoad.status === 'missing'` for the pending-sync seed-up check. If `bootstrapApp` only returned `serverSnapshot` (null for both `missing` and `error`), that branch would silently misfire. Pinned by the new `bootstrap.test.ts`.
- **`pool` stays the same array reference, not a copy.** `main.ts` calls `pool.push(...)` at five call sites after bootstrap (artist search, bulk discovery, similar-artist expansion, curated-list import). If `bootstrapApp` returned a copy or a new array were substituted anywhere in the destructure, those later pushes would silently update a detached array and discovered/added albums would stop showing up as candidates. Not unit-testable in isolation; verify by reading the diff and confirming `const pool = bootstrap.pool` with no spread/copy.
- **`preferred`/`playsByArtist` still reach `buildArtistGaps`.** Used once, well past the extraction boundary (~line 1303), for artist-gap suggestions. A dropped field in `BootstrapResult` would silently break that one feature with no test failure elsewhere. Verify by grep after wiring.
- **Priority-queue localStorage writes still happen before later reads.** `bootstrapApp` calls `savePriorityQueue()` twice internally (first-visit default, priority-plan reconciliation). Later code in `main.ts` calls `loadPriorityQueue()`-adjacent logic (speed round, bulk discovery) expecting those writes already landed. Order must stay identical to today; verify by reading the diff, not testable in isolation.
- **The `pendingSync` guard on adopting server `blockedArtists`/`curatedSkips` survives extraction.** `main.ts` line ~182 only adopts server values `if (serverLoad.status === 'found' && !pendingSync)`. Losing that guard would let stale server data clobber an unsynced local edit. Pinned by the new `bootstrap.test.ts`'s pendingSync-true case.

---

### Task 1: `bootstrap.ts` with `bootstrapApp()`, unit-tested in isolation

**Files:**
- Create: `web/src/bootstrap.ts`
- Create: `web/src/bootstrap.test.ts`

**Interfaces:**
- Produces: `export async function bootstrapApp(ownerId: string): Promise<BootstrapResult>` and `export interface BootstrapResult { pool: Album[]; priorityQueue: string[]; preferred: ArtistPlays[]; playsByArtist: Map<string, number>; cachedState: RankingState; cachedLists: SavedLists; cachedArtistLocks: ArtistLock[]; pendingSync: boolean; blockedArtists: string[]; curatedSkips: Set<string>; serverSnapshot: { ranked: RankedAlbum[]; lists: SavedLists; artistLocks: ArtistLock[] } | null; serverLoadStatus: RankingSnapshotLoad['status']; snapshotBaseUpdatedAt: number | null | undefined; }` — both consumed by Task 2's `main.ts` wiring.
- Consumes: existing exports from `./seed`, `./storage`, `./lists`, `./artistLocksStorage`, `./priority`, `./rankingSync`, `./discovery`, `./syncStatus`, `./artistBlocks`, `./curatedSkipsStorage`, `./syncEngine` (all unchanged, listed in Step 3's import block).

- [ ] **Step 1: Write the failing tests**

Create `web/src/bootstrap.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import { bootstrapApp } from './bootstrap';
import { markPendingSync, saveSyncBase } from './syncStatus';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function rankedAlbum(mbid: string, rating = 5.0) {
  return { ...album(mbid), rating };
}

function fakeLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

type RankingRoute = { ok: boolean; status?: number; body?: unknown; reject?: boolean };

function stubFetch(rankingRoute: RankingRoute) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/seed/albums.json')) {
        return { ok: true, json: async () => [album('seed1')] } as unknown as Response;
      }
      if (url.includes('/seed/preferred-artists.json')) {
        return { ok: true, json: async () => ({ by_plays: [] }) } as unknown as Response;
      }
      if (url.includes('/seed/priority-albums.json')) {
        return { ok: false, status: 404 } as unknown as Response;
      }
      if (url.includes('/api/discover-artist')) {
        return { ok: true, json: async () => ({ albums: [] }) } as unknown as Response;
      }
      if (url.includes('/api/ranking')) {
        if (rankingRoute.reject) throw new Error('offline');
        return {
          ok: rankingRoute.ok,
          status: rankingRoute.status ?? 200,
          json: async () => rankingRoute.body ?? {},
        } as unknown as Response;
      }
      throw new Error(`unmocked fetch: ${url}`);
    })
  );
}

describe('bootstrapApp', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports found status, hydrates the server snapshot, and adopts server blocked/curated lists', async () => {
    stubFetch({
      ok: true,
      body: {
        snapshot: {
          ranked: [rankedAlbum('a')],
          lists: { wantToListen: [], notHeard: [], dontCare: [] },
          artist_locks: [],
          blocked_artists: ['Nickelback'],
          curated_skips: ['pitchfork-1980s:47'],
          updated_at: 789,
        },
      },
    });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('found');
    expect(result.pendingSync).toBe(false);
    expect(result.serverSnapshot?.ranked.map((a) => a.mbid)).toEqual(['a']);
    expect(result.blockedArtists).toEqual(['Nickelback']);
    expect(result.curatedSkips).toEqual(new Set(['pitchfork-1980s:47']));
    expect(result.snapshotBaseUpdatedAt).toBe(789);
    expect(result.pool.map((a) => a.mbid)).toContain('seed1');
  });

  it('reports error status and falls back to the cached sync base when the server is unreachable', async () => {
    stubFetch({ ok: false, reject: true });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('error');
    expect(result.serverSnapshot).toBeNull();
    expect(result.pendingSync).toBe(false);
    expect(result.snapshotBaseUpdatedAt).toBeUndefined();
  });

  it('does not let a found server response overwrite blocked/curated lists when a local edit is pending', async () => {
    markPendingSync();
    saveSyncBase(456);
    stubFetch({
      ok: true,
      body: {
        snapshot: {
          ranked: [rankedAlbum('a')],
          lists: { wantToListen: [], notHeard: [], dontCare: [] },
          artist_locks: [],
          blocked_artists: ['ServerBlocked'],
          curated_skips: ['server-skip:1'],
          updated_at: 999,
        },
      },
    });

    const result = await bootstrapApp('11111111-1111-4111-8111-111111111111');

    expect(result.serverLoadStatus).toBe('found');
    expect(result.pendingSync).toBe(true);
    expect(result.blockedArtists).toEqual([]);
    expect(result.curatedSkips).toEqual(new Set());
    expect(result.snapshotBaseUpdatedAt).toBe(456);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/bootstrap.test.ts`
Expected: FAIL — `Cannot find module './bootstrap'` (the file doesn't exist yet).

- [ ] **Step 3: Write `bootstrap.ts`**

Create `web/src/bootstrap.ts`:

```ts
import type { Album, ArtistLock, RankedAlbum, RankingState } from './ranking/types';
import type { SavedLists } from './lists';
import { loadLists } from './lists';
import type { ArtistPlays } from './seed';
import {
  loadSeedPool,
  loadPreferredArtists,
  loadPriorityAlbumPlan,
  playsMapFromPreferred,
} from './seed';
import { loadRanking } from './storage';
import { loadArtistLocks } from './artistLocksStorage';
import {
  loadPriorityQueue,
  loadPriorityPlanVersion,
  priorityQueueFromAlbumPlan,
  priorityQueueFromArtists,
  savePriorityQueue,
  savePriorityPlanVersion,
} from './priority';
import { loadRankingSnapshotDetailed, type RankingSnapshotLoad } from './rankingSync';
import { loadDiscoveredAlbums } from './discovery';
import {
  hasPendingSync,
  loadSyncBase,
  saveSyncBase,
  pendingBaseConflicts,
  markSyncConflict,
} from './syncStatus';
import { loadBlockedArtists, saveBlockedArtists } from './artistBlocks';
import { loadCuratedSkips, saveCuratedSkips } from './curatedSkipsStorage';
import { hydrateAlbums, hydrateLists } from './syncEngine';

export interface BootstrapResult {
  pool: Album[];
  priorityQueue: string[];
  preferred: ArtistPlays[];
  playsByArtist: Map<string, number>;
  cachedState: RankingState;
  cachedLists: SavedLists;
  cachedArtistLocks: ArtistLock[];
  pendingSync: boolean;
  blockedArtists: string[];
  curatedSkips: Set<string>;
  serverSnapshot: { ranked: RankedAlbum[]; lists: SavedLists; artistLocks: ArtistLock[] } | null;
  serverLoadStatus: RankingSnapshotLoad['status'];
  snapshotBaseUpdatedAt: number | null | undefined;
}

/**
 * Moved verbatim from main()'s former lines ~135-239 -- see
 * docs/superpowers/specs/2026-09-23-candidate-discovery-ownership-bootstrap-design.md.
 * Same sequential dependency chain as before (pool -> priority queue ->
 * server snapshot -> discovery merge -> priority-plan reconciliation ->
 * hydration); do not reorder. blockedArtists/curatedSkips ownership stays
 * rankingStore.ts's -- this only produces their one-time initial values.
 */
export async function bootstrapApp(ownerId: string): Promise<BootstrapResult> {
  const pool = await loadSeedPool();

  // Keith's play-weighted artist list drives both weighted selection and the
  // auto-seeded priority queue. Degrade gracefully to uniform/random if it
  // can't be loaded -- the loop must never blank out over a missing sidecar.
  let preferred: ArtistPlays[] = [];
  try {
    preferred = await loadPreferredArtists();
  } catch (err) {
    console.warn('tastetest: failed to load preferred artists, using uniform selection', err);
  }
  const playsByArtist = playsMapFromPreferred(preferred);

  let priorityQueue = loadPriorityQueue();
  // First-visit default: front-load Keith's most-played artists with no manual
  // paste.
  if (priorityQueue.length === 0 && preferred.length > 0) {
    priorityQueue = priorityQueueFromArtists(
      preferred.map((entry) => entry.artist),
      pool
    );
    savePriorityQueue(priorityQueue);
  }

  // Server-authoritative load-on-open. The owner snapshot (full records) is the
  // source of truth; localStorage is only an offline cache. When the server is
  // unreachable or has nothing yet, fall back to the cache -- and if the cache
  // holds local data, seed it up to the server.
  const cachedState: RankingState = loadRanking() ?? { ranked: [], pending: null };
  const cachedLists = loadLists();
  const cachedArtistLocks = loadArtistLocks();
  // A pending-sync flag means the local cache holds edits that were never
  // confirmed saved (writes locked, network error, etc). Computed up front
  // (it depends on nothing fetched below) so every server-authoritative
  // field below -- including blockedArtists/curatedSkips -- can gate on it
  // the same way, instead of letting the server clobber an unsynced local
  // edit just because pendingSync hadn't been checked yet.
  const pendingSync = hasPendingSync();
  // Turso is the source of truth for blocked artists / curated-entry skips,
  // same as ranked/lists/artistLocks -- localStorage here is a fallback for
  // the very first load after this field was introduced (nothing on the
  // server yet) and an offline cache thereafter, never authoritative. Never
  // let the server value overwrite a pending local edit; the same rule
  // resolveInitialState (in main.ts) applies to ranked/lists/artistLocks.
  let blockedArtists = loadBlockedArtists();
  let curatedSkips = new Set(loadCuratedSkips());
  const serverLoad = await loadRankingSnapshotDetailed(ownerId);
  if (serverLoad.status === 'found' && !pendingSync) {
    blockedArtists = serverLoad.blockedArtists;
    saveBlockedArtists(blockedArtists);
    curatedSkips = new Set(serverLoad.curatedSkips);
    saveCuratedSkips(serverLoad.curatedSkips);
  }
  let serverSnapshot =
    serverLoad.status === 'found'
      ? { ranked: serverLoad.ranked, lists: serverLoad.lists, artistLocks: serverLoad.artistLocks }
      : null;
  let snapshotBaseUpdatedAt: number | null | undefined =
    serverLoad.status === 'found'
      ? serverLoad.updatedAt
      : serverLoad.status === 'missing'
        ? null
        : loadSyncBase();
  const discovered = await loadDiscoveredAlbums(ownerId);
  const knownPoolIds = new Set(pool.map((album) => album.mbid));
  for (const album of discovered) {
    if (!knownPoolIds.has(album.mbid)) {
      pool.push(album);
      knownPoolIds.add(album.mbid);
    }
  }
  try {
    const priorityPlan = await loadPriorityAlbumPlan();
    if (priorityPlan && loadPriorityPlanVersion() !== priorityPlan.version) {
      priorityQueue = [
        ...priorityQueueFromAlbumPlan(priorityPlan.albums, pool),
        ...priorityQueue,
      ];
      savePriorityQueue(priorityQueue);
      savePriorityPlanVersion(priorityPlan.version);
    }
  } catch (err) {
    console.warn('tastetest: failed to load priority album plan', err);
  }
  const poolById = new Map(pool.map((album) => [album.mbid, album]));
  if (serverSnapshot) {
    serverSnapshot = {
      ranked: hydrateAlbums(serverSnapshot.ranked, poolById),
      lists: hydrateLists(serverSnapshot.lists, poolById),
      artistLocks: serverSnapshot.artistLocks,
    };
  }
  // When pendingSync is set, the server snapshot is stale by definition --
  // prefer the local cache instead of letting it clobber the unsynced edits,
  // and retry the save below. Pending edits retain the revision they were
  // actually made against; never borrow the just-fetched server revision to
  // save an older cached snapshot.
  if (pendingSync) {
    snapshotBaseUpdatedAt = loadSyncBase();
    if (serverLoad.status !== 'error' && pendingBaseConflicts(
      true, snapshotBaseUpdatedAt, serverLoad.status === 'found' ? serverLoad.updatedAt : null,
    )) markSyncConflict();
  } else if (snapshotBaseUpdatedAt !== undefined) {
    saveSyncBase(snapshotBaseUpdatedAt);
  }

  return {
    pool,
    priorityQueue,
    preferred,
    playsByArtist,
    cachedState,
    cachedLists,
    cachedArtistLocks,
    pendingSync,
    blockedArtists,
    curatedSkips,
    serverSnapshot,
    serverLoadStatus: serverLoad.status,
    snapshotBaseUpdatedAt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/bootstrap.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck and commit**

Run: `cd web && npx tsc --noEmit`
Expected: clean (no errors in `bootstrap.ts` or `bootstrap.test.ts`).

```bash
git add web/src/bootstrap.ts web/src/bootstrap.test.ts
git commit -m "feat(web): extract app-boot sequence into bootstrapApp()

Moves main.ts's ~110-line boot sequence (seed pool, priority queue,
server snapshot, discovery merge, hydration) into a standalone,
unit-tested function. main.ts is not wired to it yet -- next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj"
```

---

### Task 2: Wire `main.ts` to `bootstrapApp()`, verify no regressions

**Files:**
- Modify: `web/src/main.ts:126-239` (the `main()` function's bootstrap block)

**Interfaces:**
- Consumes: `bootstrapApp`, `BootstrapResult` from `./bootstrap` (Task 1).

- [ ] **Step 1: Replace the inline bootstrap block**

In `web/src/main.ts`, inside `async function main()`, replace everything from `const pool = await loadSeedPool();` (current line 135) through the closing of the `if (pendingSync) { ... } else if (...) { saveSyncBase(...); }` block (current line 239) with:

```ts
  const bootstrap = await bootstrapApp(OWNER_ID);
  const pool = bootstrap.pool;
  let priorityQueue = bootstrap.priorityQueue;
  const preferred = bootstrap.preferred;
  const playsByArtist = bootstrap.playsByArtist;
  const cachedState = bootstrap.cachedState;
  const cachedLists = bootstrap.cachedLists;
  const cachedArtistLocks = bootstrap.cachedArtistLocks;
  const pendingSync = bootstrap.pendingSync;
  const blockedArtists = bootstrap.blockedArtists;
  const curatedSkips = bootstrap.curatedSkips;
  const serverSnapshot = bootstrap.serverSnapshot;
  const serverLoadStatus = bootstrap.serverLoadStatus;
  const snapshotBaseUpdatedAt = bootstrap.snapshotBaseUpdatedAt;
```

`priorityQueue` stays `let` because code after this point still reassigns it (`priorityQueue = ...` at several call sites, e.g. current lines 355-486). `serverSnapshot` is `const`: in current `main.ts` it's reassigned only during hydration (now inside `bootstrapApp`) and read exactly once after that, at the `resolveInitialState` call -- confirmed by grep, no reassignment past the removed block.

Two references past the removed block need updating:
- Current line ~282 (`serverLoad.status === 'missing'`) becomes `serverLoadStatus === 'missing'`.
- Everywhere else that read `serverLoad.status` inside the removed block no longer exists in `main.ts` (it's inside `bootstrapApp` now) -- confirm with `grep -n "serverLoad\." web/src/main.ts` that no other reference remains.

Add the import at the top of `main.ts` (near the other local imports, e.g. after the `rankingActions` import):

```ts
import { bootstrapApp } from './bootstrap';
```

Remove now-unused imports from `main.ts` if `tsc`/the linter flags them: `loadSeedPool`, `loadPreferredArtists`, `loadPriorityAlbumPlan`, `playsMapFromPreferred` (from `./seed`, but keep `pickCandidate` which is still used), `loadRanking` (from `./storage`, but check `saveRanking` is still used elsewhere in `main.ts` before removing the whole import), `loadPriorityQueue`, `loadPriorityPlanVersion`, `priorityQueueFromAlbumPlan`, `priorityQueueFromArtists`, `savePriorityPlanVersion` (from `./priority`, but keep `nextPriorityCandidate`, `savePriorityQueue` which are still used later in `main.ts`), `loadRankingSnapshotDetailed` (from `./rankingSync`), `loadDiscoveredAlbums` (from `./discovery`, but keep `discoverArtistDetailed`), `hasPendingSync`, `loadSyncBase`, `pendingBaseConflicts` (from `./syncStatus`, but keep `markPendingSync`, `markSyncConflict`, `saveSyncBase` which are still used later), `loadBlockedArtists` (from `./artistBlocks`, but keep `addBlockedArtist`, `blockedArtistMbids`, `removeBlockedArtist`, `saveBlockedArtists`), `loadCuratedSkips` (from `./curatedSkipsStorage`, but keep `saveCuratedSkips`), `loadArtistLocks` (from `./artistLocksStorage`, but keep `saveArtistLocks`), `hydrateAlbums`, `hydrateLists` (from `./syncEngine`, but keep `createSyncEngine`, `resolveInitialState`).

Do this removal by running the typecheck in Step 3 first and letting the "declared but never used" errors name exactly which ones are safe to drop -- don't guess ahead of the compiler.

- [ ] **Step 2: Run the existing full test suite**

Run: `cd web && npx vitest run`
Expected: PASS, 358/358 plus the 3 new `bootstrap.test.ts` cases from Task 1 (361/361 total).

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both clean. Fix any "declared but never used" import errors per Step 1's note, then re-run.

- [ ] **Step 4: Run the Playwright e2e suite**

Run: `cd web && npx playwright test`
Expected: PASS, 11/11.

- [ ] **Step 5: Manual browser smoke pass**

Run: `cd web && npm run dev`, then in a browser (or via `mcp__claude-in-chrome__*` tools):
1. **Normal boot** -- load the app fresh, confirm the ranked list and a candidate album both render (the mock backend or a real Turso connection must respond normally).
2. **Server unreachable** -- block or redirect `/api/ranking` (e.g. via devtools network throttling set to "offline" briefly, or temporarily stop the local API), reload, confirm the app still boots to the local cache without crashing.
3. **Pending-sync reload** -- make a ranking edit while offline (or with the API blocked) so `pendingSync` gets set, restore the connection, reload, confirm the local edit is preserved and not clobbered by a stale server value.

Expected: all three boot paths render without console errors and match pre-extraction behavior (compare against the deployed production bundle if unsure).

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts
git commit -m "refactor(web): wire main() to bootstrapApp()

Replaces main()'s inline ~110-line boot sequence with a single call
to bootstrapApp() (added in the previous commit). No behavior change;
verified via the full vitest/Playwright suites plus a manual smoke
pass across normal/server-unreachable/pending-sync boot paths.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj"
```

---

## Definition of Done

- `web/src/bootstrap.ts` exists, holds `bootstrapApp()`, and is the only new production file.
- `web/src/bootstrap.test.ts` exists and covers the `found`/`error`/`pendingSync` branches.
- `web/src/main.ts` calls `bootstrapApp()` once; the removed block is gone; no dead imports remain.
- `tsc --noEmit`, `npm run build`, full vitest suite, and full Playwright suite are all green.
- Manual smoke pass across the three boot paths completed with no observed regression.
- No `candidateStore.ts` or equivalent wrapper was introduced.
- `discovery.ts`, `bulkDiscovery.ts`, `artistLockAlbums.ts` are untouched.
