import type { Album, ArtistLock, RankedAlbum, RankingState } from './ranking/types';
import type { SavedLists } from './lists';
import { loadLists } from './lists';
import type { ArtistPlays } from './seed';
import {
  loadSeedPool,
  loadPreferredArtists,
  loadPriorityAlbumPlan,
  playsMapFromPreferred,
} from './seed';
import { loadRanking } from './storage';
import { loadArtistLocks } from './artistLocksStorage';
import {
  loadPriorityQueue,
  loadPriorityPlanVersion,
  priorityQueueFromAlbumPlan,
  priorityQueueFromArtists,
  savePriorityQueue,
  savePriorityPlanVersion,
} from './priority';
import { loadRankingSnapshotDetailed, type RankingSnapshotLoad } from './rankingSync';
import { loadDiscoveredAlbums } from './discovery';
import {
  hasPendingSync,
  loadSyncBase,
  saveSyncBase,
  pendingBaseConflicts,
  markSyncConflict,
} from './syncStatus';
import { loadBlockedArtists, saveBlockedArtists } from './artistBlocks';
import { loadCuratedSkips, saveCuratedSkips } from './curatedSkipsStorage';
import { hydrateAlbums, hydrateLists } from './syncEngine';

export interface BootstrapResult {
  pool: Album[];
  priorityQueue: string[];
  preferred: ArtistPlays[];
  playsByArtist: Map<string, number>;
  cachedState: RankingState;
  cachedLists: SavedLists;
  cachedArtistLocks: ArtistLock[];
  pendingSync: boolean;
  blockedArtists: string[];
  curatedSkips: Set<string>;
  serverSnapshot: { ranked: RankedAlbum[]; lists: SavedLists; artistLocks: ArtistLock[] } | null;
  serverLoadStatus: RankingSnapshotLoad['status'];
  snapshotBaseUpdatedAt: number | null | undefined;
}

/**
 * Moved verbatim from main()'s former lines ~135-239 -- see
 * docs/superpowers/specs/2026-09-23-candidate-discovery-ownership-bootstrap-design.md.
 * Same sequential dependency chain as before (pool -> priority queue ->
 * server snapshot -> discovery merge -> priority-plan reconciliation ->
 * hydration); do not reorder. blockedArtists/curatedSkips ownership stays
 * rankingStore.ts's -- this only produces their one-time initial values.
 */
export async function bootstrapApp(ownerId: string): Promise<BootstrapResult> {
  const pool = await loadSeedPool();

  // Keith's play-weighted artist list drives both weighted selection and the
  // auto-seeded priority queue. Degrade gracefully to uniform/random if it
  // can't be loaded -- the loop must never blank out over a missing sidecar.
  let preferred: ArtistPlays[] = [];
  try {
    preferred = await loadPreferredArtists();
  } catch (err) {
    console.warn('tastetest: failed to load preferred artists, using uniform selection', err);
  }
  const playsByArtist = playsMapFromPreferred(preferred);

  let priorityQueue = loadPriorityQueue();
  // First-visit default: front-load Keith's most-played artists with no manual
  // paste.
  if (priorityQueue.length === 0 && preferred.length > 0) {
    priorityQueue = priorityQueueFromArtists(
      preferred.map((entry) => entry.artist),
      pool
    );
    savePriorityQueue(priorityQueue);
  }

  // Server-authoritative load-on-open. The owner snapshot (full records) is the
  // source of truth; localStorage is only an offline cache. When the server is
  // unreachable or has nothing yet, fall back to the cache -- and if the cache
  // holds local data, seed it up to the server.
  const cachedState: RankingState = loadRanking() ?? { ranked: [], pending: null };
  const cachedLists = loadLists();
  const cachedArtistLocks = loadArtistLocks();
  // A pending-sync flag means the local cache holds edits that were never
  // confirmed saved (writes locked, network error, etc). Computed up front
  // (it depends on nothing fetched below) so every server-authoritative
  // field below -- including blockedArtists/curatedSkips -- can gate on it
  // the same way, instead of letting the server clobber an unsynced local
  // edit just because pendingSync hadn't been checked yet.
  const pendingSync = hasPendingSync();
  // Turso is the source of truth for blocked artists / curated-entry skips,
  // same as ranked/lists/artistLocks -- localStorage here is a fallback for
  // the very first load after this field was introduced (nothing on the
  // server yet) and an offline cache thereafter, never authoritative. Never
  // let the server value overwrite a pending local edit; the same rule
  // resolveInitialState (in main.ts) applies to ranked/lists/artistLocks.
  let blockedArtists = loadBlockedArtists();
  let curatedSkips = new Set(loadCuratedSkips());
  const serverLoad = await loadRankingSnapshotDetailed(ownerId);
  if (serverLoad.status === 'found' && !pendingSync) {
    blockedArtists = serverLoad.blockedArtists;
    saveBlockedArtists(blockedArtists);
    curatedSkips = new Set(serverLoad.curatedSkips);
    saveCuratedSkips(serverLoad.curatedSkips);
  }
  let serverSnapshot =
    serverLoad.status === 'found'
      ? { ranked: serverLoad.ranked, lists: serverLoad.lists, artistLocks: serverLoad.artistLocks }
      : null;
  let snapshotBaseUpdatedAt: number | null | undefined =
    serverLoad.status === 'found'
      ? serverLoad.updatedAt
      : serverLoad.status === 'missing'
        ? null
        : loadSyncBase();
  const discovered = await loadDiscoveredAlbums(ownerId);
  const knownPoolIds = new Set(pool.map((album) => album.mbid));
  for (const album of discovered) {
    if (!knownPoolIds.has(album.mbid)) {
      pool.push(album);
      knownPoolIds.add(album.mbid);
    }
  }
  try {
    const priorityPlan = await loadPriorityAlbumPlan();
    if (priorityPlan && loadPriorityPlanVersion() !== priorityPlan.version) {
      priorityQueue = [
        ...priorityQueueFromAlbumPlan(priorityPlan.albums, pool),
        ...priorityQueue,
      ];
      savePriorityQueue(priorityQueue);
      savePriorityPlanVersion(priorityPlan.version);
    }
  } catch (err) {
    console.warn('tastetest: failed to load priority album plan', err);
  }
  const poolById = new Map(pool.map((album) => [album.mbid, album]));
  if (serverSnapshot) {
    serverSnapshot = {
      ranked: hydrateAlbums(serverSnapshot.ranked, poolById),
      lists: hydrateLists(serverSnapshot.lists, poolById),
      artistLocks: serverSnapshot.artistLocks,
    };
  }
  // When pendingSync is set, the server snapshot is stale by definition --
  // prefer the local cache instead of letting it clobber the unsynced edits,
  // and retry the save below. Pending edits retain the revision they were
  // actually made against; never borrow the just-fetched server revision to
  // save an older cached snapshot.
  if (pendingSync) {
    snapshotBaseUpdatedAt = loadSyncBase();
    if (serverLoad.status !== 'error' && pendingBaseConflicts(
      true, snapshotBaseUpdatedAt, serverLoad.status === 'found' ? serverLoad.updatedAt : null,
    )) markSyncConflict();
  } else if (snapshotBaseUpdatedAt !== undefined) {
    saveSyncBase(snapshotBaseUpdatedAt);
  }

  return {
    pool,
    priorityQueue,
    preferred,
    playsByArtist,
    cachedState,
    cachedLists,
    cachedArtistLocks,
    pendingSync,
    blockedArtists,
    curatedSkips,
    serverSnapshot,
    serverLoadStatus: serverLoad.status,
    snapshotBaseUpdatedAt,
  };
}
