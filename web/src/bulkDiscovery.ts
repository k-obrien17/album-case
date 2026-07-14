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
): Promise<{ priorityQueue: string[]; summary: string; found: number; locked: boolean }> {
  const artists = topRankedArtists(ranked, TOP_ARTIST_DISCOVERY_COUNT);
  if (artists.length === 0) {
    return { priorityQueue, summary: 'Rank some albums first.', found: 0, locked: false };
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
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.', found: 0, locked: true };
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

  return { priorityQueue: [...newQueue, ...priorityQueue], summary, found: foundCount, locked: false };
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

export type SimilarExpansionDeps = {
  fetchSimilar: (artistMbid: string) => Promise<SimilarArtist[] | null>; // null = that seed's fetch failed
  discover: BulkDiscoverDeps['discover'];
  onProgress?: (message: string) => void;
  delayMs?: number;
};

export async function runSimilarExpansion(
  ranked: Album[],
  pool: Album[],
  priorityQueue: string[],
  blockedNames: string[],
  deps: SimilarExpansionDeps
): Promise<{ priorityQueue: string[]; summary: string }> {
  const seeds = topRankedArtists(ranked, TOP_ARTIST_DISCOVERY_COUNT);
  if (seeds.length === 0) {
    return { priorityQueue, summary: 'Rank some albums first.' };
  }

  const delayMs = deps.delayMs ?? 300;

  // Phase 1: similar-artist lists per seed (via our edge-cached proxy).
  const seedLists: SimilarArtist[][] = [];
  let seedFailures = 0;
  for (let i = 0; i < seeds.length; i++) {
    deps.onProgress?.(`Finding similar artists (${i + 1}/${seeds.length})…`);
    const list = await deps.fetchSimilar(seeds[i].mbid);
    if (list === null) seedFailures++;
    else seedLists.push(list);
    if (i < seeds.length - 1) await delay(delayMs);
  }
  if (seedFailures === seeds.length) {
    return { priorityQueue, summary: 'Couldn\'t reach ListenBrainz — try again.' };
  }

  // Artists already represented anywhere in the library are not "new".
  const represented = new Set<string>();
  for (const a of [...ranked, ...pool]) {
    if (a.primary_artist_mbid) represented.add(a.primary_artist_mbid);
  }

  const targets = rankSimilarArtists(seedLists, represented, blockedNames, SIMILAR_ARTISTS_PER_RUN);
  if (targets.length === 0) {
    return { priorityQueue, summary: 'No new similar artists found.' };
  }

  // Phase 2: pull each new artist's studio LPs -- same shape as runBulkDiscovery.
  const newQueue: string[] = [];
  const succeeded: string[] = [];
  let foundCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const artist = targets[i];
    deps.onProgress?.(`Discovering ${artist.name} (${i + 1}/${targets.length})…`);
    const knownMbids = pool
      .filter((a) => a.primary_artist_mbid === artist.mbid)
      .map((a) => a.mbid);
    const result = await deps.discover(artist.name, artist.mbid, knownMbids);

    if (result.status === 'locked') {
      return { priorityQueue, summary: 'Unlock writes to fill in more albums.' };
    } else if (result.status === 'error') {
      errorCount++;
    } else if (result.status === 'found') {
      const poolIds = new Set(pool.map((a) => a.mbid));
      const newToPool = result.albums.filter((a) => !poolIds.has(a.mbid));
      pool.push(...newToPool);
      newQueue.push(...result.albums.map((a) => a.mbid));
      foundCount += newToPool.length;
      if (newToPool.length > 0) succeeded.push(artist.name);
    }
    if (i < targets.length - 1) await delay(delayMs);
  }

  let summary = `Added ${foundCount} albums from ${succeeded.length} similar artists`;
  summary += succeeded.length > 0 ? `: ${succeeded.join(', ')}.` : '.';
  if (errorCount > 0) summary += ` ${errorCount} failed.`;

  return { priorityQueue: [...newQueue, ...priorityQueue], summary };
}
