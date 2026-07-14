# EP support in free-text search

## Problem

`isLpReleaseGroup` (`web/api/_lp.ts`) requires `primary-type === 'Album'`, so an
EP like the Pixies' *Come On Pilgrim* can never appear in `/api/search-album`
results, even though the search route already has full MusicBrainz type data
in hand before filtering it away.

## Scope

In scope: the free-text search route (`web/api/search-album.ts`) admits clean
EPs alongside clean albums.

Out of scope: artist-MBID bulk discovery (`web/api/discover-artist.ts`) stays
LP-only, unchanged. No visual distinction between EPs and albums once added.
No schema, type, or migration changes. `canon-import.mjs`, `build-seed.py`,
and `_lp.test.ts`'s existing coverage of `isLpReleaseGroup` are untouched.

## Change 1: new predicate in `web/api/_lp.ts`

Add `isAlbumOrEpReleaseGroup(group)` alongside the existing
`isLpReleaseGroup`, which is left as-is:

```ts
export function isAlbumOrEpReleaseGroup(group: ReleaseGroup): boolean {
  const type = group['primary-type'];
  return (type === 'Album' || type === 'EP') && (group['secondary-types']?.length ?? 0) === 0;
}
```

Same secondary-types rule as the LP predicate (must be empty), so a "Live EP"
or "Remix EP" is still excluded. Only the primary-type check widens.

## Change 2: `web/api/search-album.ts:80`

Swap the filter call from `isLpReleaseGroup` to `isAlbumOrEpReleaseGroup`.
Nothing else in the file changes: no MusicBrainz query params to touch, since
free-text search never restricted by type at the network level.

## Result shape

Unchanged. A returned EP is `{ mbid, title, primary_artist_name,
primary_artist_mbid, release_year, cover_url }` — identical shape to an
album, and flows through `insertAtRating` and the ranking snapshot exactly
like any other searched album (per the existing search-and-bulk-add design).

## Testing

Extend `_lp.test.ts` with cases for `isAlbumOrEpReleaseGroup`:
- clean EP (`primary-type: 'EP'`, no secondary types) → true
- EP with a secondary type (e.g. `['Live']`) → false
- clean Album → still true (no regression)
- other primary types (Single, Compilation, Broadcast) → false

## Non-goals

- Any change to `discover-artist.ts` or bulk/similar-artist discovery tiers.
- Visual EP badge or any UI distinction.
- Schema/type changes to `discovered_albums`, `Album`, `RankedAlbum`, or
  `DiscoveredAlbum`.
