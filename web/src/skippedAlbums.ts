const SKIPPED_ALBUMS_KEY = 'tastetest-skipped-albums';

let memorySkippedAlbums: Set<string> | null = null;

function normalize(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((value): value is string => typeof value === 'string'));
}

export function loadSkippedAlbums(): Set<string> {
  if (typeof localStorage === 'undefined') return memorySkippedAlbums ?? new Set();

  try {
    const raw = localStorage.getItem(SKIPPED_ALBUMS_KEY);
    return raw ? normalize(JSON.parse(raw)) : new Set();
  } catch (err) {
    console.warn('tastetest: failed to read skipped albums from localStorage, using memory', err);
    return memorySkippedAlbums ?? new Set();
  }
}

export function saveSkippedAlbums(skipped: Set<string>): void {
  memorySkippedAlbums = new Set(skipped);

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(SKIPPED_ALBUMS_KEY, JSON.stringify([...skipped]));
  } catch (err) {
    console.warn('tastetest: failed to persist skipped albums, continuing in-memory', err);
  }
}
