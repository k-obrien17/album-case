import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCuratedSkips, saveCuratedSkips } from './curatedSkipsStorage';

describe('curatedSkipsStorage', () => {
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
    expect(loadCuratedSkips()).toEqual([]);
  });

  it('round-trips skip keys through save/load', () => {
    const skips = ['list-1:3', 'list-2:1'];
    saveCuratedSkips(skips);
    expect(loadCuratedSkips()).toEqual(skips);
  });

  it('returns an empty array for corrupted stored JSON rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset in-memory state through the public API rather than a test-only
    // export: the module is cached once per test file, so the in-memory
    // fallback can carry over from an earlier it() block regardless of
    // declaration order.
    saveCuratedSkips([]);
    localStorage.setItem('tastetest-curated-skips', 'not json');
    expect(loadCuratedSkips()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
