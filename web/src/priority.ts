import type { Album } from './ranking/types';

const PRIORITY_KEY = 'tastetest-priority-queue';

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

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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

  const byArtist = new Map<string, { artist: string; albums: Album[] }>();
  for (const album of pool) {
    const key = normalize(album.primary_artist_name);
    const entry = byArtist.get(key) ?? { artist: album.primary_artist_name, albums: [] };
    entry.albums.push(album);
    byArtist.set(key, entry);
  }

  return Array.from(byArtist.entries())
    .map(([key, entry]) => ({ ...entry, index: haystack.indexOf(key) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index || a.artist.localeCompare(b.artist))
    .flatMap((entry) => entry.albums.map((album) => album.mbid));
}

export function nextPriorityCandidate(
  queue: string[],
  pool: Album[],
  ranked: Album[],
  excluded: Set<string>
): { candidate: Album | null; queue: string[] } {
  const byId = new Map(pool.map((album) => [album.mbid, album]));
  const unavailable = new Set([...ranked.map((album) => album.mbid), ...excluded]);
  const cleaned = dedupe(queue).filter((mbid) => byId.has(mbid) && !unavailable.has(mbid));
  const mbid = cleaned[0];
  return {
    candidate: mbid ? byId.get(mbid) ?? null : null,
    queue: cleaned,
  };
}
