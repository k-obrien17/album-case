import type { Album } from './ranking/types';
import type { SavedLists } from './lists';

export type ArtistLockAlbums<T extends Album = Album> = {
  /** This artist's albums currently in the global ranked list, in current
   *  relative order. */
  ranked: T[];
  /** This artist's albums not yet in the global ranked list: saved-list
   *  entries plus still-a-bare-candidate pool entries, de-duped. */
  unranked: Album[];
};

/** Group one artist's known albums into ranked/unranked, for the
 *  artist-scoped lock view. `pool` is the full candidate pool (already
 *  includes discovered albums by the time this is called). Generic over `T`
 *  so a `RankedAlbum[]` input keeps its `rating` in the returned `ranked`
 *  array instead of widening to plain `Album`. */
export function artistAlbumsFor<T extends Album>(
  artistMbid: string,
  ranked: T[],
  lists: SavedLists,
  pool: Album[]
): ArtistLockAlbums<T> {
  const byArtist = (album: Album) => album.primary_artist_mbid === artistMbid;

  const rankedAlbums = ranked.filter(byArtist);
  const rankedIds = new Set(rankedAlbums.map((a) => a.mbid));

  const savedAlbums = [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare].filter(byArtist);
  const poolAlbums = pool.filter(byArtist);

  const seen = new Set<string>();
  const unranked: Album[] = [];
  for (const album of [...savedAlbums, ...poolAlbums]) {
    if (rankedIds.has(album.mbid) || seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    unranked.push(album);
  }

  return { ranked: rankedAlbums, unranked };
}

/**
 * Translate a reorder expressed in the artist-filtered sub-list's own index
 * space (`filteredFrom`/`filteredTo`, matching `RankListOptions.onReorder`
 * semantics: `to` is interpreted post-removal) into the equivalent
 * `{ from, to }` against the full global `ranked` array. Returns `null` if
 * `filteredFrom` doesn't land on one of this artist's rows.
 */
export function mapFilteredReorderToGlobal(
  ranked: Album[],
  artistMbid: string,
  filteredFrom: number,
  filteredTo: number
): { from: number; to: number } | null {
  const byArtist = (album: Album) => album.primary_artist_mbid === artistMbid;
  const filteredGlobalIndices = ranked
    .map((album, i) => ({ album, i }))
    .filter(({ album }) => byArtist(album))
    .map(({ i }) => i);

  if (filteredFrom < 0 || filteredFrom >= filteredGlobalIndices.length) return null;
  const from = filteredGlobalIndices[filteredFrom];

  const withoutMoved = ranked.filter((_, i) => i !== from);
  const remainingFilteredIndices = withoutMoved
    .map((album, i) => ({ album, i }))
    .filter(({ album }) => byArtist(album))
    .map(({ i }) => i);

  const clampedTo = Math.max(0, Math.min(filteredTo, remainingFilteredIndices.length));
  const to =
    clampedTo < remainingFilteredIndices.length
      ? remainingFilteredIndices[clampedTo]
      : remainingFilteredIndices.length > 0
        ? remainingFilteredIndices[remainingFilteredIndices.length - 1] + 1
        : withoutMoved.length;

  return { from, to };
}
