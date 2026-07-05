import type { Album } from './ranking/types';
import { artistKeys } from './priority';

let cachedPool: Album[] | null = null;

/** One entry of Keith's play-count ranking (web/public/seed/preferred-artists.json). */
export type ArtistPlays = { rank: number; artist: string; plays: number; hours: number };
type PreferredArtists = { by_plays: ArtistPlays[] };

let cachedPreferred: ArtistPlays[] | null = null;

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
 * Fetch Keith's play-weighted artist list (`by_plays`) from
 * `/seed/preferred-artists.json`. Ordered highest-plays first; fetched once
 * and cached, mirroring `loadSeedPool`. Callers degrade gracefully (uniform
 * selection) if this fails, so it is loaded with a try/catch upstream.
 */
export async function loadPreferredArtists(): Promise<ArtistPlays[]> {
  if (cachedPreferred) return cachedPreferred;

  const response = await fetch('/seed/preferred-artists.json');
  if (!response.ok) {
    throw new Error(
      `loadPreferredArtists: failed to fetch /seed/preferred-artists.json (${response.status})`
    );
  }

  const data = (await response.json()) as PreferredArtists;
  cachedPreferred = data.by_plays ?? [];
  return cachedPreferred;
}

/**
 * Normalized-artist-key -> play-count map, slash-aware so a joint credit
 * ("Genius/GZA") resolves to the same plays as its listed member ("GZA").
 */
export function playsMapFromPreferred(list: ArtistPlays[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const { artist, plays } of list) {
    for (const key of artistKeys(artist)) {
      map.set(key, Math.max(map.get(key) ?? 0, plays));
    }
  }
  return map;
}

/** Selection weight for an album: the plays of its primary artist, 0 if unlisted. */
function artistWeight(album: Album, playsByArtist: Map<string, number>): number {
  let best = 0;
  for (const key of artistKeys(album.primary_artist_name)) {
    const plays = playsByArtist.get(key);
    if (plays != null && plays > best) best = plays;
  }
  return best;
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
 * Pick the next candidate to place: a play-WEIGHTED random eligible album.
 * Each album's draw weight is its primary artist's play count (from
 * `playsByArtist`), with a floor of 1 for unlisted artists so the whole
 * catalog stays reachable. This makes the loop feel like Keith's music --
 * his most-played artists surface far more often than generic canon -- while
 * still spreading across the catalog. With an empty `playsByArtist` every
 * weight is the floor, i.e. uniform random.
 *
 * `rng` is injectable (defaults to `Math.random`) so tests can assert a
 * specific eligible album is returned. Returns `null` when nothing is left.
 */
export function pickCandidate(
  pool: Album[],
  ranked: Album[],
  excluded: Set<string> = new Set(),
  rng: () => number = Math.random,
  playsByArtist: Map<string, number> = new Map()
): Album | null {
  const eligible = eligibleCandidates(pool, ranked, excluded);
  if (eligible.length === 0) return null;

  const weights = eligible.map((album) => Math.max(1, artistWeight(album, playsByArtist)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = rng() * total;
  for (let i = 0; i < eligible.length; i += 1) {
    target -= weights[i];
    if (target < 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}
