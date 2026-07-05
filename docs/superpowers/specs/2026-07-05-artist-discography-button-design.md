# Artist discography button ("rank rest of their albums")

## Problem

The ranked list only ever offers albums from the curated 115-album seed. When a player wants to rank the rest of an artist's catalog (LPs the seed doesn't happen to include), there's no way to pull them in — the seed is a closed, curated pool.

## Scope

In scope: a per-row button that discovers an artist's other studio albums (LPs) via MusicBrainz, persists them, and queues them as the next candidates.

Out of scope: any UI beyond a single button + inline empty-state message; disambiguation UI for ambiguous artist names; retry/backoff logic for MusicBrainz failures.

## Architecture deviation (deliberate)

`DATA-SOURCES.md` states the running app should query only its own materialized universe, never a live vendor catalog ("Don't ingest stored data from live APIs. Use bulk dumps"). This feature is a deliberate, acknowledged exception: it makes one live MusicBrainz call server-side, on user action. This project has already pragmatically diverged from its original anonymous-public-product architecture into a personal single-user tool (see `HANDOFF.md` open questions); this is consistent with that reality, not a new problem. `build-seed.py`'s own docstring already frames its live MusicBrainz fetching as a "TEMPORARY BOOTSTRAP" — this feature follows the same pattern, just on-demand instead of offline.

## "LP" definition

MusicBrainz release-group with `primary-type: Album` and no `secondary-types` (excludes Compilation/Live/Remix/Soundtrack/etc.) — the identical rule `build-seed.py` already applies when resolving the curated seed (see `_fetch_release_group`'s preference for entries with no secondary types).

## Discovery mechanics

No artist MBID is stored today (`Album` only has `primary_artist_name`), and touching the existing seed schema to backfill it was rejected as unnecessary — resolved live instead, per click:
1. MusicBrainz artist search by name → take the top-scored match's MBID. (Known limitation: generic/ambiguous artist names may resolve to the wrong real-world artist. No disambiguation UI; acceptable for a single-user tool.)
2. Browse release-groups for that artist MBID, filtered to the LP definition above.

Both calls are server-side, inside the new endpoint (see below) — never from the browser directly.

## Persistence

New Turso table, mirroring `ranking_snapshots`' full-record-per-owner approach so the app doesn't need the seed to resolve these albums later, and so they work cross-device:

```sql
CREATE TABLE discovered_albums (
  owner_id TEXT NOT NULL,
  mbid TEXT NOT NULL,
  title TEXT NOT NULL,
  primary_artist_name TEXT NOT NULL,
  release_year INTEGER,
  cover_url TEXT NOT NULL,
  discovered_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, mbid)
);
```

`discovered_at` in milliseconds, per project convention.

At app startup, the client merges the static seed pool with everything in `discovered_albums` for the owner into one in-memory `pool: Album[]`. From that point on a discovered album is indistinguishable from a seed album to the rest of the app (priority queue, candidate picking, rendering).

## API endpoint

New `web/api/discover-artist.ts`.

**Request:** `{ artistName: string, knownMbids: string[] }` — every mbid the client already has for that artist (seed pool + already-ranked + already-discovered), so the server can dedupe in one round trip.

**Flow:**
1. Query `discovered_albums` for this owner + artist name → previously-discovered-but-still-unranked candidates (no MusicBrainz call needed for this part).
2. Resolve artist MBID, browse release-groups (LP filter), drop anything already in `knownMbids`.
3. Write the net-new records from step 2 into `discovered_albums`.
4. Return (previously-discovered-unranked) ∪ (newly-discovered-this-click) — because the button means "surface everything I haven't ranked yet by this artist," not just "what's new since last click."

One endpoint, not split into separate discover/persist calls — the extra round trip buys nothing here.

## Client integration

- `loadSeedPool()` gets a sibling `loadDiscoveredAlbums()` Turso fetch at startup; both merge into `pool` before candidate selection runs.
- Button on every ranked row, next to the artist context (same area as the artist/year rank badges from the companion spec). Label: "▶ Rank rest".
- On click: call `discover-artist` with the row's `primary_artist_name` + known mbids for that artist. Merge returned records into `pool`. Prepend their mbids to the front of `priorityQueue` (existing `savePriorityQueue`), then immediately re-run candidate selection so the very next candidate shown is one of them.
- Empty response (nothing new, nothing previously-discovered-and-unranked): show a brief inline message on click. The button is never pre-emptively hidden, since there's no way to know there's nothing left without asking.

## Atom-allowlist extension

`/api/atom` currently gates on the static `_allowlist.json` built at seed time. Extending it: an mbid is allowed if it's in `_allowlist.json` **or** in `discovered_albums` for the current owner (one extra Turso lookup). Decided over the "skip atom recording for discovered albums" alternative — the alternative is a silent, growing gap (comparisons work fine in the UI but quietly stop generating atoms), which undermines the project's aggregate-data positioning as discovery becomes a normal way to add albums.

## Edge cases

- Artist-name ambiguity: see Discovery mechanics above.
- MusicBrainz errors/timeouts: caught, shown as a lightweight inline message; no retry loop (user can just click again).
- Fully-ranked artist: empty response → the "nothing found" message above.
- Null `release_year` from MusicBrainz: already handled defensively by the companion rank-badges feature; no new handling needed here.

## Testing

The endpoint itself is I/O (MusicBrainz + Turso), not pure logic, so per this project's existing pattern (pure modules get colocated tests; I/O glue doesn't), two pieces are extracted into a small pure, tested helper:
- "does this release-group qualify as an LP" (the primary-type/secondary-types check)
- "merge previously-discovered ∪ newly-discovered, deduped by mbid"

The handler itself stays thin and is not exercised by unit tests, matching how the live-fetching parts of `build-seed.py` are handled today (only the pure `pipeline/covers.py` piece has `test_covers.py`; the network-calling parts of `build-seed.py` don't have equivalent unit coverage).

## Non-goals

- Any change to the badges feature's data model beyond sharing row real estate for the button.
- Retry/backoff for MusicBrainz failures.
- Disambiguation UI for ambiguous artist name matches.
- Any change to how already-ranked albums are displayed or stored.
