import type { Album } from './ranking/types';
import type { DiscoverArtistResult } from './discovery';

export const TOP_ARTIST_DISCOVERY_COUNT = 10;

export function topRankedArtists(
  ranked: Album[],
  n: number
): { mbid: string; name: string }[] {
  const seen = new Set<string>();
  const out: { mbid: string; name: string }[] = [];
  for (const album of ranked) {
    if (out.length >= n) break;
    const mbid = album.primary_artist_mbid;
    if (!mbid || seen.has(mbid)) continue;
    seen.add(mbid);
    out.push({ mbid, name: album.primary_artist_name });
  }
  return out;
}

export type BulkDiscoverDeps = {
  discover: (
    artistName: string,
    artistMbid: string,
    knownMbids: string[]
  ) => Promise<DiscoverArtistResult>;
  onProgress?: (message: string) => void;
  delayMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBulkDiscovery(
  ranked: Album[],
  pool: Album[],
  priorityQueue: string[],
  deps: BulkDiscoverDeps
): Promise<{ priorityQueue: string[]; summary: string }> {
  const artists = topRankedArtists(ranked, TOP_ARTIST_DISCOVERY_COUNT);
  if (artists.length === 0) {
    return { priorityQueue, summary: 'Rank some albums first.' };
  }

  const delayMs = deps.delayMs ?? 300;
  const newQueue: string[] = [];
  let foundCount = 0;
  let emptyCount = 0;
  let errorCount = 0;

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    deps.onProgress?.(`Discovering ${i + 1}/${artists.length} artists…`);

    const knownMbids = pool
      .filter((a) => a.primary_artist_mbid === artist.mbid)
      .map((a) => a.mbid);
    const result = await deps.discover(artist.name, artist.mbid, knownMbids);

    if (result.status === 'locked') {
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.' };
    } else if (result.status === 'error') {
      errorCount++;
    } else if (result.status === 'empty') {
      emptyCount++;
    } else {
      const poolIds = new Set(pool.map((a) => a.mbid));
      const newToPool = result.albums.filter((a) => !poolIds.has(a.mbid));
      pool.push(...newToPool);
      newQueue.push(...result.albums.map((a) => a.mbid));
      foundCount += newToPool.length;
    }

    if (i < artists.length - 1) await delay(delayMs);
  }

  let summary = `Added ${foundCount} new albums from ${artists.length} artists.`;
  if (emptyCount > 0 || errorCount > 0) {
    summary += ` ${emptyCount} already fully discovered, ${errorCount} failed.`;
  }

  return { priorityQueue: [...newQueue, ...priorityQueue], summary };
}

export const SIMILAR_ARTISTS_PER_RUN = 5;

export type SimilarArtist = { mbid: string; name: string; score: number };

/**
 * Aggregate per-seed similar-artist lists into one ranked shortlist.
 *
 * Scores are normalized per seed list (divided by that list's max) before
 * summing, so one seed's larger raw score scale can't dominate -- and an
 * artist similar to SEVERAL of the owner's top artists outranks one similar
 * to just one. Artists already represented in the library (by mbid) or
 * blocked (by name, case-insensitive) are excluded before the top-n cut.
 */
export function rankSimilarArtists(
  seedLists: SimilarArtist[][],
  excludedArtistMbids: Set<string>,
  blockedNames: string[],
  n: number
): { mbid: string; name: string }[] {
  const blocked = new Set(blockedNames.map((name) => name.trim().toLowerCase()));
  const totals = new Map<string, { name: string; total: number }>();

  for (const list of seedLists) {
    if (list.length === 0) continue;
    const max = Math.max(...list.map((a) => a.score));
    if (max <= 0) continue;
    for (const artist of list) {
      const entry = totals.get(artist.mbid) ?? { name: artist.name, total: 0 };
      entry.total += artist.score / max;
      totals.set(artist.mbid, entry);
    }
  }

  return [...totals.entries()]
    .filter(
      ([mbid, { name }]) =>
        !excludedArtistMbids.has(mbid) && !blocked.has(name.trim().toLowerCase())
    )
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, n)
    .map(([mbid, { name }]) => ({ mbid, name }));
}
