import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtistLock } from './ranking/types';
import { loadArtistLocks, saveArtistLocks, __resetMemoryLocks } from './artistLocksStorage';

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
    __resetMemoryLocks();
    // @ts-expect-error - restore the default Node test environment.
    delete globalThis.localStorage;
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
    localStorage.setItem('tastetest-artist-locks', 'not json');
    expect(loadArtistLocks()).toEqual([]);
  });
});
