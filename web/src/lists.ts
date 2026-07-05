import type { Album } from './ranking/types';

/** Which set-aside list an album belongs to. */
export type ListName = 'wantToListen' | 'notHeard' | 'dontCare';

/**
 * The set-aside lists. Full Album records are stored (not just mbids) so
 * the list views render covers/titles/artists without refetching the seed.
 */
export type SavedLists = {
  wantToListen: Album[];
  notHeard: Album[];
  dontCare: Album[];
};

const LISTS_KEY = 'tastetest-lists';

function emptyLists(): SavedLists {
  return { wantToListen: [], notHeard: [], dontCare: [] };
}

// In-memory fallback mirrors storage.ts: localStorage may be unavailable
// (private browsing, quota, non-browser test env) or throw. Either way the
// loop keeps working in-memory rather than crashing; only a real reload
// loses state in that case.
let memoryLists: SavedLists | null = null;

/**
 * Load the two set-aside lists, or a fresh empty pair if nothing is stored
 * yet or storage is unreadable.
 */
export function loadLists(): SavedLists {
  if (typeof localStorage === 'undefined') return memoryLists ?? emptyLists();

  try {
    const raw = localStorage.getItem(LISTS_KEY);
    if (!raw) return emptyLists();
    const parsed = JSON.parse(raw) as Partial<SavedLists>;
    return {
      wantToListen: parsed.wantToListen ?? [],
      notHeard: parsed.notHeard ?? [],
      dontCare: parsed.dontCare ?? [],
    };
  } catch (err) {
    console.warn('tastetest: failed to read set-aside lists from localStorage, using in-memory lists', err);
    return memoryLists ?? emptyLists();
  }
}

/** Persist the two set-aside lists under `tastetest-lists`. */
export function saveLists(lists: SavedLists): void {
  memoryLists = lists;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
  } catch (err) {
    console.warn('tastetest: failed to persist set-aside lists to localStorage, continuing in-memory', err);
  }
}

/**
 * Return a new SavedLists with `album` added to the `which` list. De-dupes by
 * mbid: if the album is already in that list, the lists are returned
 * unchanged (by value; still a fresh object).
 */
export function addToList(lists: SavedLists, album: Album, which: ListName): SavedLists {
  const target = lists[which];
  if (target.some((a) => a.mbid === album.mbid)) {
    return { ...lists };
  }
  return {
    ...lists,
    [which]: [...target, album],
  };
}

/** Return a new SavedLists with the album `mbid` removed from the `which` list. */
export function removeFromList(lists: SavedLists, mbid: string, which: ListName): SavedLists {
  return {
    ...lists,
    [which]: lists[which].filter((a) => a.mbid !== mbid),
  };
}

/** The union of every mbid across all set-aside lists -- albums to exclude
 * from the ranking pool. */
export function excludedMbids(lists: SavedLists): Set<string> {
  const ids = new Set<string>();
  for (const album of lists.wantToListen) ids.add(album.mbid);
  for (const album of lists.notHeard) ids.add(album.mbid);
  for (const album of lists.dontCare) ids.add(album.mbid);
  return ids;
}
