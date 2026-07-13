import type { Album } from './ranking/types';

/**
 * Case-insensitive substring filter over an album list, matching either the
 * title or the primary artist name. An empty or whitespace-only query returns
 * the list unchanged (search inactive).
 *
 * Generic over `T` so a `RankedAlbum[]` in yields a `RankedAlbum[]` out --
 * keeping `rating` -- rather than widening to the base `Album`.
 */
export function filterAlbums<T extends Album>(albums: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return albums;
  return albums.filter(
    (album) =>
      album.title.toLowerCase().includes(needle) ||
      album.primary_artist_name.toLowerCase().includes(needle)
  );
}
