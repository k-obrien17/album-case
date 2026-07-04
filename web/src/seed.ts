import type { Album } from './ranking/types';

let cachedPool: Album[] | null = null;

/**
 * Fetch the curated MVP seed pool from `/seed/albums.json` (see
 * web/public/seed/albums.json). Fetched once and cached in memory for the
 * lifetime of the page; the seed is a static asset shipped with the build.
 */
export async function loadSeedPool(): Promise<Album[]> {
  if (cachedPool) return cachedPool;

  const response = await fetch('/seed/albums.json');
  if (!response.ok) {
    throw new Error(`loadSeedPool: failed to fetch /seed/albums.json (${response.status})`);
  }

  const albums = (await response.json()) as Album[];
  cachedPool = albums;
  return albums;
}

/**
 * The next candidate to insert into the ranked list: the first album in
 * `pool` that is neither already placed in `ranked` nor the album currently
 * mid-placement (`pendingMbid`). Returns `null` once every album in the
 * pool is either ranked or pending -- there is nothing left to bootstrap.
 */
export function nextUnrankedCandidate(
  pool: Album[],
  ranked: Album[],
  pendingMbid: string | null
): Album | null {
  const rankedIds = new Set(ranked.map((album) => album.mbid));

  for (const album of pool) {
    if (rankedIds.has(album.mbid)) continue;
    if (album.mbid === pendingMbid) continue;
    return album;
  }

  return null;
}
