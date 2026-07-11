# Bulk Artist Discovery ("Fill in more albums") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Fill in more albums" button that reads the owner's top-10 ranked artists and bulk-discovers each artist's remaining catalog into the priority queue, reusing the existing single-artist `/api/discover-artist` pipeline.

**Architecture:** All new logic lives in one new file, `web/src/bulkDiscovery.ts` (a pure artist-selection function plus an orchestration function that takes pool/queue/discover as plain arguments). `main.ts` only gets a thin wiring layer: one import, one ~15-line handler, one button in `renderNav()`. No existing function is modified or refactored.

**Tech Stack:** TypeScript, Vite, Vitest. No new dependencies, no schema changes, no new API endpoint.

## Global Constraints

- All work happens on branch `feat/bulk-artist-discovery`, not `main` — the whole point is a reviewable, revertable PR (see spec's Reversibility section).
- New/changed files: `web/src/bulkDiscovery.ts` (new), `web/src/bulkDiscovery.test.ts` (new), `web/src/main.ts` (small wiring additions only — no existing function bodies change).
- `TOP_ARTIST_DISCOVERY_COUNT = 10`, not user-configurable in this iteration.
- Per-artist discovery calls run sequentially (never `Promise.all`), with a 300ms default delay between them, overridable via `deps.delayMs` for tests.
- Test runner: `npm run test` (vitest) from `web/`. Build check: `npm run build` (runs `tsc` first) from `web/`.
- Design source of truth: `docs/superpowers/specs/2026-07-10-bulk-artist-discovery-design.md`.

---

### Task 1: Create the feature branch

**Files:** none (git operation only)

- [ ] **Step 1: Create and switch to the feature branch**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git checkout -b feat/bulk-artist-discovery
```

Expected: `Switched to a new branch 'feat/bulk-artist-discovery'`.

- [ ] **Step 2: Verify the branch tracks main's current state**

```bash
git status
```

Expected: `On branch feat/bulk-artist-discovery`, `nothing to commit, working tree clean`.

---

### Task 2: `topRankedArtists` — pure artist selection

**Files:**
- Create: `web/src/bulkDiscovery.ts`
- Test: `web/src/bulkDiscovery.test.ts`

**Interfaces:**
- Produces: `export const TOP_ARTIST_DISCOVERY_COUNT = 10;` and `export function topRankedArtists(ranked: Album[], n: number): { mbid: string; name: string }[]` — later tasks in this file and `main.ts` depend on this exact signature.

- [ ] **Step 1: Write the failing tests**

Create `web/src/bulkDiscovery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import { topRankedArtists } from './bulkDiscovery';

function album(overrides: Partial<Album> & { mbid: string }): Album {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Unknown Artist',
    primary_artist_mbid: undefined,
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

describe('topRankedArtists', () => {
  it('returns distinct artists in rank order, keeping the first (highest-ranked) occurrence', () => {
    const ranked = [
      album({ mbid: 'a1', primary_artist_name: 'Radiohead', primary_artist_mbid: 'artist-radiohead' }),
      album({ mbid: 'b1', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' }),
      album({ mbid: 'a2', primary_artist_name: 'Radiohead', primary_artist_mbid: 'artist-radiohead' }),
    ];

    const result = topRankedArtists(ranked, 10);

    expect(result).toEqual([
      { mbid: 'artist-radiohead', name: 'Radiohead' },
      { mbid: 'artist-bjork', name: 'Björk' },
    ]);
  });

  it('skips albums with no primary_artist_mbid', () => {
    const ranked = [
      album({ mbid: 'a1', primary_artist_name: 'No MBID Artist', primary_artist_mbid: undefined }),
      album({ mbid: 'b1', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' }),
    ];

    const result = topRankedArtists(ranked, 10);

    expect(result).toEqual([{ mbid: 'artist-bjork', name: 'Björk' }]);
  });

  it('stops at n distinct artists even if the ranked list has more', () => {
    const ranked = [
      album({ mbid: 'a1', primary_artist_name: 'Artist A', primary_artist_mbid: 'artist-a' }),
      album({ mbid: 'b1', primary_artist_name: 'Artist B', primary_artist_mbid: 'artist-b' }),
      album({ mbid: 'c1', primary_artist_name: 'Artist C', primary_artist_mbid: 'artist-c' }),
    ];

    const result = topRankedArtists(ranked, 2);

    expect(result).toEqual([
      { mbid: 'artist-a', name: 'Artist A' },
      { mbid: 'artist-b', name: 'Artist B' },
    ]);
  });

  it('returns everything when there are fewer than n distinct artists', () => {
    const ranked = [album({ mbid: 'a1', primary_artist_name: 'Artist A', primary_artist_mbid: 'artist-a' })];

    const result = topRankedArtists(ranked, 10);

    expect(result).toEqual([{ mbid: 'artist-a', name: 'Artist A' }]);
  });

  it('returns an empty array for an empty ranked list', () => {
    expect(topRankedArtists([], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts
```

Expected: FAIL — `Cannot find module './bulkDiscovery'` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/bulkDiscovery.ts`:

```ts
import type { Album } from './ranking/types';

export const TOP_ARTIST_DISCOVERY_COUNT = 10;

export function topRankedArtists(
  ranked: Album[],
  n: number
): { mbid: string; name: string }[] {
  const seen = new Set<string>();
  const out: { mbid: string; name: string }[] = [];
  for (const album of ranked) {
    if (out.length >= n) break;
    const mbid = album.primary_artist_mbid;
    if (!mbid || seen.has(mbid)) continue;
    seen.add(mbid);
    out.push({ mbid, name: album.primary_artist_name });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/bulkDiscovery.ts web/src/bulkDiscovery.test.ts
git commit -m "feat(discovery): add topRankedArtists for bulk discovery"
```

---

### Task 3: `runBulkDiscovery` — orchestration

**Files:**
- Modify: `web/src/bulkDiscovery.ts` (append to the file created in Task 2)
- Test: `web/src/bulkDiscovery.test.ts` (append)

**Interfaces:**
- Consumes: `topRankedArtists` and `TOP_ARTIST_DISCOVERY_COUNT` from Task 2 (same file). `DiscoverArtistResult` type from `web/src/discovery.ts` (already exists: `{ status: 'found'; albums: Album[] } | { status: 'empty' } | { status: 'locked' } | { status: 'error' }`).
- Produces: `export type BulkDiscoverDeps = { discover: (artistName: string, artistMbid: string, knownMbids: string[]) => Promise<DiscoverArtistResult>; onProgress?: (message: string) => void; delayMs?: number }` and `export async function runBulkDiscovery(ranked: Album[], pool: Album[], priorityQueue: string[], deps: BulkDiscoverDeps): Promise<{ priorityQueue: string[]; summary: string }>` — Task 4 (`main.ts`) depends on this exact signature.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/bulkDiscovery.test.ts` (add the import and the new `describe` block):

```ts
import type { DiscoverArtistResult } from './discovery';
import { runBulkDiscovery } from './bulkDiscovery';

describe('runBulkDiscovery', () => {
  const radiohead = { mbid: 'artist-radiohead', name: 'Radiohead' };
  const bjork = { mbid: 'artist-bjork', name: 'Björk' };

  function rankedFor(artists: { mbid: string; name: string }[]): Album[] {
    return artists.map((a, i) =>
      album({ mbid: `ranked-${i}`, primary_artist_name: a.name, primary_artist_mbid: a.mbid })
    );
  }

  it('short-circuits with an unlock message when the first call is locked', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'locked' }));

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      ['existing-mbid'],
      { discover, delayMs: 0 }
    );

    expect(result).toEqual({
      priorityQueue: ['existing-mbid'],
      summary: 'Unlock writes to fill in more albums.',
    });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('continues the batch when one artist errors, and reports the failure count', async () => {
    const discover = vi.fn(async (artistName: string): Promise<DiscoverArtistResult> => {
      if (artistName === 'Radiohead') return { status: 'error' };
      return {
        status: 'found',
        albums: [album({ mbid: 'new-bjork-album', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' })],
      };
    });

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      [],
      { discover, delayMs: 0 }
    );

    expect(result.priorityQueue).toEqual(['new-bjork-album']);
    expect(result.summary).toBe('Added 1 new albums from 2 artists. 0 already fully discovered, 1 failed.');
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('prepends newly found albums in top-artist-first order, ahead of the existing queue', async () => {
    const discover = vi.fn(async (artistName: string): Promise<DiscoverArtistResult> => ({
      status: 'found',
      albums: [
        album({
          mbid: `new-${artistName}`,
          primary_artist_name: artistName,
          primary_artist_mbid: artistName === 'Radiohead' ? 'artist-radiohead' : 'artist-bjork',
        }),
      ],
    }));

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      ['old-queued-mbid'],
      { discover, delayMs: 0 }
    );

    expect(result.priorityQueue).toEqual(['new-Radiohead', 'new-Björk', 'old-queued-mbid']);
  });

  it('reports an empty-catalog artist without treating it as a failure', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    const result = await runBulkDiscovery(rankedFor([radiohead]), [], [], { discover, delayMs: 0 });

    expect(result.summary).toBe('Added 0 new albums from 1 artists. 1 already fully discovered, 0 failed.');
  });

  it('returns a "rank some albums first" message and makes no calls when nothing is ranked', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    const result = await runBulkDiscovery([], [], ['old-mbid'], { discover, delayMs: 0 });

    expect(result).toEqual({ priorityQueue: ['old-mbid'], summary: 'Rank some albums first.' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('passes each artist\'s pool-matched mbids as knownMbids', async () => {
    const pool: Album[] = [
      album({ mbid: 'existing-radiohead-1', primary_artist_name: 'Radiohead', primary_artist_mbid: 'artist-radiohead' }),
      album({ mbid: 'existing-bjork-1', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' }),
    ];
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    await runBulkDiscovery(rankedFor([radiohead]), pool, [], { discover, delayMs: 0 });

    expect(discover).toHaveBeenCalledWith('Radiohead', 'artist-radiohead', ['existing-radiohead-1']);
  });
});
```

Also add `vi` to the existing `import { describe, expect, it } from 'vitest';` line at the top of the file, making it `import { describe, expect, it, vi } from 'vitest';`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts
```

Expected: FAIL — `runBulkDiscovery is not exported from './bulkDiscovery'` (Task 2's tests still pass; only the new `describe('runBulkDiscovery', ...)` block fails).

- [ ] **Step 3: Write the minimal implementation**

Append to `web/src/bulkDiscovery.ts`:

```ts
import type { DiscoverArtistResult } from './discovery';

export type BulkDiscoverDeps = {
  discover: (
    artistName: string,
    artistMbid: string,
    knownMbids: string[]
  ) => Promise<DiscoverArtistResult>;
  onProgress?: (message: string) => void;
  delayMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBulkDiscovery(
  ranked: Album[],
  pool: Album[],
  priorityQueue: string[],
  deps: BulkDiscoverDeps
): Promise<{ priorityQueue: string[]; summary: string }> {
  const artists = topRankedArtists(ranked, TOP_ARTIST_DISCOVERY_COUNT);
  if (artists.length === 0) {
    return { priorityQueue, summary: 'Rank some albums first.' };
  }

  const delayMs = deps.delayMs ?? 300;
  const newQueue: string[] = [];
  let foundCount = 0;
  let emptyCount = 0;
  let errorCount = 0;

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    deps.onProgress?.(`Discovering ${i + 1}/${artists.length} artists…`);

    const knownMbids = pool
      .filter((a) => a.primary_artist_mbid === artist.mbid)
      .map((a) => a.mbid);
    const result = await deps.discover(artist.name, artist.mbid, knownMbids);

    if (result.status === 'locked') {
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.' };
    } else if (result.status === 'error') {
      errorCount++;
    } else if (result.status === 'empty') {
      emptyCount++;
    } else {
      const poolIds = new Set(pool.map((a) => a.mbid));
      const newToPool = result.albums.filter((a) => !poolIds.has(a.mbid));
      pool.push(...newToPool);
      newQueue.push(...result.albums.map((a) => a.mbid));
      foundCount += result.albums.length;
    }

    if (i < artists.length - 1) await delay(delayMs);
  }

  let summary = `Added ${foundCount} new albums from ${artists.length} artists.`;
  if (emptyCount > 0 || errorCount > 0) {
    summary += ` ${emptyCount} already fully discovered, ${errorCount} failed.`;
  }

  return { priorityQueue: [...newQueue, ...priorityQueue], summary };
}
```

Place this new `import type { DiscoverArtistResult } from './discovery';` line alongside the existing `import type { Album } from './ranking/types';` at the top of the file (both import lines together).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npx vitest run src/bulkDiscovery.test.ts
```

Expected: PASS, 11 tests (5 from Task 2 + 6 from this task).

- [ ] **Step 5: Commit**

```bash
git add web/src/bulkDiscovery.ts web/src/bulkDiscovery.test.ts
git commit -m "feat(discovery): add runBulkDiscovery orchestration"
```

---

### Task 4: Wire the button into `main.ts`

**Files:**
- Modify: `web/src/main.ts:39` (imports), `web/src/main.ts:497` (insert handler after `handleDiscoverArtist`), `web/src/main.ts:832` (insert button in `renderNav`)

**Interfaces:**
- Consumes: `runBulkDiscovery` from Task 3 (`./bulkDiscovery`). Existing in-scope closures/vars: `pool` (const, mutated via push), `priorityQueue` (let, reassigned), `state.ranked`, `session.session_id`, `discoverArtistDetailed` (already imported), `savePriorityQueue`, `reselectCandidate`, `rankList.showStatus`, `rankList.render`, `nav` (the `<nav class="view-switcher">` element).

No new test file — this task is DOM/orchestration glue in `main.ts`, matching this project's existing pattern where `main.ts`'s internal closures (e.g. `handleDiscoverArtist`, `renderNav`) aren't unit-tested (`main.test.ts` only covers `main.ts`'s exported pure functions: `hydrateAlbums`, `resolveInitialState`, `restoreFromCode`, `serverSnapshotIsRicher`). Verified manually in Task 5 instead.

- [ ] **Step 1: Add the import**

In `web/src/main.ts`, change line 38 from:

```ts
import { discoverArtistDetailed, loadDiscoveredAlbums } from './discovery';
```

to:

```ts
import { discoverArtistDetailed, loadDiscoveredAlbums } from './discovery';
import { runBulkDiscovery, TOP_ARTIST_DISCOVERY_COUNT } from './bulkDiscovery';
```

- [ ] **Step 2: Add the in-flight guard and handler**

In `web/src/main.ts`, immediately after the closing `}` of `handleDiscoverArtist` (currently line 497, right before `let lockedArtistMbid: string | null = null;`), insert:

```ts
  let bulkDiscoveryInFlight = false;

  async function handleBulkDiscover(): Promise<void> {
    if (bulkDiscoveryInFlight) return;
    bulkDiscoveryInFlight = true;
    renderNav();
    try {
      const result = await runBulkDiscovery(state.ranked, pool, priorityQueue, {
        discover: (name, mbid, known) => discoverArtistDetailed(session.session_id, name, mbid, known),
        onProgress: (msg) => rankList.showStatus(msg),
      });
      priorityQueue = result.priorityQueue;
      savePriorityQueue(priorityQueue);
      reselectCandidate();
      rankList.render();
      rankList.showStatus(result.summary);
    } finally {
      bulkDiscoveryInFlight = false;
      renderNav();
    }
  }
```

- [ ] **Step 3: Add the button in `renderNav()`**

In `web/src/main.ts`, inside `renderNav()`, immediately after `nav.append(writeBtn);` (currently line 832) and before the function's closing `}` (currently line 833), insert:

```ts
    const bulkDiscoverBtn = document.createElement('button');
    bulkDiscoverBtn.type = 'button';
    bulkDiscoverBtn.className = 'view-tab';
    bulkDiscoverBtn.textContent = bulkDiscoveryInFlight ? 'Discovering…' : 'Fill in more albums';
    bulkDiscoverBtn.disabled = bulkDiscoveryInFlight;
    bulkDiscoverBtn.title = `Bulk-discover the remaining catalog for your top ${TOP_ARTIST_DISCOVERY_COUNT} ranked artists`;
    bulkDiscoverBtn.addEventListener('click', () => {
      void handleBulkDiscover();
    });
    nav.append(bulkDiscoverBtn);
```

`TOP_ARTIST_DISCOVERY_COUNT` is already in scope from Step 1's import.

- [ ] **Step 4: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
cd web && npm run test
```

Expected: all tests pass, including the 11 new `bulkDiscovery.test.ts` cases and the pre-existing `main.test.ts` suite (unchanged, since no exported function from `main.ts` changed shape).

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts
git commit -m "feat(discovery): wire up 'Fill in more albums' button"
```

---

### Task 5: Manual verification

**Files:** none (manual browser check)

- [ ] **Step 1: Start the dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Exercise the golden path**

1. Open the app, unlock writes (the write key flow already in place).
2. Ensure at least one album is ranked (rank one if the list is empty).
3. Click "Fill in more albums" in the nav.
4. Expected: button flips to disabled "Discovering…", status messages cycle ("Discovering 1/N artists…" etc.), then a final summary appears ("Added X new albums from N artists…").
5. Switch to the ranked view and confirm the priority queue picked up new candidates from a top-ranked artist (the very next candidate shown should be by one of your top-ranked artists, per the queue-ordering behavior from Task 3).

- [ ] **Step 3: Exercise the locked-writes path**

1. Click "Lock writes" in the nav.
2. Click "Fill in more albums".
3. Expected: status shows "Unlock writes to fill in more albums." and the button re-enables immediately (no long hang, since the batch short-circuits on the first `locked` result).

- [ ] **Step 4: Exercise the empty-ranking path**

If reachable in the current data (or by testing against a fresh/empty session): with zero ranked albums, click the button and confirm the status reads "Rank some albums first." with no network calls (check the Network tab — no `/api/discover-artist` requests fire).

- [ ] **Step 5: Record the result**

No commit for this task — if all three paths behave as expected, proceed to Task 6. If something's off, fix it in the relevant Task 2-4 file and re-run that task's tests before continuing.

---

### Task 6: Push the branch and open the PR

**Files:** none (git/GitHub operations)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/bulk-artist-discovery
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: bulk-discover top-ranked artists' catalogs" --body "$(cat <<'EOF'
## Summary
- Adds a "Fill in more albums" button that reads the owner's top-10 ranked artists and bulk-discovers each artist's remaining catalog into the priority queue.
- All new logic is isolated to `web/src/bulkDiscovery.ts` (+ test file); `main.ts` only gets a thin wiring layer (one import, one handler, one button) — no existing function is modified. See the design spec for the full reversibility rationale and a deletion checklist if this doesn't pan out.

Design: `docs/superpowers/specs/2026-07-10-bulk-artist-discovery-design.md`
Plan: `docs/superpowers/plans/2026-07-10-bulk-artist-discovery.md`

## Test plan
- [x] `npm run test` (vitest) — all tests pass, including 11 new `bulkDiscovery.test.ts` cases
- [x] `npx tsc --noEmit` — no type errors
- [x] Manual: golden path (button discovers, queues, and surfaces new candidates)
- [x] Manual: locked-writes path (short-circuits with unlock message)
- [x] Manual: empty-ranking path ("Rank some albums first.", no network calls)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed to stdout — share it back to Keith.

---

## Self-Review Notes

- **Spec coverage:** Reversibility → Tasks 1 (branch) & 6 (PR) plus the single-file isolation enforced throughout Tasks 2-4. Artist selection → Task 2. Orchestration (sequential calls, delay, locked/error/empty handling, queue ordering) → Task 3. `main.ts` wiring (button, handler, disabled state) → Task 4. Error handling → covered by Task 3's tests and Task 5's manual locked/empty paths. Testing section of the spec (pure logic tested, I/O glue verified manually) → matches Task 2/3 (tests) vs. Task 4/5 (manual) split. Non-goals are simply not built (no tasks for similar-artist expansion, auto-trigger, review UI, configurable N, or parallel calls).
- **Type consistency:** `runBulkDiscovery(ranked, pool, priorityQueue, deps)` signature is identical between Task 3's implementation, Task 3's tests, and Task 4's `main.ts` call site. `BulkDiscoverDeps.discover` signature `(artistName, artistMbid, knownMbids) => Promise<DiscoverArtistResult>` matches both the test mocks and the `main.ts` call to `discoverArtistDetailed`. `topRankedArtists(ranked, n)` return shape `{ mbid, name }[]` is consumed identically inside `runBulkDiscovery`.
- **No placeholders:** every step above has complete, runnable code — no "add error handling" or "similar to Task N" shortcuts.
