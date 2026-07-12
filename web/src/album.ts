import type { Album, RankedAlbum } from './ranking/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseAlbum(value: unknown): Album | null {
  if (!isObject(value)) return null;
  const { mbid, title, primary_artist_name: artist, primary_artist_mbid: artistMbid } = value;
  if (typeof mbid !== 'string' || !mbid.trim()) return null;
  if (typeof title !== 'string' || typeof artist !== 'string') return null;
  if (artistMbid !== undefined && (typeof artistMbid !== 'string' || !UUID_RE.test(artistMbid))) {
    return null;
  }

  return {
    mbid,
    title,
    primary_artist_name: artist,
    ...(artistMbid ? { primary_artist_mbid: artistMbid } : {}),
    release_year: typeof value.release_year === 'number' ? value.release_year : null,
    cover_url: typeof value.cover_url === 'string' ? value.cover_url : '',
  };
}

export function parseAlbumArray(value: unknown): Album[] {
  if (!Array.isArray(value)) return [];
  const albums: Album[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const album = parseAlbum(item);
    if (!album || seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    albums.push(album);
  }
  return albums;
}

// A ranked-list entry requires a rating (the single source of truth for its
// position). Pool/list albums have no rating and must keep using parseAlbum.
export function parseRankedAlbum(value: unknown): RankedAlbum | null {
  const album = parseAlbum(value);
  if (!album) return null;
  const rating = isObject(value) ? value.rating : undefined;
  if (typeof rating !== 'number') return null;
  return { ...album, rating };
}

export function parseRankedAlbumArray(value: unknown): RankedAlbum[] {
  if (!Array.isArray(value)) return [];
  const albums: RankedAlbum[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const album = parseRankedAlbum(item);
    if (!album || seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    albums.push(album);
  }
  return albums;
}
