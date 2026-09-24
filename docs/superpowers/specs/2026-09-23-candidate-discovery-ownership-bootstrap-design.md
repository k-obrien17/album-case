# Candidate/discovery ownership + bootstrap extraction

## Scope note (post-Fable review)

Narrowed after a Fable consult on 2026-09-23. Original draft proposed two
new files (`bootstrap.ts` + `candidateStore.ts`); this version builds
`bootstrap.ts` only. `candidateStore.ts` is dropped: `pool`/`priorityQueue`/
`candidateArtistCooldown` have a single consumer (`main.ts` itself), so a
get/set wrapper around them would rewrite call sites for no testability or
boundary gain, the same anti-pattern the standing code audit already flags
for `rankingStore.ts`/`syncEngine.ts` (reachable only through `main()`,
no direct tests). The reference counts in the original draft were also
inflated (combined several identifiers into one number); actual counts are
`pool` ~37, `priorityQueue` ~20, `candidateArtistCooldown` 4.

## Context

This is the last of the 6-stage simplify plan whose earlier stages pulled
domains out of `web/src/main.ts` (1487 lines):

1. `syncEngine.ts` -- save/retry/banner engine.
2. Playwright e2e harness (prerequisite).
3. `rankingStore.ts` -- ranking-snapshot state ownership
   (`state`/`lists`/`artistLocks`/`blockedArtists`/`curatedSkips`).
4. `rankingActions.ts` -- deduplicated ranking-action call sites.
5. `rankListSearch.ts` -- MusicBrainz search UI split out of `rankList.ts`.
6. **This stage.** Candidate/discovery ownership + bootstrap.

Stages 1 and 3 both left the app-boot sequence inline in `main()`
(lines ~126-239) because it is a real sequential dependency chain -- not
separable concerns -- and pulling it apart risked a subtle bootstrap bug
(stale pool, wrong hydration order) with no automated way to catch it.

## Goal

Reduce `main.ts` by extracting the bootstrap sequence into its own async
function, with **no behavior change**. This is a mechanical,
behavior-preserving extraction, not a restructure of the interleaved
sequencing itself. A future pass can revisit sequencing once it's
isolated.

## Non-goals

- Do not reorder or decouple the bootstrap steps (seed pool load, preferred
  artists, priority queue derivation, server snapshot fetch, discovery
  merge, priority-plan reconciliation, snapshot hydration). They stay in
  the exact current order with the exact current error handling.
- Do not move `blockedArtists`/`curatedSkips` ownership. They remain
  `rankingStore.ts`'s, per that module's own doc comment and a prior
  handoff's explicit warning not to let a candidate-selection extraction
  absorb them. This extraction only produces their one-time initial values
  during bootstrap, same as today.
- Do not introduce a `candidateStore.ts` or any get/set wrapper around
  `pool`/`priorityQueue`/`candidateArtistCooldown`/`skippedAlbums`/
  `sessionSkipped`. They stay exactly what they are today: `main.ts`
  closure locals, just initialized from `bootstrapApp()`'s result instead
  of computed inline. No downstream call site in `main.ts` changes.
- Do not touch `discovery.ts` (already a thin, clean API client),
  `bulkDiscovery.ts`, or `artistLockAlbums.ts` at all.

## Design

One new file: `web/src/bootstrap.ts`.

```ts
async function bootstrapApp(ownerId: string): Promise<BootstrapResult>
```

Moves `main.ts` lines ~135-239 verbatim: same order, same `await`s, same
try/catch degrade paths (`loadPreferredArtists` degrades to uniform
selection; `loadPriorityAlbumPlan` degrades to no-op), same
`console.warn` calls. `cachedState`/`cachedLists`/`cachedArtistLocks` are
computed inside `bootstrapApp` (via `loadRanking`/`loadLists`/
`loadArtistLocks`, the same calls `main.ts` made at this point today) and
returned, rather than passed in as parameters -- they were part of the
verbatim line range and nothing in that range actually depends on a
caller-supplied value for them, so threading them through as parameters
would have been unnecessary ceremony. This is a shipped-code correction
to this design's original sketch, which passed them in; behavior-neutral.

Returns:

```ts
interface BootstrapResult {
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
  serverLoadStatus: RankingSnapshotLoad['status']; // 'found' | 'missing' | 'error'
  snapshotBaseUpdatedAt: number | null | undefined;
}
```

`serverLoadStatus` is required, not optional: `main.ts` line ~281 still
branches on `serverLoad.status === 'missing'` well after the extraction
boundary (the pending-sync seed-up check), and `serverSnapshot` alone
(null vs non-null) can't distinguish `missing` from `error`. Caught in
the Fable review; the original draft's struct had this gap.

### `main()` after extraction

```ts
const bootstrap = await bootstrapApp(OWNER_ID);
const pool = bootstrap.pool;
let priorityQueue = bootstrap.priorityQueue;
const { preferred, playsByArtist, cachedState, cachedLists, cachedArtistLocks } = bootstrap;
const { pendingSync, blockedArtists, curatedSkips, serverSnapshot, serverLoadStatus, snapshotBaseUpdatedAt } = bootstrap;
const rankingStore = createRankingStore({ /* unchanged, uses blockedArtists/curatedSkips from bootstrap */ });
```

Everything past this point in `main()` is unchanged: `pool`,
`priorityQueue`, `candidateArtistCooldown`, `skippedAlbums`,
`sessionSkipped` stay exactly what they are today, closure locals
reassigned in place (e.g. `priorityQueue = result.queue`), just seeded
from `bootstrap.pool` / `bootstrap.priorityQueue` instead of computed
inline. Zero downstream call sites change.

## Error handling

Preserved exactly, just relocated into `bootstrapApp`. No new error
paths introduced.

## Testing

No new automated tests required by project convention (structural change,
not new behavior). Existing 358 vitest unit tests + 11 Playwright e2e
specs are the regression net, with a known gap: `web/e2e/support/mockApi.ts`
always serves `/api/ranking` as `found` with an empty priority plan, so no
e2e spec exercises the `missing` / `error` / `pendingSync` bootstrap
branches -- exactly the branches this extraction touches. Confirmed by
reading the mock harness during the Fable review.

After implementation: full suite green, then a manual smoke pass covering
three boot paths the suite doesn't: normal boot, server unreachable
(`error`), and a pending-sync reload. If the goal is to actually retire
this risk rather than accept it, one vitest covering `bootstrapApp`'s
`missing`/`error`/`pendingSync` branches would be the highest-value test
in the repo right now -- flagged here, not assumed; whether to write it is
Keith's call per the project's no-unrequested-tests convention.
