import './style.css';
import type { Album, ArtistLock, RankedAlbum, RankingState } from './ranking/types';
import { setAsideAlbum } from './ranking/setAside';
import { ratingForDropIndex } from './ranking/rating';
import {
  loadSeedPool,
  loadPreferredArtists,
  loadPriorityAlbumPlan,
  playsMapFromPreferred,
  pickCandidate,
} from './seed';
import type { ArtistPlays } from './seed';
import { loadRanking, saveRanking } from './storage';
import { getOrCreateSession, isValidSessionId } from './session';
import { OWNER_ID } from './owner';
import {
  loadLists,
  saveLists,
  addToList,
  removeFromList,
  excludedMbids,
  type ListName,
  type SavedLists,
} from './lists';
import { mountRankList } from './ui/rankList';
import { renderSavedList } from './ui/savedList';
import { enqueueAtom, flushAtomQueue } from './atoms';
import {
  loadPriorityQueue,
  loadPriorityPlanVersion,
  nextPriorityCandidate,
  priorityQueueFromAlbumPlan,
  priorityQueueFromArtists,
  savePriorityQueue,
  savePriorityPlanVersion,
} from './priority';
import { loadRankingSnapshotDetailed, saveRankingSnapshot } from './rankingSync';
import { discoverArtistDetailed, loadDiscoveredAlbums } from './discovery';
import { runBulkDiscovery, TOP_ARTIST_DISCOVERY_COUNT } from './bulkDiscovery';
import { clearWriteKey, extractKeyFromFragment, hasWriteKey, setWriteKey } from './writeKey';
import { clearPendingSync, hasPendingSync, markPendingSync } from './syncStatus';
import {
  addBlockedArtist,
  blockedArtistMbids,
  loadBlockedArtists,
  removeBlockedArtist,
  saveBlockedArtists,
} from './artistBlocks';
import { loadSkippedAlbums, saveSkippedAlbums } from './skippedAlbums';
import { loadArtistLocks, saveArtistLocks } from './artistLocksStorage';
import { upsertLock, removeLock, nearestValidDropIndex } from './ranking/locks';
import { mountArtistLockView } from './ui/artistLockView';
import {
  applyArtistCooldown,
  loadCandidateArtistCooldown,
  pushArtistCooldown,
  saveCandidateArtistCooldown,
} from './candidateCooldown';

type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistLock';

type RestoreSnapshot = { state: RankingState; lists: SavedLists };

/**
 * Outcome of attempting to restore a ranking from a session code. Retained as
 * a tested module (the UI no longer surfaces restore codes -- Album Case is a
 * single-user, server-owned app), but the pure flow stays available.
 */
export type RestoreOutcome =
  | { status: 'invalid' }
  | { status: 'not-found' }
  | { status: 'error' }
  | ({ status: 'restored' } & RestoreSnapshot);

/**
 * DOM-free core of the "Restore from code" flow. Validates the code shape,
 * loads the snapshot for that session, and only adopts the session (via
 * `deps.setSession`) when a snapshot is actually found. A thrown load is a
 * transient server error; a `null` load is a genuine "nothing saved here".
 */
export async function restoreFromCode(
  code: string,
  pool: Album[],
  deps: {
    setSession: (id: string) => unknown;
    load: (id: string, pool: Album[]) => Promise<RestoreSnapshot | null>;
  }
): Promise<RestoreOutcome> {
  if (!isValidSessionId(code)) return { status: 'invalid' };
  const id = code.trim();

  let snapshot: RestoreSnapshot | null;
  try {
    snapshot = await deps.load(id, pool);
  } catch {
    return { status: 'error' };
  }
  if (!snapshot) return { status: 'not-found' };

  deps.setSession(id);
  return { status: 'restored', state: snapshot.state, lists: snapshot.lists };
}

/**
 * Decide the source of truth on open. The server snapshot wins whenever it
 * exists (its records are full and authoritative); otherwise fall back to the
 * localStorage cache. Pure so load-on-open precedence is unit-testable.
 */
export function resolveInitialState(
  serverSnapshot: { ranked: RankedAlbum[]; lists: SavedLists; artistLocks: ArtistLock[] } | null,
  cached: { state: RankingState; lists: SavedLists; artistLocks: ArtistLock[] }
): { state: RankingState; lists: SavedLists; artistLocks: ArtistLock[]; fromServer: boolean } {
  if (serverSnapshot) {
    return {
      state: { ranked: serverSnapshot.ranked, pending: null },
      lists: serverSnapshot.lists,
      artistLocks: serverSnapshot.artistLocks,
      fromServer: true,
    };
  }
  return { state: cached.state, lists: cached.lists, artistLocks: cached.artistLocks, fromServer: false };
}

function snapshotAlbumCount(snapshot: { ranked: Album[]; lists: SavedLists }): number {
  return (
    snapshot.ranked.length +
    snapshot.lists.wantToListen.length +
    snapshot.lists.notHeard.length +
    snapshot.lists.dontCare.length
  );
}

function lockWeight(locks: ArtistLock[]): number {
  return locks.reduce((total, lock) => total + 1 + lock.order.length, 0);
}

/**
 * A stale pending-sync flag can trap a browser on an old local copy forever
 * when writes are locked. If the server clearly has a richer snapshot, prefer
 * it; otherwise keep protecting the local unsynced edits.
 */
export function serverSnapshotIsRicher(
  serverSnapshot: { ranked: Album[]; lists: SavedLists; artistLocks: ArtistLock[] },
  cached: { state: RankingState; lists: SavedLists; artistLocks: ArtistLock[] }
): boolean {
  const cachedSnapshot = { ranked: cached.state.ranked, lists: cached.lists };
  return (
    snapshotAlbumCount(serverSnapshot) > snapshotAlbumCount(cachedSnapshot) ||
    lockWeight(serverSnapshot.artistLocks) > lockWeight(cached.artistLocks)
  );
}

export function hydrateAlbums<T extends Album>(albums: T[], byId: Map<string, Album>): T[] {
  return albums.map((album) => ({ ...(byId.get(album.mbid) ?? {}), ...album }));
}

export function hydrateLists(lists: SavedLists, byId: Map<string, Album>): SavedLists {
  return {
    wantToListen: hydrateAlbums(lists.wantToListen, byId),
    notHeard: hydrateAlbums(lists.notHeard, byId),
    dontCare: hydrateAlbums(lists.dontCare, byId),
  };
}

/**
 * Remove `album` from `ranked` if present (re-rating an existing album),
 * compute its new rating for landing at `targetIndex` in the resulting
 * array, then return the full list with `album` re-inserted at its
 * rating-sorted position. `targetIndex` should already reflect any
 * lock-safety clamping (nearestValidDropIndex) the caller performed.
 */
function reRate(ranked: RankedAlbum[], album: Album, targetIndex: number): RankedAlbum[] {
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  const clampedIndex = Math.max(0, Math.min(targetIndex, without.length));
  const rating = ratingForDropIndex(without, clampedIndex);
  const rated: RankedAlbum = { ...album, rating };
  return [...without, rated].sort((a, b) => b.rating - a.rating);
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
  }

  // Bookmark a URL with #key=... once per device and never type the write
  // key again. A fragment, not a query string, so the browser never sends it
  // to the server (no risk of it landing in access logs). Strip it from the
  // visible address bar after storing -- the bookmark itself is unaffected.
  const urlKey = extractKeyFromFragment(window.location.hash);
  if (urlKey) {
    setWriteKey(urlKey);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  const session = getOrCreateSession();
  void flushAtomQueue();

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
  let blockedArtists = loadBlockedArtists();
  const serverLoad = await loadRankingSnapshotDetailed(OWNER_ID);
  let serverSnapshot =
    serverLoad.status === 'found'
      ? { ranked: serverLoad.ranked, lists: serverLoad.lists, artistLocks: serverLoad.artistLocks }
      : null;
  let snapshotBaseUpdatedAt: number | null | undefined =
    serverLoad.status === 'found'
      ? serverLoad.updatedAt
      : serverLoad.status === 'missing'
        ? null
        : undefined;
  let snapshotSaveChain: Promise<void> = Promise.resolve();
  let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const SYNC_RETRY_MS = 4000;
  const discovered = await loadDiscoveredAlbums(OWNER_ID);
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
  // A pending-sync flag means the local cache holds edits that were never
  // confirmed saved (writes locked, network error, etc). In that case the
  // server snapshot is stale by definition -- prefer the local cache instead
  // of letting it clobber the unsynced edits, and retry the save below.
  const pendingSync = hasPendingSync();
  const cached = {
    state: cachedState,
    lists: cachedLists,
    artistLocks: cachedArtistLocks,
  };
  const recoverServerSnapshot =
    pendingSync && !!serverSnapshot && serverSnapshotIsRicher(serverSnapshot, cached);
  const initial = resolveInitialState(pendingSync && !recoverServerSnapshot ? null : serverSnapshot, cached);
  let state: RankingState = initial.state;
  let lists: SavedLists = initial.lists;
  let artistLocks: ArtistLock[] = initial.artistLocks;
  if (initial.fromServer) {
    saveRanking(state);
    saveLists(lists);
    saveArtistLocks(artistLocks);
    if (recoverServerSnapshot) clearPendingSync();
  } else if (
    pendingSync ||
    (serverLoad.status === 'missing' &&
      (state.ranked.length > 0 ||
        lists.wantToListen.length > 0 ||
        lists.notHeard.length > 0 ||
        lists.dontCare.length > 0))
  ) {
    markPendingSync();
    queueRankingSnapshotSync();
  }

  // First-visit correctness: an empty list plus a first candidate, never a
  // blank screen. Priority albums are offered first; random eligible albums
  // are the fallback.
  let candidate: Album | null = null;

  // "Skip for now" is sticky: skipped albums are excluded from selection and
  // persisted locally so they do not resurface on reload.
  const skippedAlbums = loadSkippedAlbums();
  let candidateArtistCooldown = loadCandidateArtistCooldown();

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const heading = document.createElement('h1');
  heading.className = 'app-heading';
  heading.textContent = 'Album Case';

  // Visible, persistent (not a transient rankList.showStatus toast) warning
  // for unsynced local changes -- the fix for silently losing an add when
  // writes are locked and the server snapshot clobbers the local cache.
  const syncBanner = document.createElement('p');
  syncBanner.className = 'sync-banner';
  syncBanner.hidden = true;

  const nav = document.createElement('nav');
  nav.className = 'view-switcher';

  const stage = document.createElement('div');
  stage.className = 'app-stage';

  shell.append(heading, syncBanner, nav, stage);
  app.textContent = '';
  app.append(shell);

  let view: ViewMode = 'ranked';

  function updateSyncBanner(): void {
    if (!hasPendingSync()) {
      syncBanner.hidden = true;
      syncBanner.textContent = '';
      return;
    }
    syncBanner.hidden = false;
    syncBanner.textContent = hasWriteKey()
      ? 'Not saved to the server yet. Retrying...'
      : 'Writes are locked -- changes are only saved on this device. Unlock writes to save them to the server.';
  }

  updateSyncBanner();

  function pickFrom(excluded: Set<string>): Album | null {
    const priority = nextPriorityCandidate(priorityQueue, pool, state.ranked, excluded);
    priorityQueue = priority.queue;
    savePriorityQueue(priorityQueue);
    return (
      priority.candidate ?? pickCandidate(pool, state.ranked, excluded, Math.random, playsByArtist)
    );
  }

  function reselectCandidate(): void {
    // Selection excludes set-aside lists, skipped albums, and blocked artists.
    let excluded = excludedMbids(lists);
    for (const mbid of blockedArtistMbids(pool, blockedArtists)) excluded.add(mbid);
    for (const mbid of skippedAlbums) excluded.add(mbid);
    excluded = applyArtistCooldown(pool, state.ranked, excluded, candidateArtistCooldown);
    candidate = pickFrom(excluded);
    candidateArtistCooldown = pushArtistCooldown(candidateArtistCooldown, candidate);
    saveCandidateArtistCooldown(candidateArtistCooldown);
  }

  async function syncRankingSnapshot(): Promise<void> {
    // Nothing outstanding -- e.g. a queued retry fired after handleUnlock
    // already resolved things. Skip the redundant round-trip.
    if (!hasPendingSync()) return;

    if (snapshotBaseUpdatedAt === undefined) {
      // A prior version conflict cleared the base. Refetch the server's
      // current version so saving can resume -- previously this disabled
      // sync for the rest of the page load while the banner kept claiming
      // "Retrying...", which was never true.
      const fresh = await loadRankingSnapshotDetailed(session.session_id);
      if (fresh.status === 'found') {
        snapshotBaseUpdatedAt = fresh.updatedAt;
      } else if (fresh.status === 'missing') {
        snapshotBaseUpdatedAt = null;
      } else {
        scheduleSyncRetry();
        updateSyncBanner();
        return;
      }
    }

    const result = await saveRankingSnapshot(
      session.session_id,
      state,
      lists,
      artistLocks,
      snapshotBaseUpdatedAt
    );
    if (result.status === 'saved') {
      snapshotBaseUpdatedAt = result.updatedAt;
      clearPendingSync();
    } else {
      // 'skipped' (writes locked), 'error' (network/server), or 'conflict':
      // none of these mean the local edit made it to the server, so keep the
      // pending flag set. 'skipped' only resolves by unlocking (handleUnlock
      // re-syncs), so don't burn a timer retrying that; the rest genuinely
      // retry, since the banner promises they will.
      markPendingSync();
      if (result.status === 'conflict') {
        snapshotBaseUpdatedAt = undefined;
        console.warn('albumcase: ranking snapshot save skipped because the server copy changed');
      }
      if (result.status !== 'skipped') scheduleSyncRetry();
    }
    updateSyncBanner();
  }

  function scheduleSyncRetry(): void {
    if (syncRetryTimer !== null) return;
    syncRetryTimer = setTimeout(() => {
      syncRetryTimer = null;
      queueRankingSnapshotSync();
    }, SYNC_RETRY_MS);
  }

  function queueRankingSnapshotSync(): void {
    snapshotSaveChain = snapshotSaveChain.then(syncRankingSnapshot, syncRankingSnapshot);
    void snapshotSaveChain;
  }

  function persistRankingState(): void {
    saveRanking(state);
    markPendingSync();
    updateSyncBanner();
    queueRankingSnapshotSync();
  }

  function persistLists(): void {
    saveLists(lists);
    markPendingSync();
    updateSyncBanner();
    queueRankingSnapshotSync();
  }

  function persistArtistLocks(): void {
    saveArtistLocks(artistLocks);
    markPendingSync();
    updateSyncBanner();
    queueRankingSnapshotSync();
  }

  function removeBlockedFromPriorityQueue(): void {
    const blockedIds = blockedArtistMbids(pool, blockedArtists);
    priorityQueue = priorityQueue.filter((mbid) => !blockedIds.has(mbid));
    savePriorityQueue(priorityQueue);
  }

  function handleBlockArtist(album: Album): void {
    blockedArtists = addBlockedArtist(blockedArtists, album.primary_artist_name);
    saveBlockedArtists(blockedArtists);
    removeBlockedFromPriorityQueue();
    reselectCandidate();
    rankList.showStatus(`No more ${album.primary_artist_name} albums.`);
    renderNav();
  }

  async function handleDiscoverArtist(album: Album): Promise<void> {
    const artistName = album.primary_artist_name;
    const artistMbid = album.primary_artist_mbid;
    if (!artistMbid) {
      rankList.showStatus(`Refresh Album Case to discover more ${artistName} albums.`);
      return;
    }
    const knownMbids = pool
      .filter((a) => a.primary_artist_mbid === artistMbid)
      .map((a) => a.mbid);

    const discoveredResult = await discoverArtistDetailed(
      session.session_id,
      artistName,
      artistMbid,
      knownMbids
    );
    if (discoveredResult.status === 'locked') {
      rankList.showStatus('Unlock writes to discover more albums.');
      return;
    }
    if (discoveredResult.status === 'error') {
      rankList.showStatus(`Could not discover more ${artistName} albums.`);
      return;
    }
    if (discoveredResult.status === 'empty') {
      rankList.showStatus(`No more ${artistName} albums found.`);
      return;
    }

    const found = discoveredResult.albums;
    const poolIds = new Set(pool.map((a) => a.mbid));
    const newToPool = found.filter((a) => !poolIds.has(a.mbid));
    pool.push(...newToPool);

    priorityQueue = [...found.map((a) => a.mbid), ...priorityQueue];
    savePriorityQueue(priorityQueue);
    reselectCandidate();
    rankList.render();
  }

  let bulkDiscoveryInFlight = false;

  async function handleBulkDiscover(): Promise<void> {
    if (bulkDiscoveryInFlight) return;
    bulkDiscoveryInFlight = true;
    renderNav();
    try {
      const result = await runBulkDiscovery(state.ranked, pool, priorityQueue, {
        discover: (name, mbid, known) => discoverArtistDetailed(session.session_id, name, mbid, known),
        onProgress: (msg) => rankList.showStatus(msg),
      });
      priorityQueue = result.priorityQueue;
      savePriorityQueue(priorityQueue);
      reselectCandidate();
      rankList.render();
      rankList.showStatus(result.summary);
    } finally {
      bulkDiscoveryInFlight = false;
      renderNav();
    }
  }

  let lockedArtistMbid: string | null = null;
  let artistLockController: ReturnType<typeof mountArtistLockView> | null = null;

  function findAlbumByArtist(artistMbid: string): Album | null {
    return (
      state.ranked.find((a) => a.primary_artist_mbid === artistMbid) ??
      [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare].find(
        (a) => a.primary_artist_mbid === artistMbid
      ) ??
      pool.find((a) => a.primary_artist_mbid === artistMbid) ??
      null
    );
  }

  function renderArtistLockView(): void {
    if (!lockedArtistMbid) {
      showView('ranked');
      return;
    }
    const artistMbid = lockedArtistMbid;
    const artistAlbum = findAlbumByArtist(artistMbid);
    if (!artistAlbum) {
      lockedArtistMbid = null;
      showView('ranked');
      return;
    }

    artistLockController?.teardown();
    stage.textContent = '';
    artistLockController = mountArtistLockView(stage, {
      album: artistAlbum,
      getRanked: () => state.ranked,
      getLists: () => lists,
      getPool: () => pool,
      getArtistLocks: () => artistLocks,
      onReorder: (from, to) => {
        const album = state.ranked[from];
        state = { ranked: reRate(state.ranked, album, to), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
      onRemoveRanked: (album) => {
        lists = addToList(lists, album, 'dontCare');
        state = setAsideAlbum(state, album.mbid);
        persistLists();
        persistRankingState();
        renderArtistLockView();
        renderNav();
      },
      onSetOverallRank: (from, to) => {
        const clamped = nearestValidDropIndex(state.ranked, artistLocks, from, to);
        const album = state.ranked[from];
        state = { ranked: reRate(state.ranked, album, clamped), pending: null };
        persistRankingState();
        renderArtistLockView();
      },
      onPlace: (album, index) => {
        state = { ranked: reRate(state.ranked, album, index), pending: null };
        lists = removeFromList(lists, album.mbid, 'wantToListen');
        lists = removeFromList(lists, album.mbid, 'notHeard');
        lists = removeFromList(lists, album.mbid, 'dontCare');
        persistRankingState();
        persistLists();
        renderArtistLockView();
      },
      onLock: (lock) => {
        artistLocks = upsertLock(artistLocks, lock);
        persistArtistLocks();
        renderArtistLockView();
      },
      onUnlock: (mbid) => {
        artistLocks = removeLock(artistLocks, mbid);
        persistArtistLocks();
        renderArtistLockView();
      },
      onDiscover: async () => {
        const knownMbids = pool
          .filter((a) => a.primary_artist_mbid === artistMbid)
          .map((a) => a.mbid);
        const result = await discoverArtistDetailed(
          session.session_id,
          artistAlbum.primary_artist_name,
          artistMbid,
          knownMbids
        );
        if (result.status !== 'found') return result;

        let count = 0;
        const poolIds = new Set(pool.map((a) => a.mbid));
        for (const found of result.albums) {
          if (!poolIds.has(found.mbid)) {
            pool.push(found);
            poolIds.add(found.mbid);
            count += 1;
          }
        }
        return { status: 'found', count };
      },
      onClose: () => {
        lockedArtistMbid = null;
        showView('ranked');
      },
    });
  }

  function handleOpenArtistLock(album: Album): void {
    if (!album.primary_artist_mbid) {
      rankList.showStatus(`Refresh Album Case to lock ${album.primary_artist_name}'s order.`);
      return;
    }
    lockedArtistMbid = album.primary_artist_mbid;
    showView('artistLock');
  }

  reselectCandidate();

  const rankList = mountRankList(stage, {
    getRanked: () => state.ranked,
    getCandidate: () => candidate,
    getLockedArtistMbids: () => artistLocks.map((lock) => lock.artistMbid),
    getNearestValidDrop: (from, to) => nearestValidDropIndex(state.ranked, artistLocks, from, to),
    onOpenArtistLock: (album) => handleOpenArtistLock(album),
    onPlace: (index) => {
      if (!candidate) return;
      const before = state.ranked;
      const placed = candidate;
      const clamped = Math.max(0, Math.min(index, before.length));
      const upper = before[clamped - 1] ?? null;
      const lower = before[clamped] ?? null;

      if (upper) {
        enqueueAtom({
          entity_a: upper.mbid,
          entity_b: placed.mbid,
          winner: upper.mbid,
          session_id: session.session_id,
        });
      }
      if (lower) {
        enqueueAtom({
          entity_a: placed.mbid,
          entity_b: lower.mbid,
          winner: placed.mbid,
          session_id: session.session_id,
        });
      }

      state = { ranked: reRate(before, placed, clamped), pending: null };
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onReorder: (from, to) => {
      const album = state.ranked[from];
      state = { ranked: reRate(state.ranked, album, to), pending: null };
      persistRankingState();
      rankList.render();
    },
    onRemoveRanked: (album) => {
      lists = addToList(lists, album, 'dontCare');
      state = setAsideAlbum(state, album.mbid);
      persistLists();
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onSetOverallRank: (from, to) => {
      const clamped = nearestValidDropIndex(state.ranked, artistLocks, from, to);
      const album = state.ranked[from];
      state = { ranked: reRate(state.ranked, album, clamped), pending: null };
      persistRankingState();
      rankList.render();
    },
    onSetAside: (album, which) => {
      // Record to the saved list first (so it is excluded), then drop it from
      // ranking state (setAsideAlbum also clears any stale placement), then
      // pick the next candidate.
      lists = addToList(lists, album, which);
      state = setAsideAlbum(state, album.mbid);
      persistLists();
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onSkip: (album) => {
      skippedAlbums.add(album.mbid);
      saveSkippedAlbums(skippedAlbums);
      reselectCandidate();
      rankList.render();
    },
    onBlockArtist: (album) => {
      handleBlockArtist(album);
    },
    onCompare: (winnerMbid, loserMbid) => {
      enqueueAtom({
        entity_a: winnerMbid,
        entity_b: loserMbid,
        winner: winnerMbid,
        session_id: session.session_id,
      });
    },
    onDiscoverArtist: (album) => {
      void handleDiscoverArtist(album);
    },
  });

  function markAsHeard(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    persistLists();
    // Eligible again: if the pool was exhausted (no candidate), offer it now.
    if (!candidate) reselectCandidate();
    renderNav();
    renderCurrentSavedList(which);
  }

  function renderCurrentSavedList(which: ListName): void {
    renderSavedList(stage, lists[which], (album) => markAsHeard(album, which));
  }

  function restoreArtist(artistName: string): void {
    blockedArtists = removeBlockedArtist(blockedArtists, artistName);
    saveBlockedArtists(blockedArtists);
    if (!candidate) reselectCandidate();
    renderNav();
    renderBlockedArtists();
  }

  function renderBlockedArtists(): void {
    stage.textContent = '';
    if (blockedArtists.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'saved-empty';
      empty.textContent = 'No blocked artists.';
      stage.append(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'saved-list';
    for (const artist of blockedArtists) {
      const item = document.createElement('li');
      item.className = 'saved-item';

      const meta = document.createElement('div');
      meta.className = 'saved-meta';
      const name = document.createElement('p');
      name.className = 'saved-title';
      name.textContent = artist;
      meta.append(name);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'saved-mark';
      btn.textContent = 'Restore';
      btn.addEventListener('click', () => restoreArtist(artist));

      item.append(meta, btn);
      list.append(item);
    }
    stage.append(list);
  }

  function showView(next: ViewMode): void {
    // Leaving the drag view: cancel any in-flight drag / listeners.
    if (view === 'ranked' && next !== 'ranked') {
      rankList.teardown();
    }
    if (view === 'artistLock' && next !== 'artistLock') {
      artistLockController?.teardown();
      artistLockController = null;
    }
    view = next;

    if (view === 'ranked') {
      rankList.render();
    } else if (view === 'blockedArtists') {
      renderBlockedArtists();
    } else if (view === 'artistLock') {
      renderArtistLockView();
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
  }

  // Reads are public, so boot-on-load already has the real server state by
  // the time writes get unlocked -- just push it (or retry, if there's a
  // pending edit) rather than re-fetching first.
  function handleUnlock(): void {
    rankList.showStatus('Writes unlocked.');
    renderNav();
    persistRankingState();
    void flushAtomQueue();
  }

  function renderNav(): void {
    nav.textContent = '';
    const items: Array<{ mode: ViewMode; label: string }> = [
      { mode: 'ranked', label: `Ranked list (${state.ranked.length})` },
      { mode: 'wantToListen', label: `Want to listen (${lists.wantToListen.length})` },
      { mode: 'notHeard', label: `Haven't heard (${lists.notHeard.length})` },
      { mode: 'dontCare', label: `Don't care (${lists.dontCare.length})` },
      { mode: 'blockedArtists', label: `Blocked artists (${blockedArtists.length})` },
    ];

    for (const { mode, label } of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = mode === view ? 'view-tab view-tab-active' : 'view-tab';
      btn.textContent = label;
      btn.addEventListener('click', () => showView(mode));
      nav.append(btn);
    }

    const writeUnlocked = hasWriteKey();
    const writeBtn = document.createElement('button');
    writeBtn.type = 'button';
    writeBtn.className = writeUnlocked ? 'view-tab write-tab write-tab-active' : 'view-tab write-tab';
    writeBtn.textContent = writeUnlocked ? 'Lock writes' : 'Unlock writes';
    writeBtn.title = writeUnlocked ? 'Clear the stored write key from this browser' : 'Store the write key in this browser';
    writeBtn.addEventListener('click', () => {
      if (hasWriteKey()) {
        clearWriteKey();
        rankList.showStatus('Writes locked.');
        updateSyncBanner();
        renderNav();
        return;
      }

      const secret = window.prompt('Enter the Album Case write key');
      if (!secret || !secret.trim()) return;
      setWriteKey(secret.trim());
      handleUnlock();
    });
    nav.append(writeBtn);

    const bulkDiscoverBtn = document.createElement('button');
    bulkDiscoverBtn.type = 'button';
    bulkDiscoverBtn.className = 'view-tab';
    bulkDiscoverBtn.textContent = bulkDiscoveryInFlight ? 'Discovering…' : 'Fill in more albums';
    bulkDiscoverBtn.disabled = bulkDiscoveryInFlight;
    bulkDiscoverBtn.title = `Bulk-discover the remaining catalog for your top ${TOP_ARTIST_DISCOVERY_COUNT} ranked artists`;
    bulkDiscoverBtn.addEventListener('click', () => {
      void handleBulkDiscover();
    });
    nav.append(bulkDiscoverBtn);
  }

  renderNav();
}

if (typeof document !== 'undefined') {
  void main();
}
