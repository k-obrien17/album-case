# Bulk artist discovery ("Fill in more albums")

## Problem

The priority queue that decides what candidate to show next is currently seeded only from static files (`preferred-artists.json`, `priority-albums.json`) and one-artist-at-a-time clicks on the per-row "▶" discover button (`rankList.ts`). Nothing looks at the owner's actual, live ranking to decide what to pull in next — once the static seed and manual clicks are exhausted, the queue runs dry even though the ranking itself already shows clearly which artists the owner favors.

## Scope

In scope: a single global button that reads the current `ranked` list, picks the owner's top N distinct artists by rank position, bulk-discovers each artist's remaining catalog via the existing `/api/discover-artist` pipeline, and queues everything found.

Out of scope (deferred, see Non-goals): similar/related-artist expansion, automatic/background triggering, a review-and-approve step before albums enter the queue, configurable N in the UI.

## Reversibility (why this shape)

This is a speculative feature — Keith may decide it's not worth keeping. The design is built so removing it later is: delete `web/src/bulkDiscovery.ts` (+ its test file), remove one `import`, one handler function, and one button block from `main.ts`. Concretely:

- **No changes to existing files' logic.** `handleDiscoverArtist` (the existing per-row discover handler) is untouched — not refactored, not shared, not extracted from. All new orchestration logic lives in a new file, `web/src/bulkDiscovery.ts`, that takes the current pool/queue/ranked state as plain arguments and hands back what changed. `main.ts` only wires it up; it holds no bulk-discovery logic of its own beyond a thin handler.
- **One new file for the pure/orchestration logic** (`bulkDiscovery.ts`), **one new colocated test file**, **one new UI touchpoint** (a single button + one small handler in `main.ts`). No schema changes, no new API endpoint, no new persisted keys.
- See **Removal** at the end of this doc for the exact deletion checklist.

## Artist selection

`web/src/bulkDiscovery.ts` — pure function:

```ts
export function topRankedArtists(ranked: Album[], n: number): { mbid: string; name: string }[]
```

- Walk `ranked` top-to-bottom (index 0 = most preferred, per `RankingState`).
- Skip albums with no `primary_artist_mbid` (can't discover without an MBID; matches the existing guard in `handleDiscoverArtist`).
- Dedupe by `primary_artist_mbid`, keeping first occurrence (i.e., the artist's highest-ranked album determines their position in the result).
- Stop once `n` distinct artists are collected, or the ranked list is exhausted (fewer than `n` distinct artists is not an error — just process what's there).

`n` is a constant exported from the same file, `TOP_ARTIST_DISCOVERY_COUNT = 10`, not user-configurable in this iteration.

## Bulk discovery orchestration

Also in `bulkDiscovery.ts`, so it stays independent of `main.ts`'s module-level `pool`/`priorityQueue` variables:

```ts
export type BulkDiscoverDeps = {
  discover: (artistName: string, artistMbid: string, knownMbids: string[]) => Promise<DiscoverArtistResult>;
  onProgress?: (message: string) => void;
  delayMs?: number; // default 300 — spacing between MusicBrainz calls
};

export async function runBulkDiscovery(
  ranked: Album[],
  pool: Album[],           // mutated in place via push, matching handleDiscoverArtist's existing style
  priorityQueue: string[],
  deps: BulkDiscoverDeps
): Promise<{ priorityQueue: string[]; summary: string }>
```

Flow:

1. `topRankedArtists(ranked, TOP_ARTIST_DISCOVERY_COUNT)` → ordered artist list. If empty, return `{ priorityQueue, summary: 'Rank some albums first.' }` — no API calls.
2. For each artist, sequentially (not `Promise.all`), waiting `delayMs` between calls to stay polite to MusicBrainz:
   - `knownMbids = pool.filter(a => a.primary_artist_mbid === artist.mbid).map(a => a.mbid)` (same computation `handleDiscoverArtist` already does).
   - Call `deps.discover(artist.name, artist.mbid, knownMbids)`.
   - **First result is `locked`**: stop immediately, return `{ priorityQueue, summary: 'Unlock writes to fill in more albums.' }` — every remaining call would fail the same way, no point making them.
   - `found`: dedupe against `pool` by mbid, `pool.push(...newToPool)`, prepend all found mbids to a local `newQueue` accumulator, tally `foundCount`.
   - `empty`: tally `emptyCount`.
   - `error`: tally `errorCount`, continue to the next artist (don't abort the whole batch on one artist's failure).
   - `deps.onProgress?.(\`Discovering ${i + 1}/${artists.length} artists…\`)`.
3. Return `{ priorityQueue: [...newQueue, ...priorityQueue], summary }`, where `summary` is `"Added {foundCount} new albums from {n} artists."` plus, only if nonzero, `" {emptyCount} already fully discovered, {errorCount} failed."`.

Processing top-ranked-artist-first and only building the final queue once (not one `savePriorityQueue` per artist) means the highest-ranked artist's new albums end up closest to the front, and `diversifyByArtist` — already run by `nextPriorityCandidate` at selection time, completely untouched by this feature — interleaves across artists exactly as it already does for any other queue state. No changes needed there.

## `main.ts` wiring (the only touch to existing files)

```ts
import { runBulkDiscovery } from './bulkDiscovery';

async function handleBulkDiscover(): Promise<void> {
  const result = await runBulkDiscovery(
    state.ranked,
    pool,
    priorityQueue,
    {
      discover: (name, mbid, known) => discoverArtistDetailed(session.session_id, name, mbid, known),
      onProgress: (msg) => rankList.showStatus(msg),
    }
  );
  priorityQueue = result.priorityQueue;
  savePriorityQueue(priorityQueue);
  reselectCandidate();
  rankList.render();
  rankList.showStatus(result.summary);
}
```

Button, appended in `renderNav()` next to the existing "Unlock writes"/"Lock writes" toggle, reusing the `.view-tab` pill style (global action, not the per-row `.rank-discover` icon-button style):

```ts
const bulkDiscoverBtn = document.createElement('button');
bulkDiscoverBtn.type = 'button';
bulkDiscoverBtn.className = 'view-tab';
bulkDiscoverBtn.textContent = 'Fill in more albums';
bulkDiscoverBtn.addEventListener('click', () => { void handleBulkDiscover(); });
nav.append(bulkDiscoverBtn);
```

`handleBulkDiscover` disables the button for the duration of the run (`bulkDiscoverBtn.disabled = true`, re-enabled in a `finally`) so a second click can't overlap an in-flight batch.

That's the entire footprint in `main.ts`: one import, one ~12-line handler, one button block. No existing function is modified.

## Error handling

- **Locked writes**: detected from the first `discover()` call's `locked` result, batch stops there — see orchestration step 2.
- **Per-artist MusicBrainz/network error**: skipped, tallied, batch continues — matches this project's existing no-retry-loop pattern for discovery failures ("user can just click again," from the per-artist discovery spec). Here, "click again" bulk-retries all artists, which is cheap for already-succeeded artists since their albums come back via `known_mbids` and are excluded server-side.
- **Zero eligible artists**: short status message, no API calls.

## Testing

`topRankedArtists` is pure → `web/src/bulkDiscovery.test.ts` covers: dedupe by MBID keeping first occurrence, skip null-MBID albums, truncate at N, handle fewer-than-N distinct artists.

`runBulkDiscovery` takes its side effect (`discover`) as an injected dependency, so it's testable with a fake/mock `discover` function without touching `fetch` or `main.ts` — colocated tests cover: locked-on-first-call short-circuits, error-on-one-artist doesn't abort the batch, summary counts are correct, queue ordering (top artist's new albums end up closest to the front).

## Removal

If this feature doesn't pan out, remove it with no ripple into other code:

1. Delete `web/src/bulkDiscovery.ts` and `web/src/bulkDiscovery.test.ts`.
2. In `main.ts`: remove the `import { runBulkDiscovery } from './bulkDiscovery';` line, the `handleBulkDiscover` function, and the `bulkDiscoverBtn` block in `renderNav()`.
3. No schema, API, or persisted-storage changes to revert — nothing else references this feature.

## Non-goals

- Similar/related-artist expansion (deferred; a separate feature — would need a new "similar artist" data source beyond MusicBrainz browse-by-artist-mbid).
- Automatic or background triggering (queue-low or on-load auto-run).
- A review/approve step between discovery and queueing — found albums go straight into the priority queue, same trust level as the existing per-row discover button.
- User-configurable N (hardcoded constant `TOP_ARTIST_DISCOVERY_COUNT = 10`).
- Parallelizing the per-artist calls.
