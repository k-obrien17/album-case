import type { Album } from './ranking/types';
import type { PriorityAlbumPlanEntry, PriorityAlbumReviewStatus } from './seed';

const PRIORITY_KEY = 'tastetest-priority-queue';
const PRIORITY_PLAN_VERSION_KEY = 'albumcase-priority-plan-version';

let memoryQueue: string[] = [];

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalized match keys for an artist credit. Slash-credits are split so a
 * name that MusicBrainz records jointly still matches either member: e.g.
 * "Genius/GZA" yields ["genius gza", "genius", "gza"], so a preferred-artist
 * list that only says "GZA" still lines up with the credited album.
 */
export function artistKeys(name: string): string[] {
  const keys = new Set<string>();
  const full = normalize(name);
  if (full) keys.add(full);
  for (const part of name.split('/')) {
    const key = normalize(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

function earliestIndex(haystack: string, keys: string[]): number {
  let best = -1;
  for (const key of keys) {
    const i = haystack.indexOf(key);
    if (i >= 0 && (best === -1 || i < best)) best = i;
  }
  return best;
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function diversifyByArtist(queue: string[], pool: Album[]): string[] {
  const byId = new Map(pool.map((album) => [album.mbid, album]));
  const buckets = new Map<string, string[]>();
  const artistOrder: string[] = [];

  for (const mbid of dedupe(queue)) {
    const album = byId.get(mbid);
    if (!album) continue;
    const artistKey = artistKeys(album.primary_artist_name)[0] ?? album.primary_artist_name;
    if (!buckets.has(artistKey)) {
      buckets.set(artistKey, []);
      artistOrder.push(artistKey);
    }
    buckets.get(artistKey)?.push(mbid);
  }

  const out: string[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const artistKey of artistOrder) {
      const bucket = buckets.get(artistKey);
      const mbid = bucket?.shift();
      if (!mbid) continue;
      out.push(mbid);
      added = true;
    }
  }
  return out;
}

export function loadPriorityPlanVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    return localStorage.getItem(PRIORITY_PLAN_VERSION_KEY);
  } catch {
    return null;
  }
}

export function savePriorityPlanVersion(version: string): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(PRIORITY_PLAN_VERSION_KEY, version);
  } catch {
    // Non-critical: the queue itself still persists independently.
  }
}

export function loadPriorityQueue(): string[] {
  if (typeof localStorage === 'undefined') return memoryQueue;

  try {
    const raw = localStorage.getItem(PRIORITY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch (err) {
    console.warn('tastetest: failed to read priority queue, using in-memory queue', err);
    return memoryQueue;
  }
}

export function savePriorityQueue(queue: string[]): void {
  memoryQueue = dedupe(queue);
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(PRIORITY_KEY, JSON.stringify(memoryQueue));
  } catch (err) {
    console.warn('tastetest: failed to persist priority queue, continuing in-memory', err);
  }
}

export function priorityQueueFromArtistText(input: string, pool: Album[]): string[] {
  const haystack = normalize(input);
  if (!haystack) return [];

  const byArtist = new Map<string, { artist: string; albums: Album[]; keys: string[] }>();
  for (const album of pool) {
    const primaryKey = normalize(album.primary_artist_name);
    const entry =
      byArtist.get(primaryKey) ??
      { artist: album.primary_artist_name, albums: [], keys: artistKeys(album.primary_artist_name) };
    entry.albums.push(album);
    byArtist.set(primaryKey, entry);
  }

  return Array.from(byArtist.values())
    .map((entry) => ({ ...entry, index: earliestIndex(haystack, entry.keys) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index || a.artist.localeCompare(b.artist))
    .flatMap((entry) => entry.albums.map((album) => album.mbid));
}

/**
 * Build a priority queue from an ordered list of artist names (highest
 * priority first), returning the matched seed MBIDs in that order. Used to
 * auto-seed the queue from Keith's most-played artists so the default loop
 * front-loads his taste with no manual paste. Slash-aware via `artistKeys`.
 */
export function priorityQueueFromArtists(orderedArtists: string[], pool: Album[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const album of pool) {
    for (const key of artistKeys(album.primary_artist_name)) {
      const list = byKey.get(key) ?? [];
      list.push(album.mbid);
      byKey.set(key, list);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of orderedArtists) {
    for (const key of artistKeys(name)) {
      for (const mbid of byKey.get(key) ?? []) {
        if (seen.has(mbid)) continue;
        seen.add(mbid);
        out.push(mbid);
      }
    }
  }
  return out;
}

const QUEUED_REVIEW_STATUSES = new Set<PriorityAlbumReviewStatus | undefined>([
  undefined,
  'accept',
]);

function titleKey(title: string): string {
  return normalize(title)
    .replace(/^the /, '')
    .replace(/^a /, '');
}

export function priorityQueueFromAlbumPlan(plan: PriorityAlbumPlanEntry[], pool: Album[]): string[] {
  const byArtistTitle = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const album of pool) {
    const normalizedTitle = titleKey(album.title);
    byTitle.set(normalizedTitle, album.mbid);
    for (const artistKey of artistKeys(album.primary_artist_name)) {
      byArtistTitle.set(`${artistKey}|${normalizedTitle}`, album.mbid);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of plan) {
    if (!QUEUED_REVIEW_STATUSES.has(entry.review_status)) continue;
    const normalizedTitle = titleKey(entry.title);
    let mbid: string | undefined;
    for (const artistKey of artistKeys(entry.artist)) {
      mbid = byArtistTitle.get(`${artistKey}|${normalizedTitle}`);
      if (mbid) break;
    }
    mbid ??= byTitle.get(normalizedTitle);
    if (!mbid || seen.has(mbid)) continue;
    seen.add(mbid);
    out.push(mbid);
  }
  return out;
}

export function nextPriorityCandidate(
  queue: string[],
  pool: Album[],
  ranked: Album[],
  excluded: Set<string>
): { candidate: Album | null; queue: string[] } {
  const byId = new Map(pool.map((album) => [album.mbid, album]));
  const unavailable = new Set([...ranked.map((album) => album.mbid), ...excluded]);
  const cleaned = diversifyByArtist(queue, pool).filter((mbid) => byId.has(mbid) && !unavailable.has(mbid));
  const mbid = cleaned[0];
  return {
    candidate: mbid ? byId.get(mbid) ?? null : null,
    queue: cleaned,
  };
}
