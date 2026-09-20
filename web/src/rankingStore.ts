import type { ArtistLock, RankingState } from './ranking/types';
import type { SavedLists } from './lists';

export interface RankingStore {
  getState: () => RankingState;
  setState: (next: RankingState) => void;
  getLists: () => SavedLists;
  setLists: (next: SavedLists) => void;
  getArtistLocks: () => ArtistLock[];
  setArtistLocks: (next: ArtistLock[]) => void;
  getBlockedArtists: () => string[];
  setBlockedArtists: (next: string[]) => void;
  getCuratedSkips: () => Set<string>;
  setCuratedSkips: (next: Set<string>) => void;
}

export interface RankingStoreInit {
  state: RankingState;
  lists: SavedLists;
  artistLocks: ArtistLock[];
  blockedArtists: string[];
  curatedSkips: Set<string>;
}

/**
 * Owns the ranking-snapshot domain: the five values syncEngine.ts already
 * persists/loads as one unit (persistRankingState/persistLists/
 * persistBlockedArtists/persistCuratedSkips, loadRankingSnapshotDetailed).
 * Extracted from main()'s closure locals, mirroring the precedent
 * syncEngine.ts set for the save/retry/banner domain -- a get/set API, no
 * behavior change. `curatedSkips`'s in-place `.add`/`.delete` call sites
 * keep working unchanged since `getCuratedSkips()` returns the live `Set`
 * reference; `setCuratedSkips` exists for the one bootstrap-time wholesale
 * reassignment (adopting the server's skip list).
 *
 * Bootstrap (server/cache resolution) stays inline in main.ts -- this store
 * is only created once that resolution has produced initial values.
 */
export function createRankingStore(init: RankingStoreInit): RankingStore {
  let state = init.state;
  let lists = init.lists;
  let artistLocks = init.artistLocks;
  let blockedArtists = init.blockedArtists;
  let curatedSkips = init.curatedSkips;

  return {
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    getLists: () => lists,
    setLists: (next) => {
      lists = next;
    },
    getArtistLocks: () => artistLocks,
    setArtistLocks: (next) => {
      artistLocks = next;
    },
    getBlockedArtists: () => blockedArtists,
    setBlockedArtists: (next) => {
      blockedArtists = next;
    },
    getCuratedSkips: () => curatedSkips,
    setCuratedSkips: (next) => {
      curatedSkips = next;
    },
  };
}
