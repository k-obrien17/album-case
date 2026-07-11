# Bulk album list import ("Import a list")

## Problem

The only ways albums enter the pool today are the static seed, one-artist-at-a-time discovery, and the top-10-ranked-artists bulk discovery — all artist-catalog-driven. There's no way to hand the app an arbitrary external list (a Pitchfork "Best Albums" list, or any other curated list) and get those specific albums resolved to MusicBrainz release-groups and queued for ranking. Keith wants to paste a list of a few hundred `Artist - Album` lines and have them land as ranking candidates, in the order he gave them.

## Scope

In scope: a new "Import list" screen with a paste textarea, a new artist+title MusicBrainz search endpoint, a review step for ambiguous/failed matches, and a confirm step that persists accepted albums and appends them to the priority queue in paste order.

Out of scope (deferred, see Non-goals): scraping Pitchfork (or any site) directly, retry-later persistence for skipped/failed lines, configurable matching thresholds, importing anything other than studio albums.

## Reversibility (why this shape)

Same discipline as the bulk-artist-discovery feature this sits alongside: isolated new files, one new `ViewMode` branch and one nav button as the only touch to `main.ts`, two new API endpoints that nothing else depends on. Removing it later is: delete the new files, remove the `ViewMode` variant and its `showView` branch, remove the nav button, drop the two endpoint files. No schema migration — it reuses the existing `discovered_albums` table.

## Input parsing

New pure module, `web/src/bulkImport.ts`:

```ts
export type ParsedLine = { raw: string; artist: string; title: string };

export function parsePastedList(text: string): ParsedLine[]
```

- Split on newlines; skip blank lines.
- Strip a leading rank prefix: `/^\s*\d+[.)]\s*/`.
- Strip a trailing year suffix: `/\s*\(\d{4}\)\s*$/`.
- Split the remainder on the first occurrence of whichever separator appears earliest: ` - `, ` – ` (en dash), ` — ` (em dash), or `: `.
- No separator found → `{ raw, artist: '', title: raw }`. An empty `artist` means there's nothing to search MusicBrainz with, so the client skips the `/api/match-album` call entirely for this line and puts it straight into the review queue tagged "couldn't split artist/title" (distinct from a failed search or a low-confidence match — see Review queue) so the user can skip it or, if the app later grows a manual-entry option, fix it by hand.
- Order of the returned array is the order lines appeared in the pasted text — nothing about parsing reorders anything.

## Matching

New endpoint, `web/api/match-album.ts` (GET, no write-key — read-only, touches MusicBrainz, not Turso):

Request: `?artist=<name>&title=<name>`.

- Calls MusicBrainz release-group search: `query=artist:"<artist>" AND releasegroup:"<title>"` (quotes inside either value escaped for Lucene).
- Filters results through the existing `isLpReleaseGroup` (`_lp.ts`) — same studio-album rule every other discovery path uses.
- Returns up to 5 candidates sorted by MusicBrainz's own relevance `score`: `{ mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url, score }[]`.

Confidence, a pure client-side function (`bulkImport.ts`) so it's unit-testable without a network call:

```ts
export function isConfidentMatch(candidates: MatchCandidate[]): boolean
```

- Exactly one candidate AND its score is ≥ 90 → confident, auto-accepted.
- Zero candidates, multiple candidates, or a top score < 90 → not confident, goes to the review queue.

Client drives the search loop sequentially, one line at a time, **1000ms between calls** — deliberately more conservative than bulk-artist-discovery's 300ms. That feature makes at most 10 calls; this one can make a few hundred, which is enough volume that MusicBrainz's documented ~1 req/sec guidance for anonymous use actually matters here.

## Review queue

Screen shows two buckets as the search loop progresses:

- **Ready to import** — confident matches, running count.
- **Needs review** — one row per ambiguous/failed/unmatched line, showing the original pasted text and, when candidates exist, up to 5 selectable options (title, artist, year) plus a "Skip this line" action. A failed search (network error, MusicBrainz error response) shows a "Search failed — retry" action that re-runs just that line.

Nothing is written anywhere until the user hits **Confirm**. Skipped lines are simply dropped — no persistence, no retry-later queue (see Non-goals).

## Confirm / import

New endpoint, `web/api/import-albums.ts` (POST, write-key gated, same `requireWriteKey` as every other mutating endpoint):

Request: `{ session_id, albums: DiscoveredAlbum[] }` (same shape `discover-artist.ts` already uses).

- `ensureSchema()`, then batch-insert into `discovered_albums` with `ON CONFLICT(session_id, mbid) DO NOTHING` — identical pattern to `discover-artist.ts`'s write path, just taking an arbitrary album list instead of one artist's MusicBrainz browse result.
- Returns `{ inserted: number }` — the count of rows that were genuinely new (SQLite reports rows actually affected by the batch), not the size of the request body. This matters: the bug just shipped in bulk-artist-discovery was exactly a summary count that didn't match what actually got added, and this feature must not repeat it — the count shown to the user must reflect real insertions, not request size.

Client-side, on a successful response:

1. Filter the confirmed batch against `pool` by mbid (same `newToPool` dedup as every other discovery path) — anything already known is dropped from the local pool push, since the server already no-opped it.
2. `pool.push(...newToPool)`.
3. Append `newToPool`'s mbids to the **end** of `priorityQueue`, in the same order they were in the pasted list — not shuffled, not prepended ahead of whatever's already queued. `diversifyByArtist` (untouched, existing logic) still interleaves them by artist at selection time, both with each other and with anything already in the queue.
4. `savePriorityQueue`, `reselectCandidate()`, re-render, show a summary: `"Imported N albums. M already in your library."` (M = confirmed-but-already-known, computed the same honest way as N).

## `main.ts` wiring

- `ViewMode` gains `'bulkImport'`.
- `showView` gets one more branch: `else if (view === 'bulkImport') renderBulkImportView();` (same shape as the existing `blockedArtists`/`artistLock` branches).
- One nav button, "Import list", added in `renderNav()` next to "Fill in more albums", calling `showView('bulkImport')`.
- `renderBulkImportView()` lives in a new `web/src/ui/bulkImportView.ts` (matching `artistLockView.ts` / `savedList.ts`'s existing pattern of one file per screen), taking `pool`, `priorityQueue`, `session`, and callbacks for save/render as arguments — no new logic of its own beyond DOM wiring; all parsing/matching/confirm logic lives in `bulkImport.ts`.

## Error handling

- A failed `/api/match-album` call for one line doesn't stop the loop — it lands in the review queue with a retry action, same tolerance as bulk-artist-discovery's per-artist error handling.
- Locked writes: the Confirm step (the only write) checks this once via the existing `requireWriteKey` gate on `import-albums`; if locked, the whole confirmed batch fails together with one clear message — there's no partial-write risk since it's a single batch insert, not per-line writes.
- Empty paste, or a paste that parses to zero lines: show a status message, no API calls.

## Testing

`parsePastedList` and `isConfidentMatch` are pure → `web/src/bulkImport.test.ts` covers: rank-prefix and year-suffix stripping, each separator variant, no-separator lines falling through to unmatched, confidence threshold edges (single high-score match, tied scores, zero candidates).

The confirm-side dedup/ordering logic (append in paste order, drop already-pooled mbids, honest count) gets the same colocated-test treatment as `runBulkDiscovery`, with a fake fetch/import dependency injected rather than hitting the real endpoints.

## Removal

1. Delete `web/src/bulkImport.ts`, `web/src/bulkImport.test.ts`, `web/src/ui/bulkImportView.ts`, `web/api/match-album.ts`, `web/api/import-albums.ts`.
2. In `main.ts`: remove the `'bulkImport'` `ViewMode` variant, its `showView` branch, and the nav button.
3. No schema changes to revert — `discovered_albums` is reused as-is.

## Non-goals

- Scraping Pitchfork or any other site directly — input is always a manual paste.
- Persisting skipped or failed-and-abandoned review-queue lines for a later retry — re-paste if needed.
- Configurable confidence threshold or candidate count in the UI (hardcoded: score ≥ 90, top 5 candidates).
- Importing anything other than studio albums (the existing `isLpReleaseGroup` rule applies unchanged).
- Parallelizing match calls.
