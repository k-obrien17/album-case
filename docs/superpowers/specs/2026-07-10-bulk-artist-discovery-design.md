# Bulk artist discovery ("Fill in more albums")

## Problem

The priority queue that decides what candidate to show next is currently seeded only from static files (`preferred-artists.json`, `priority-albums.json`) and one-artist-at-a-time clicks on the per-row "▶" discover button (`rankList.ts`). Nothing looks at the owner's actual, live ranking to decide what to pull in next — once the static seed and manual clicks are exhausted, the queue runs dry even though the ranking itself already shows clearly which artists the owner favors.

## Scope

In scope: a single global button that reads the current `ranked` list, picks the owner's top N distinct artists by rank position, bulk-discovers each artist's remaining catalog via the existing `/api/discover-artist` pipeline, and queues everything found.

Out of scope (deferred, see Non-goals): similar/related-artist expansion, automatic/background triggering, a review-and-approve step before albums enter the queue, configurable N in the UI.

## Artist selection

New pure function, colocated with `priority.ts` (or a new small module — see Testing):

```ts
function topRankedArtists(ranked: Album[], n: number): { mbid: string; name: string }[]
```

- Walk `ranked` top-to-bottom (index 0 = most preferred, per `RankingState`).
- Skip albums with no `primary_artist_mbid` (can't discover without an MBID; matches the existing guard in `handleDiscoverArtist`).
- Dedupe by `primary_artist_mbid`, keeping first occurrence (i.e., the artist's highest-ranked album determines their position in the result).
- Stop once `n` distinct artists are collected, or the ranked list is exhausted (fewer than `n` distinct artists is not an error — just process what's there).
- `n` is a module constant, `TOP_ARTIST_DISCOVERY_COUNT = 10`, not user-configurable in this iteration.

If `ranked` has zero eligible (MBID-bearing) albums, the result is `[]` and the bulk handler short-circuits with a status message ("Rank some albums first.") rather than calling the API.

## Bulk discovery flow

New `handleBulkDiscover()` in `main.ts`, sitting alongside `handleDiscoverArtist`. Both already share the same per-artist MusicBrainz call (`discoverArtistDetailed`) and the same pool/queue merge shape, so the merge step is extracted into a shared helper:

```ts
function mergeDiscovered(found: Album[]): void {
  const poolIds = new Set(pool.map((a) => a.mbid));
  const newToPool = found.filter((a) => !poolIds.has(a.mbid));
  pool.push(...newToPool);
  priorityQueue = [...found.map((a) => a.mbid), ...priorityQueue];
}
```

`handleDiscoverArtist` calls this once per click (unchanged behavior). `handleBulkDiscover` calls it once **per artist, in top-N order**, but only persists/re-renders once at the end:

1. `topRankedArtists(state.ranked, TOP_ARTIST_DISCOVERY_COUNT)` → ordered artist list. If empty, show status and return.
2. If writes are locked (`!getWriteKey()`), show "Unlock writes to fill in more albums." once and return — no point making N calls that will all report `locked`.
3. For each artist, sequentially (not `Promise.all`) with a short delay between requests (300ms) to stay polite to MusicBrainz on the server side:
   - `knownMbids` = `pool.filter(a => a.primary_artist_mbid === artist.mbid).map(a => a.mbid)` (same computation as `handleDiscoverArtist`).
   - Call `discoverArtistDetailed(session.session_id, artist.name, artist.mbid, knownMbids)`.
   - `found` → `mergeDiscovered(found.albums)`; tally `foundCount += found.albums.length`.
   - `empty` → tally `emptyCount += 1`.
   - `error` → tally `errorCount += 1`; continue to the next artist (don't abort the batch).
   - Update in-progress status: `rankList.showStatus(\`Discovering ${i + 1}/${artists.length} artists…\`)`.
4. After the loop: `savePriorityQueue(priorityQueue)` once, `reselectCandidate()` once, `rankList.render()` once — matching the existing single-artist handler's post-merge steps but batched.
5. Final summary via `rankList.showStatus`: `"Added {foundCount} new albums from {artists.length - emptyCount - errorCount} artists."` plus, only if nonzero, ` "{emptyCount} already fully discovered, {errorCount} failed."`

Processing top-ranked-artist-first and only touching `priorityQueue`/`pool` once at the end means the highest-ranked artist's new albums land at the very front of the queue (since each `mergeDiscovered` call prepends), and `diversifyByArtist` (already run by `nextPriorityCandidate` at selection time, untouched by this feature) still interleaves across artists the same way it already does for any other queue state — no changes needed there.

## UI

One new button in the top nav (`renderNav()` in `main.ts`), appended next to the existing "Unlock writes" / "Lock writes" toggle, reusing the `.view-tab` class (same pill style, not the per-row `.rank-discover` icon-button style, since this is a global action, not a row action):

```ts
const bulkDiscoverBtn = document.createElement('button');
bulkDiscoverBtn.type = 'button';
bulkDiscoverBtn.className = 'view-tab';
bulkDiscoverBtn.textContent = 'Fill in more albums';
bulkDiscoverBtn.addEventListener('click', () => { void handleBulkDiscover(); });
nav.append(bulkDiscoverBtn);
```

Button is disabled (`bulkDiscoverBtn.disabled = true`, re-enabled in a `finally`) for the duration of the run so a second click can't overlap an in-flight batch.

## Error handling

- **Locked writes**: single status message, no API calls made (checked once up front, per Bulk discovery flow step 2).
- **Per-artist MusicBrainz/network error**: skipped, tallied, batch continues — matches this project's existing no-retry-loop pattern for discovery failures ("user can just click again," from the per-artist discovery spec). Here, "click again" bulk-retries all artists, which is acceptable since already-discovered albums come back as part of `known_mbids` and are excluded server-side, so re-running is cheap for already-succeeded artists.
- **Zero eligible artists**: short status message, no API calls.

## Testing

`topRankedArtists` is a pure function → colocated `priority.test.ts` gets new cases: dedupe by MBID keeping first occurrence, skip null-MBID albums, truncate at N, handle fewer-than-N distinct artists.

`handleBulkDiscover` and `mergeDiscovered` are I/O glue in `main.ts` (sequencing fetch calls, mutating module-level `pool`/`priorityQueue`), matching this project's existing pattern where I/O glue in `main.ts` isn't unit-tested (see the per-artist discovery spec's Testing section) — verified instead via manual run per this repo's `verify` skill.

## Non-goals

- Similar/related-artist expansion (deferred; a separate feature per the brainstorming discussion — would need a new "similar artist" data source beyond MusicBrainz browse-by-artist-mbid).
- Automatic or background triggering (queue-low or on-load auto-run).
- A review/approve step between discovery and queueing — found albums go straight into the priority queue, same trust level as the existing per-row discover button.
- User-configurable N (hardcoded constant `TOP_ARTIST_DISCOVERY_COUNT = 10`).
- Parallelizing the per-artist calls.
