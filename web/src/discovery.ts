import type { Album } from './ranking/types';
import { getWriteKey, writeKeyHeaders } from './writeKey';
import { parseAlbumArray } from './album';

export type DiscoverArtistResult =
  | { status: 'found'; albums: Album[] }
  | { status: 'empty' }
  | { status: 'locked' }
  | { status: 'error' };

export async function loadDiscoveredAlbums(sessionId: string): Promise<Album[]> {
  let response: Response;
  try {
    response = await fetch(`/api/discover-artist?session_id=${encodeURIComponent(sessionId)}`);
  } catch {
    return [];
  }
  if (!response.ok) return [];

  try {
    const body = (await response.json()) as { albums?: unknown };
    return parseAlbumArray(body.albums);
  } catch {
    return [];
  }
}

export async function discoverArtistDetailed(
  sessionId: string,
  artistName: string,
  artistMbid: string,
  knownMbids: string[]
): Promise<DiscoverArtistResult> {
  if (!getWriteKey()) return { status: 'locked' };

  let response: Response;
  try {
    response = await fetch('/api/discover-artist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...writeKeyHeaders() },
      body: JSON.stringify({
        session_id: sessionId,
        artist_name: artistName,
        artist_mbid: artistMbid,
        known_mbids: knownMbids,
      }),
    });
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };

  try {
    const body = (await response.json()) as { albums?: unknown };
    const albums = parseAlbumArray(body.albums);
    return albums.length > 0 ? { status: 'found', albums } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}

export async function discoverArtist(
  sessionId: string,
  artistName: string,
  artistMbid: string,
  knownMbids: string[]
): Promise<Album[]> {
  const result = await discoverArtistDetailed(sessionId, artistName, artistMbid, knownMbids);
  return result.status === 'found' ? result.albums : [];
}
