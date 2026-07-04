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
 * Every album still available to place: not already in `ranked` and not set
 * aside into a saved list (`excluded`).
 */
export function eligibleCandidates(
  pool: Album[],
  ranked: Album[],
  excluded: Set<string> = new Set()
): Album[] {
  const rankedIds = new Set(ranked.map((album) => album.mbid));
  return pool.filter((album) => !rankedIds.has(album.mbid) && !excluded.has(album.mbid));
}

/**
 * Pick the next candidate to place: a RANDOM eligible album, not the first in
 * pool order. The seed is editorially ordered (classic-rock canon first), so
 * walking it in order made every candidate look like the same era -- random
 * selection spreads candidates across the catalog.
 *
 * `rng` is injectable (defaults to `Math.random`) so tests can assert a
 * specific, non-first eligible album is returned. Returns `null` when nothing
 * is left to place.
 */
export function pickCandidate(
  pool: Album[],
  ranked: Album[],
  excluded: Set<string> = new Set(),
  rng: () => number = Math.random
): Album | null {
  const eligible = eligibleCandidates(pool, ranked, excluded);
  if (eligible.length === 0) return null;
  const index = Math.min(Math.floor(rng() * eligible.length), eligible.length - 1);
  return eligible[index];
}
