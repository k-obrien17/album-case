import type { Album } from './ranking/types';

function asAlbumArray(value: unknown): Album[] {
  return Array.isArray(value) ? (value as Album[]) : [];
}

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
    return asAlbumArray(body.albums);
  } catch {
    return [];
  }
}

export async function discoverArtist(
  sessionId: string,
  artistName: string,
  knownMbids: string[]
): Promise<Album[]> {
  let response: Response;
  try {
    response = await fetch('/api/discover-artist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        artist_name: artistName,
        known_mbids: knownMbids,
      }),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  try {
    const body = (await response.json()) as { albums?: unknown };
    return asAlbumArray(body.albums);
  } catch {
    return [];
  }
}
