import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Album } from './ranking/types';
import {
  loadLists,
  saveLists,
  addToList,
  removeFromList,
  excludedMbids,
} from './lists';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('set-aside list helpers', () => {
  it('addToList adds an album to the named list', () => {
    const lists = addToList(
      { wantToListen: [], notHeard: [], dontCare: [] },
      album('a'),
      'wantToListen'
    );
    expect(lists.wantToListen.map((x) => x.mbid)).toEqual(['a']);
    expect(lists.notHeard).toEqual([]);
  });

  it('addToList de-dupes by mbid', () => {
    let lists = addToList({ wantToListen: [], notHeard: [], dontCare: [] }, album('a'), 'notHeard');
    lists = addToList(lists, album('a'), 'notHeard');
    expect(lists.notHeard.map((x) => x.mbid)).toEqual(['a']);
  });

  it('removeFromList removes the album by mbid', () => {
    const start = { wantToListen: [album('a'), album('b')], notHeard: [], dontCare: [] };
    const lists = removeFromList(start, 'a', 'wantToListen');
    expect(lists.wantToListen.map((x) => x.mbid)).toEqual(['b']);
  });

  it('excludedMbids returns the union of all three lists', () => {
    const lists = {
      wantToListen: [album('a')],
      notHeard: [album('b'), album('c')],
      dontCare: [album('d')],
    };
    expect(excludedMbids(lists)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('addToList adds to the dontCare list', () => {
    const lists = addToList(
      { wantToListen: [], notHeard: [], dontCare: [] },
      album('a'),
      'dontCare'
    );
    expect(lists.dontCare.map((x) => x.mbid)).toEqual(['a']);
    expect(lists.wantToListen).toEqual([]);
    expect(lists.notHeard).toEqual([]);
  });

  it('round-trips through save/load', () => {
    const lists = { wantToListen: [album('a')], notHeard: [album('b')], dontCare: [album('c')] };
    saveLists(lists);
    expect(loadLists()).toEqual(lists);
  });

  it('loadLists defaults a missing dontCare list to empty (legacy storage)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = globalThis.localStorage;
    // Legacy stored payload predates dontCare.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => JSON.stringify({ wantToListen: [album('a')], notHeard: [] }),
        setItem: () => {},
        removeItem: () => {},
      },
    });

    try {
      expect(loadLists()).toEqual({
        wantToListen: [album('a')],
        notHeard: [],
        dontCare: [],
      });
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: original,
        });
      } else {
        // @ts-expect-error - restore absence of localStorage
        delete globalThis.localStorage;
      }
    }
    warn.mockRestore();
  });

  it('does not crash when localStorage.setItem throws (graceful failure)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = globalThis.localStorage;
    // Simulate a quota / private-mode failure on write.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {},
      },
    });

    try {
      const lists = { wantToListen: [album('z')], notHeard: [], dontCare: [] };
      expect(() => saveLists(lists)).not.toThrow();
      // load falls back to the in-memory copy written by saveLists
      expect(loadLists()).toEqual(lists);
      expect(warn).toHaveBeenCalled();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: original,
        });
      } else {
        // @ts-expect-error - restore absence of localStorage
        delete globalThis.localStorage;
      }
    }
  });
});
