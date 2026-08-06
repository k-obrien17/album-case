import type { RankedAlbum } from './ranking/types';
import type { CuratedAlbumEntry } from './data/curatedLists';

// Loose text match (case/punctuation/leading-"the"-insensitive): curated
// list entries carry no mbid (see curatedLists.ts's header comment), so
// this is the only way to check them against the owner's ranked list.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the /, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function key(artist: string, title: string): string {
  return `${normalize(artist)}|${normalize(title)}`;
}

/** Curated list entries whose artist+title doesn't match anything in
 *  `ranked`, in the list's original rank order. */
export function unrankedFromCuratedList(
  albums: CuratedAlbumEntry[],
  ranked: RankedAlbum[]
): CuratedAlbumEntry[] {
  const rankedKeys = new Set(ranked.map((a) => key(a.primary_artist_name, a.title)));
  return albums.filter((a) => !rankedKeys.has(key(a.artist, a.title)));
}
