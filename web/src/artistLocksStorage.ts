import type { ArtistLock } from './ranking/types';

const LOCKS_KEY = 'tastetest-artist-locks';

// Mirrors lists.ts: localStorage may be unavailable (private browsing,
// quota, non-browser test env) or throw. Keep the loop working in-memory
// rather than crashing; only a real reload loses state in that case.
let memoryLocks: ArtistLock[] | null = null;

/** Load the artist locks, or an empty array if nothing is stored yet or
 *  storage is unreadable. */
export function loadArtistLocks(): ArtistLock[] {
  if (typeof localStorage === 'undefined') return memoryLocks ?? [];

  try {
    const raw = localStorage.getItem(LOCKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ArtistLock[]) : [];
  } catch (err) {
    console.warn('tastetest: failed to read artist locks from localStorage, using in-memory locks', err);
    return memoryLocks ?? [];
  }
}

/** Persist the artist locks under `tastetest-artist-locks`. */
export function saveArtistLocks(locks: ArtistLock[]): void {
  memoryLocks = locks;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(LOCKS_KEY, JSON.stringify(locks));
  } catch (err) {
    console.warn('tastetest: failed to persist artist locks to localStorage, continuing in-memory', err);
  }
}

/** @internal: Reset in-memory state for testing purposes. */
export function __resetMemoryLocks(): void {
  memoryLocks = null;
}
