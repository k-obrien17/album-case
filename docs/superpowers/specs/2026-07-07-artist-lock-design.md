# Artist lock: freeze one artist's internal order

## Problem

The global ranked list is a single total order, built one binary-insertion
placement at a time. For an artist with several albums scattered across the
list, there's no way to say "I'm confident `OK Computer` beats `Kid A` beats
`In Rainbows`, full stop" and have the app hold that sub-order steady while
the rest of the list keeps changing around it. Add a per-artist lock: rank an
artist's albums against each other in isolation, freeze that relative order,
and have the global list refuse any drag that would violate it.

## Scope

In scope: locking/unlocking one artist's relative album order; a scoped
drag-to-place view for ranking that artist's albums (ranked and unranked);
live drag-blocking against every active lock in the global list.

Out of scope (not requested): multiple simultaneous partial-lock "groups"
per artist, locks that span multiple artists, editing a locked order without
first unlocking, any change to the binary-insertion candidate flow itself.

## Approved answers (from prior session)

- **Album scope in a batch session:** all of the artist's albums — already
  ranked, in `wantToListen`/`notHeard`/`dontCare`, or not yet discovered at
  all.
- **Placing unranked albums:** reuse the existing "#/Place" rank-number
  input (`buildNumberPlace` in `web/src/ui/rankList.ts:299`) — no new
  insertion wizard.
- **Sub-ranking mechanic:** drag-to-place, scoped to just that artist's
  albums — same interaction as the main list, filtered.
- **Entry point:** a new icon on each ranked row, alongside the existing ▶
  (discover, `rankList.ts:270`) and ⇅ (reorder, `rankList.ts:279`) icons.
- **Enforcement UX:** invalid drop zones are unavailable during the drag
  itself, not flagged after the fact.
- **Editability:** unlock → re-batch → re-lock only. No live editing of a
  locked order in place.
- **Lock scope:** a lock covers only the albums that were in the global
  ranked list *at the moment Lock was pressed*. Albums placed later are
  unconstrained until the artist is re-locked. Confirmed.

## Data model

New type in `web/src/ranking/types.ts`, alongside `Album`/`RankingState`:

```ts
export type ArtistLock = {
  artistMbid: string;
  order: string[]; // album mbids, locked relative order, index 0 = most preferred
};
```

**Correction after cross-checking the code (during planning):** `artistLocks`
does **not** live on `RankingState`. That type is threaded through
`insertion.ts`, `assist.ts`, and `backup.ts` — none of which have anything to
do with locks — so nesting it there would force every one of those unrelated
modules (and their tests) to carry a field they never use. Instead
`artistLocks: ArtistLock[]` is a third top-level piece of app state in
`main.ts`, a sibling to `state` (`RankingState`) and `lists` (`SavedLists`),
persisted the same way `lists.ts` persists `SavedLists`: a new
`web/src/artistLocksStorage.ts` with `loadArtistLocks`/`saveArtistLocks`
against its own `localStorage` key, mirroring `lists.ts` line for line. This
is a smaller, better-isolated change than the original plan and needs no
edits to `RankingState`, `insertion.ts`, `assist.ts`, `backup.ts`,
`storage.ts`, `order.ts`, or `setAside.ts`.

Server-side, `web/src/rankingSync.ts` and `web/api/ranking.ts` add a third
sibling to `ranked`/`lists` in the snapshot payload and response, keyed the
same way (`artist_locks_json`, mirroring `ranking_json`/`lists_json`). This
reuses the existing save/retry/version-conflict machinery in
`saveRankingSnapshot`/`loadRankingSnapshotDetailed` untouched — the shapes
just grow one field.

`web/api/_schema.js`'s `CREATE_RANKING_SNAPSHOTS_TABLE` predates this
feature, so `ranking_snapshots` needs a new nullable column. `ensureSchema()`
in `api/ranking.ts` follows the exact idempotent pattern
`discover-artist.ts:38` already uses for `discovered_albums.primary_artist_mbid`:

```ts
try {
  await client.execute('ALTER TABLE ranking_snapshots ADD COLUMN artist_locks_json TEXT');
} catch {
  // Existing deployments may already have this column.
}
```

A `NULL`/missing value reads back as `[]` (no locks), matching how
`lists_json`'s missing `dontCare` bucket already degrades to `[]` in
`loadRankingSnapshotDetailed`.

## Enforcement

New pure module `web/src/ranking/locks.ts` (colocated `locks.test.ts`),
matching the existing single-purpose modules under `web/src/ranking/`
(`order.ts`, `insertion.ts`, `setAside.ts`, `subRank.ts`):

```ts
/** True if `ranked`'s relative order satisfies every lock. */
export function isValidOrder(ranked: Album[], locks: ArtistLock[]): boolean

/** True if moving `from` to `to` would break any lock. */
export function wouldViolateLock(
  ranked: Album[],
  locks: ArtistLock[],
  from: number,
  to: number
): boolean
```

`isValidOrder` filters `ranked` down to each lock's mbids (preserving
`ranked`'s current order) and checks it equals `lock.order`.
`wouldViolateLock` simulates the move with the existing `moveItem` (from
`order.ts`) and re-checks `isValidOrder` against the result.

**Only reordering can violate a lock — insertion never can.** `insertAt`
(`order.ts:18`) only shifts other items' absolute indices when a new
candidate is placed; it never changes any two existing items' order relative
to each other, so the binary-insertion candidate flow and its "#/Place"
input need no lock-awareness at all. The only pathway that can violate a
lock is `onReorder` (`main.ts:453`, fed by drag-and-drop in `rankList.ts`) —
including drags inside the artist-scoped view, since that view drags the
real global-list items, just filtered. This is a smaller enforcement surface
than originally scoped and simplifies the UI wiring: only the drag path
needs a live check.

**Live drop-zone blocking:** `rankList.ts`'s drag loop already tracks a
`dropIndex` via `computeDropIndex`/`showIndicatorAt` (`rankList.ts:112-131`).
During a drag, each candidate `dropIndex` is checked with
`wouldViolateLock(ranked, locks, from, dropIndex)` before the drop
indicator renders there; an invalid index is skipped in favor of the
nearest valid one on either side. `locks` reaches `rankList.ts` the same way
`ranked` already does today, via `opts.getRanked()`-style accessor passed
in from `main.ts`.

## UI flow

**Entry point:** a new button on each `rank-row`, next to the ▶ discover
button and ⇅ grip (`buildRow`, `rankList.ts:252`). Unlocked artists show a
"lock" glyph; artists with an active lock show a distinct "locked" state.
Both use a plain-Unicode glyph (not emoji), matching the existing ▶/⇅
convention — final glyph choice is a small implementation detail, not a
design blocker.

**Scoped view:** clicking the icon opens a filtered view — same drag-to-place
list component, filtered to one `primary_artist_mbid`. Two groups:

- **Already ranked** albums by this artist: real rows into the real global
  list (filtered). Dragging here calls the same `onReorder`, so the global
  list updates live, gated by the same lock-violation check as the main
  view (relevant only for *other* artists' locks, since this artist isn't
  locked yet or is being re-batched).
- **Not yet ranked** (in `wantToListen`/`notHeard`/`dontCare`, or fully
  undiscovered): each gets the existing "#/Place" control. Opening the
  scoped view triggers the same discovery call `discoverArtistDetailed`
  already makes from the ▶ button (`main.ts:387`), so fully-undiscovered
  albums surface here too, per the "ALL of the artist's albums" scope
  decision.

**Lock in order:** a button that reads the artist's current positions out of
`state.ranked` (in current relative order) and writes a new `ArtistLock` —
this is the only place `ArtistLock.order` gets written or overwritten.

**Unlock:** removes that artist's `ArtistLock` entirely. No partial edits;
re-locking always captures a fresh snapshot of the current order.

**Handler placement:** `main.ts` is already 622 lines and `rankList.ts` is
already 509 — both over this project's 300-line file guideline before this
feature. The scoped-view UI goes in a new `web/src/ui/artistLockView.ts`, and
every piece of pure logic (lock validity, album grouping, lock
construction) goes in dedicated pure modules rather than `main.ts`. The thin
DOM-event handlers that close over `state`/`lists`/`pool` stay in `main.ts`,
same shape as the existing `handleDiscoverArtist`/`handleBlockArtist` —
every other feature in this codebase wires handlers there, so splitting just
this one out would be the inconsistent choice, not the consistent one.
Exact file boundaries are finalized in the implementation plan.

## Edge cases

- **Artist has one ranked album:** locking is a no-op (`order` has one
  entry); `isValidOrder` trivially passes. No UI restriction needed — locking
  a single album is harmless, not blocked.
- **Locked artist's album gets set aside** (Haven't heard / Want to listen /
  Don't care, via the existing `onSetAside` in `main.ts:458`): that album
  leaves `state.ranked`, so it drops out of the lock's *enforced* set (only
  `ranked` overlap is checked), but stays in `lock.order` as inert data. Set
  it aside, then unlock and re-batch to clean up the stale entry — no
  automatic pruning, avoids surprising the owner by silently rewriting a
  lock they set deliberately.
- **Two locks on artists whose albums interleave in the global list:**
  independent per-artist checks in `isValidOrder` — as long as each lock's
  own mbids stay in their own relative order, interleaving with other
  artists' albums is unrestricted.
- **Stale lock referencing a deleted/renamed album:** can't happen — albums
  are identified by immutable MusicBrainz `mbid`, and nothing in this app
  deletes an album record once ranked.

## Testing

- `web/src/ranking/locks.test.ts`: `isValidOrder` (satisfied / violated /
  no-op for albums outside `ranked`), `wouldViolateLock` for reorders that
  do and don't cross a locked pair.
- `web/src/artistLock.test.ts`: lock captures current relative order; unlock
  clears it; set-aside during an active lock leaves `lock.order` untouched.
- `web/api/ranking.test.ts`: new coverage for `artist_locks_json` round-trip
  (save → load), and that a payload with `artistLocks` omitted degrades to
  `[]` (older client / pre-migration row).

## Non-goals

- Cross-artist locks or lock "groups."
- Automatic pruning of a lock when a locked album is set aside.
- Any change to the binary-insertion candidate flow, `insertAt`, or the
  discover-artist MusicBrainz lookup itself.
