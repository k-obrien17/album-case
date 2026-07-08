import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistLock } from './ranking/types';
import { loadArtistLocks, saveArtistLocks } from './artistLocksStorage';

const ARTIST_A = '11111111-1111-4111-8111-111111111111';

describe('artistLocksStorage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  afterEach(() => {
    localStorage.clear();
    // @ts-expect-error - restore the default Node test environment.
    delete globalThis.localStorage;
    vi.restoreAllMocks();
  });

  it('returns an empty array when nothing is stored yet', () => {
    expect(loadArtistLocks()).toEqual([]);
  });

  it('round-trips locks through save/load', () => {
    const locks: ArtistLock[] = [{ artistMbid: ARTIST_A, order: ['a1', 'a2'] }];
    saveArtistLocks(locks);
    expect(loadArtistLocks()).toEqual(locks);
  });

  it('returns an empty array for corrupted stored JSON rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset in-memory state through the public API rather than a test-only
    // export: the module is cached once per test file, so `memoryLocks`
    // (module-level) can carry over from an earlier it() block regardless
    // of declaration order.
    saveArtistLocks([]);
    localStorage.setItem('tastetest-artist-locks', 'not json');
    expect(loadArtistLocks()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
