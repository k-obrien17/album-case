import type { Album } from './ranking/types';
import { parseBacklog, type Backlog } from '../shared/backlog';
import { parseAlbumArray } from './album';
import { key } from './curatedListMatch';

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
  backlog?: Backlog<Album>;
};

const LISTS_KEY = 'tastetest-lists';

/** Fold the retired refresher shelf into Want to listen when opening old saves. */
export function mergeRefresherIntoWantToListen(lists: SavedLists): SavedLists {
  if (!lists.backlog?.needsRefresher.length) return lists;
  const wantToListen = [...lists.wantToListen];
  for (const album of lists.backlog.needsRefresher) {
    if (!wantToListen.some((a) => a.mbid === album.mbid || key(a.primary_artist_name, a.title) === key(album.primary_artist_name, album.title))) {
      wantToListen.push(album);
    }
  }
  return { ...lists, wantToListen, backlog: { ...lists.backlog, needsRefresher: [] } };
}

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
      ...(parsed.backlog && { backlog: parseBacklog(parsed.backlog, parseAlbumArray) ?? undefined }),
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
  const next = removeFromAllLists(lists, album);
  return {
    ...next,
    [which]: target.some((a) => a.mbid === album.mbid) ? target : [...next[which], album],
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
  for (const album of lists.backlog?.readyToRank ?? []) ids.add(album.mbid);
  for (const album of lists.backlog?.needsRefresher ?? []) ids.add(album.mbid);
  return ids;
}

export function allSavedAlbums(lists: SavedLists): Album[] {
  return [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare,
    ...(lists.backlog?.readyToRank ?? []), ...(lists.backlog?.needsRefresher ?? [])];
}

export function removeFromAllLists(lists: SavedLists, album: Album): SavedLists {
  const keep = (a: Album) => a.mbid !== album.mbid && key(a.primary_artist_name, a.title) !== key(album.primary_artist_name, album.title);
  return {
    ...lists,
    wantToListen: lists.wantToListen.filter(keep),
    notHeard: lists.notHeard.filter(keep),
    dontCare: lists.dontCare.filter(keep),
    ...(lists.backlog && { backlog: {
      ...lists.backlog,
      readyToRank: lists.backlog.readyToRank.filter(keep),
      needsRefresher: lists.backlog.needsRefresher.filter(keep),
      ...(lists.backlog.pendingReview && { pendingReview: lists.backlog.pendingReview.filter(keep) }),
    } }),
  };
}
