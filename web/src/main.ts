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
import { createRankingBackup } from './backup';
import { filterAlbums } from './search';
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
import { mountRankList, type SearchResultsState } from './ui/rankList';
import { searchArtists, type ArtistResult } from './artistSearch';
import { mountArtistBatchView } from './ui/artistBatchView';
import { mountSpeedRound } from './ui/speedRound';
import { artistAlbumsFor } from './artistLockAlbums';
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
import { runBulkDiscovery, runSimilarExpansion, TOP_ARTIST_DISCOVERY_COUNT } from './bulkDiscovery';
import type { SimilarArtist } from './bulkDiscovery';
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
import {
  applyArtistCooldown,
  loadCandidateArtistCooldown,
  pushArtistCooldown,
  saveCandidateArtistCooldown,
} from './candidateCooldown';
import { CURATED_LISTS } from './data/curatedLists';
import { curatedEntryKey, unrankedFromCuratedList } from './curatedListMatch';
import { renderCuratedListView } from './ui/curatedListView';
import type { CuratedAlbumEntry } from './data/curatedLists';

type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistBatch' | 'speedRound' | 'curatedLists';

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
 * array, then return the full list with `album` re-inserted at exactly
 * that position. `targetIndex` should already reflect any lock-safety
 * clamping (nearestValidDropIndex) the caller performed.
 *
 * Splices at `clampedIndex` directly instead of appending and re-sorting
 * by rating (mirrors insertion.ts's applyPick). `ratingForDropIndex`
 * computes `rating` specifically so this item belongs at `clampedIndex`,
 * so placing it there is always correct on its own -- sorting afterward
 * is not just redundant, it's actively wrong on ties: once the post-backfill
 * #1 album sits at rating 10.00, dropping anything else at index 0 also
 * computes 10.00, and Array.prototype.sort's stability would leave the
 * incumbent ahead of the new item, making position 0 unreachable.
 */
export function reRate(ranked: RankedAlbum[], album: Album, targetIndex: number): RankedAlbum[] {
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  const clampedIndex = Math.max(0, Math.min(targetIndex, without.length));
  const rating = ratingForDropIndex(without, clampedIndex);
  const rated: RankedAlbum = { ...album, rating };
  return [...without.slice(0, clampedIndex), rated, ...without.slice(clampedIndex)];
}

/**
 * Insert `album` at `rating` into `ranked` by finding its correct position
 * directly, rather than appending and re-sorting (the same bug class fixed in
 * `reRate`). A directly-typed rating has no drop-position intent to preserve,
 * so ties resolve by placing the new entry immediately after any existing
 * entries at the same rating -- e.g. typing "10" when rank #1 is already the
 * 10.00 ceiling lands the new album at index 1, not scrambled elsewhere in
 * the list and not fighting the incumbent for index 0.
 */
export function insertAtRating(ranked: RankedAlbum[], album: Album, rating: number): RankedAlbum[] {
  // Guard against a duplicate mbid: a duplicate would fail the API's
  // parseRankedAlbumList validation (400 invalid_snapshot), surfacing only
  // as a sync failure in the banner. Mirrors what reRate already does.
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  const rated: RankedAlbum = { ...album, rating };
  const insertAt = without.findIndex((a) => a.rating < rating);
  const index = insertAt === -1 ? without.length : insertAt;
  return [...without.slice(0, index), rated, ...without.slice(index)];
}

/**
 * Add a searched (MusicBrainz-fallback) album to the ranked list at `rating`,
 * and strip it out of every saved list it might already be sitting in (e.g.
 * a prior "Want to listen"). HARD REQUIREMENT: api/ranking.ts rejects any
 * snapshot where an album is both ranked and in a saved list (400
 * ranked_album_in_saved_list) -- this exact bug class already blocked the
 * canon import once. Pure and exported so the regression is actually
 * guarded by a test that exercises this function directly, not a re-run of
 * the same sequence in the test body.
 */
export function addSearchedAlbum(
  ranked: RankedAlbum[],
  lists: SavedLists,
  album: Album,
  rating: number
): { ranked: RankedAlbum[]; lists: SavedLists } {
  const newRanked = insertAtRating(ranked, album, rating);
  let newLists = removeFromList(lists, album.mbid, 'wantToListen');
  newLists = removeFromList(newLists, album.mbid, 'notHeard');
  newLists = removeFromList(newLists, album.mbid, 'dontCare');
  return { ranked: newRanked, lists: newLists };
}

/**
 * Set the rating of the ranked album currently at global index `from` to
 * `rating`, re-inserting it at wherever that rating lands it. No lock
 * parameter -- artist locks are paused (see ranking/locks.ts). Removes the
 * album, then re-inserts via `insertAtRating`, which splices at the computed
 * index directly rather than appending and re-sorting -- append-then-sort
 * broke on rating ties (a stable sort strands the new album behind an
 * equal-rated incumbent). See insertAtRating's own doc comment.
 */
export function setRating(ranked: RankedAlbum[], from: number, rating: number): RankedAlbum[] {
  const album = ranked[from];
  if (!album) return ranked;
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  return insertAtRating(without, album, rating);
}

export interface SyncSnapshotInput {
  sessionId: string;
  state: RankingState;
  lists: SavedLists;
  artistLocks: ArtistLock[];
  blockedArtists: string[];
  curatedSkips: string[];
  baseUpdatedAt: number | null | undefined;
}

export type SyncSnapshotResult =
  | { outcome: 'saved'; updatedAt: number }
  | { outcome: 'pending'; nextBaseUpdatedAt: number | null | undefined };

export interface SyncSnapshotDeps {
  loadFresh: typeof loadRankingSnapshotDetailed;
  save: typeof saveRankingSnapshot;
}

const defaultSyncSnapshotDeps: SyncSnapshotDeps = {
  loadFresh: loadRankingSnapshotDetailed,
  save: saveRankingSnapshot,
};

/** Pure transition logic for the ranking-snapshot sync/conflict-resolution
 *  state machine, extracted for direct unit testing -- see HANDOFF.md's
 *  ship-check backlog. `syncRankingSnapshot` below is a thin side-effecting
 *  wrapper that applies the result to closure state. */
export async function performRankingSync(
  input: SyncSnapshotInput,
  deps: SyncSnapshotDeps = defaultSyncSnapshotDeps
): Promise<SyncSnapshotResult> {
  let resolvedBase = input.baseUpdatedAt;

  if (resolvedBase === undefined) {
    // A prior version conflict cleared the base. Refetch the server's
    // current version so saving can resume -- previously this disabled
    // sync for the rest of the page load while the banner kept claiming
    // "Retrying...", which was never true.
    const fresh = await deps.loadFresh(input.sessionId);
    if (fresh.status === 'found') {
      resolvedBase = fresh.updatedAt;
    } else if (fresh.status === 'missing') {
      resolvedBase = null;
    } else {
      return { outcome: 'pending', nextBaseUpdatedAt: undefined };
    }
  }

  const result = await deps.save(
    input.sessionId,
    input.state,
    input.lists,
    input.artistLocks,
    input.blockedArtists,
    input.curatedSkips,
    resolvedBase
  );

  if (result.status === 'saved') {
    return { outcome: 'saved', updatedAt: result.updatedAt };
  }
  // 'error' (network/server): the base we resolved is still presumed valid,
  // so it carries forward unchanged for the next retry.
  // 'conflict': the server copy changed under us, so the base is cleared to
  // force a refetch next attempt.
  return {
    outcome: 'pending',
    nextBaseUpdatedAt: result.status === 'conflict' ? undefined : resolvedBase,
  };
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
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
  // Turso is the source of truth for blocked artists / curated-entry skips,
  // same as ranked/lists/artistLocks -- localStorage here is a fallback for
  // the very first load after this field was introduced (nothing on the
  // server yet) and an offline cache thereafter, never authoritative.
  let blockedArtists = loadBlockedArtists();
  let curatedSkips = new Set<string>();
  const serverLoad = await loadRankingSnapshotDetailed(OWNER_ID);
  if (serverLoad.status === 'found') {
    blockedArtists = serverLoad.blockedArtists;
    saveBlockedArtists(blockedArtists);
    curatedSkips = new Set(serverLoad.curatedSkips);
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

  // Local search over the ranked list, plus the MusicBrainz fallback when
  // nothing local matches. Kept in main.ts, not rankList.ts -- rankList is a
  // pure render layer over whatever state it's handed.
  let searchQuery = '';
  let searchResults: SearchResultsState = { status: 'idle' };

  // Band-hit selection from the merged search box below: which artist (if
  // any) is mid-fetch, and the one-shot message to show once it resolves.
  let selectingArtistMbid: string | null = null;
  let artistSelectMessage: string | null = null;

  // Curated-list browsing (curatedLists.ts): which list (if any) is selected,
  // which row (if any) is mid-resolve, and a message tied to a specific row.
  let selectedCuratedListId: string | null = null;
  let curatedRatingEntryKey: string | null = null;
  let curatedRateMessage: { key: string; text: string } | null = null;
  // A search match awaiting owner confirmation before it's inserted -- see
  // handleRateCuratedAlbum's doc comment for why nothing gets inserted
  // sight-unseen. `kind` picks the destination: a rating insert (ranked
  // list) or a plain wantToListen add.
  let curatedPendingMatch:
    | { key: string; album: Album; kind: 'rate'; rating: number }
    | { key: string; album: Album; kind: 'wantToListen' }
    | null = null;

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const heading = document.createElement('h1');
  heading.className = 'app-heading';
  heading.textContent = 'Album Case';

  // Visible, persistent (not a transient rankList.showStatus toast) warning
  // for a save that hasn't reached the server yet -- e.g. a network hiccup.
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

  // Write-key enforcement is dropped for now, so the only thing left to
  // warn about is a genuine save failure (network/server), not a locked
  // session -- there's no more "locked" state.
  function updateSyncBanner(): void {
    if (!hasPendingSync()) {
      syncBanner.hidden = true;
      syncBanner.textContent = '';
      return;
    }
    syncBanner.hidden = false;
    syncBanner.textContent = 'Not saved to the server yet. Retrying...';
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
    // Nothing outstanding -- e.g. a queued retry fired after an earlier
    // call in the chain already resolved things. Skip the redundant round-trip.
    if (!hasPendingSync()) return;

    const result = await performRankingSync({
      sessionId: session.session_id,
      state,
      lists,
      artistLocks,
      blockedArtists,
      curatedSkips: [...curatedSkips],
      baseUpdatedAt: snapshotBaseUpdatedAt,
    });

    if (result.outcome === 'saved') {
      snapshotBaseUpdatedAt = result.updatedAt;
      clearPendingSync();
    } else {
      // 'pending': neither a refetch failure nor a save (error/conflict)
      // got the local edit to the server, so keep the pending flag set and
      // retry, since the banner promises it will.
      if (result.nextBaseUpdatedAt === undefined && snapshotBaseUpdatedAt !== undefined) {
        console.warn('albumcase: ranking snapshot save skipped because the server copy changed');
      }
      snapshotBaseUpdatedAt = result.nextBaseUpdatedAt;
      markPendingSync();
      scheduleSyncRetry();
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

  function persistBlockedArtists(): void {
    saveBlockedArtists(blockedArtists);
    markPendingSync();
    updateSyncBanner();
    queueRankingSnapshotSync();
  }

  function persistCuratedSkips(): void {
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
    persistBlockedArtists();
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
      const deps = {
        discover: (name: string, mbid: string, known: string[]) =>
          discoverArtistDetailed(session.session_id, name, mbid, known),
        onProgress: (msg: string) => rankList.showStatus(msg),
      };
      const result = await runBulkDiscovery(state.ranked, pool, priorityQueue, deps);
      priorityQueue = result.priorityQueue;
      savePriorityQueue(priorityQueue);
      let summary = result.summary;

      // Tier 2: the top artists' own catalogs are exhausted -- expand to
      // similar artists via ListenBrainz. Not when Tier 1 actually found
      // albums.
      if (result.found === 0) {
        const expansion = await runSimilarExpansion(
          state.ranked,
          pool,
          priorityQueue,
          blockedArtists,
          {
            ...deps,
            fetchSimilar: async (artistMbid) => {
              try {
                const res = await fetch(`/api/similar-artists?artist_mbid=${artistMbid}`);
                if (!res.ok) return null;
                const body = (await res.json()) as { artists: SimilarArtist[] };
                return body.artists ?? [];
              } catch {
                return null;
              }
            },
          }
        );
        priorityQueue = expansion.priorityQueue;
        savePriorityQueue(priorityQueue);
        summary = expansion.summary;
      }

      reselectCandidate();
      rankList.render();
      rankList.showStatus(summary);
    } finally {
      bulkDiscoveryInFlight = false;
      renderNav();
    }
  }

  let batchArtistMbid: string | null = null;
  let artistBatchController: ReturnType<typeof mountArtistBatchView> | null = null;

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

  function renderArtistBatchView(): void {
    if (!batchArtistMbid) {
      showView('ranked');
      return;
    }
    const artistMbid = batchArtistMbid;
    const artistAlbum = findAlbumByArtist(artistMbid);
    if (!artistAlbum) {
      batchArtistMbid = null;
      showView('ranked');
      return;
    }

    artistBatchController?.teardown();
    stage.textContent = '';
    artistBatchController = mountArtistBatchView(stage, {
      album: artistAlbum,
      getRanked: () => state.ranked,
      getLists: () => lists,
      getPool: () => pool,
      onReorder: (from, to) => {
        const album = state.ranked[from];
        state = { ranked: reRate(state.ranked, album, to), pending: null };
        persistRankingState();
        renderArtistBatchView();
      },
      onRemoveRanked: (album) => {
        lists = addToList(lists, album, 'dontCare');
        state = setAsideAlbum(state, album.mbid);
        persistLists();
        persistRankingState();
        renderArtistBatchView();
        renderNav();
      },
      onSetOverallRank: (from, to) => {
        const album = state.ranked[from];
        state = { ranked: reRate(state.ranked, album, to), pending: null };
        persistRankingState();
        renderArtistBatchView();
      },
      onSetRating: (from, rating) => {
        state = { ranked: setRating(state.ranked, from, rating), pending: null };
        persistRankingState();
        renderArtistBatchView();
      },
      onRate: (album, rating) => {
        state = { ranked: insertAtRating(state.ranked, album, rating), pending: null };
        lists = removeFromList(lists, album.mbid, 'wantToListen');
        lists = removeFromList(lists, album.mbid, 'notHeard');
        lists = removeFromList(lists, album.mbid, 'dontCare');
        persistRankingState();
        persistLists();
        renderArtistBatchView();
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
        batchArtistMbid = null;
        showView('ranked');
      },
    });
  }

  function handleOpenArtistBatch(album: Album): void {
    if (!album.primary_artist_mbid) {
      rankList.showStatus(`Refresh Album Case to view ${album.primary_artist_name}'s albums.`);
      return;
    }
    batchArtistMbid = album.primary_artist_mbid;
    showView('artistBatch');
  }

  async function handleSelectSearchedArtist(artist: ArtistResult): Promise<void> {
    if (selectingArtistMbid) return; // a selection is already in flight
    selectingArtistMbid = artist.mbid;
    artistSelectMessage = null;
    rankList.render();

    // Guard against a stale response landing after the search box has moved
    // on to a different query, same convention as onSearchMusicBrainz above:
    // capture the query this selection is FOR before the await.
    const forQuery = searchQuery.trim();

    const result = await discoverArtistDetailed(session.session_id, artist.name, artist.mbid, []);
    // Reset unconditionally, before the view/query checks below. selectingArtistMbid
    // is main.ts-scoped state that outlives this call, unlike the old
    // artistSearchView.ts's per-view-instance `selectingMbid` (torn down with
    // the view on navigation) -- if the reset were skipped here whenever the
    // owner had left the ranked view, every future band selection would
    // silently no-op forever (guarded by the `if (selectingArtistMbid) return`
    // above), with no visible error and no reload-fixable state.
    selectingArtistMbid = null;

    // The owner may have navigated away from the ranked view (where the
    // merged search box lives) while this was in flight, or kept typing and
    // moved on to a different search entirely -- discard the remaining
    // rendering/navigation side effects below (including any message write)
    // in either case, but the state reset above must still happen regardless.
    if (view !== 'ranked' || searchQuery.trim() !== forQuery) return;

    if (result.status === 'error') {
      artistSelectMessage = `Could not load ${artist.name}'s albums.`;
      rankList.render();
      return;
    }
    if (result.status === 'empty') {
      artistSelectMessage = `No albums found for ${artist.name}.`;
      rankList.render();
      return;
    }

    const found = result.albums;
    const poolIds = new Set(pool.map((a) => a.mbid));
    for (const album of found) {
      if (!poolIds.has(album.mbid)) {
        pool.push(album);
        poolIds.add(album.mbid);
      }
    }
    // Pool just grew: if every existing album was already placed, candidate
    // was null -- same reselect-if-exhausted convention as markAsHeard /
    // restoreArtist / the old artist-search flow this replaces.
    if (!candidate) reselectCandidate();

    searchQuery = '';
    searchResults = { status: 'idle' };
    batchArtistMbid = artist.mbid;
    showView('artistBatch');
  }

  let speedRoundController: ReturnType<typeof mountSpeedRound> | null = null;

  // Same remount-on-every-change convention as renderArtistBatchView: one
  // mount per candidate, so a fresh mic auto-arms as soon as the next
  // candidate is in place -- no in-place candidate-change tracking needed.
  function renderSpeedRound(): void {
    speedRoundController?.teardown();
    stage.textContent = '';
    speedRoundController = mountSpeedRound(stage, {
      getCandidate: () => candidate,
      // No pairwise atom, same precedent as onDirectRate -- no comparison
      // happened, just a direct rating.
      onRate: (album, rating) => {
        state = { ranked: insertAtRating(state.ranked, album, rating), pending: null };
        persistRankingState();
        reselectCandidate();
        renderSpeedRound();
        renderNav();
      },
      onSkip: (album) => {
        skippedAlbums.add(album.mbid);
        saveSkippedAlbums(skippedAlbums);
        reselectCandidate();
        renderSpeedRound();
      },
      onClose: () => {
        showView('ranked');
      },
    });
  }

  reselectCandidate();

  function runMusicBrainzSearch(query: string): void {
    void (async () => {
      // Guard against a stale response landing after the user kept typing:
      // capture the query this fetch is FOR, and discard the result if the
      // live search box has since moved on to a different query.
      const forQuery = query.trim();
      searchResults = { status: 'loading' };
      rankList.render();

      // Album and band results come from two independent MusicBrainz
      // endpoints, fired together. Each is caught on its own so one
      // failing doesn't blank out the other -- only report 'error' when
      // BOTH fail.
      const albumsPromise: Promise<Album[] | null> = (async () => {
        try {
          const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}`);
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { albums: Album[] };
          return body.albums ?? [];
        } catch {
          return null;
        }
      })();

      const [albums, artistOutcome] = await Promise.all([albumsPromise, searchArtists(query)]);
      const artists = artistOutcome.status === 'found' ? artistOutcome.artists : [];

      const next: SearchResultsState =
        albums === null && artistOutcome.status === 'error'
          ? { status: 'error' }
          : { status: 'done', albums: albums ?? [], artists };

      if (searchQuery.trim() !== forQuery) return; // stale response, discard
      searchResults = next;
      rankList.render();
    })();
  }

  const rankList = mountRankList(stage, {
    getRanked: () => filterAlbums(state.ranked, searchQuery),
    getGlobalRanked: () => state.ranked,
    getSearchQuery: () => searchQuery,
    onSearchQueryChange: (query) => {
      searchQuery = query;
      searchResults = { status: 'idle' }; // a new query invalidates old results
      artistSelectMessage = null; // and any leftover band-selection message
      rankList.render();
    },
    onSearchMusicBrainz: runMusicBrainzSearch,
    getSearchResults: () => searchResults,
    onRateSearchResult: (album, rating) => {
      const added = addSearchedAlbum(state.ranked, lists, album, rating);
      state = { ranked: added.ranked, pending: null };
      lists = added.lists;

      searchQuery = '';
      searchResults = { status: 'idle' };
      persistRankingState();
      persistLists();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onSelectArtist: (artist) => {
      void handleSelectSearchedArtist(artist);
    },
    getSelectingArtistMbid: () => selectingArtistMbid,
    getArtistSelectMessage: () => artistSelectMessage,
    getCandidate: () => candidate,
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
    // Artist locks are paused (not enforced) -- see ranking/locks.ts's header
    // comment. This just moves to the requested index, no clamping.
    onSetOverallRank: (from, to) => {
      const album = state.ranked[from];
      state = { ranked: reRate(state.ranked, album, to), pending: null };
      persistRankingState();
      rankList.render();
    },
    onSetRating: (from, rating) => {
      state = { ranked: setRating(state.ranked, from, rating), pending: null };
      persistRankingState();
      rankList.render();
    },
    // Unlike onPlace, this does not enqueue any pairwise atoms -- no
    // comparison actually happened, so there's no winner/loser pair to log.
    onDirectRate: (rating) => {
      if (!candidate) return;
      state = { ranked: insertAtRating(state.ranked, candidate, rating), pending: null };
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
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
    onOpenArtistBatch: (album) => {
      handleOpenArtistBatch(album);
    },
    getArtistAlbumCount: (album) => {
      if (!album.primary_artist_mbid) return 0;
      const grouped = artistAlbumsFor(album.primary_artist_mbid, state.ranked, lists, pool);
      return grouped.ranked.length + grouped.unranked.length;
    },
  });

  function rateFromSavedList(album: Album, which: ListName, rating: number): void {
    const added = addSearchedAlbum(state.ranked, lists, album, rating);
    state = { ranked: added.ranked, pending: null };
    lists = added.lists;
    persistRankingState();
    persistLists();
    reselectCandidate();
    renderNav();
    renderCurrentSavedList(which);
  }

  function removeFromSavedList(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    persistLists();
    // Unlike rateFromSavedList, this is a permanent discard, not a ranked
    // placement -- skippedAlbums already keeps it out of candidate selection
    // (see reselectCandidate), so there's nothing new to offer.
    skippedAlbums.add(album.mbid);
    saveSkippedAlbums(skippedAlbums);
    renderNav();
    renderCurrentSavedList(which);
  }

  function renderCurrentSavedList(which: ListName): void {
    renderSavedList(
      stage,
      lists[which],
      (album, rating) => rateFromSavedList(album, which, rating),
      (album) => removeFromSavedList(album, which)
    );
  }

  function restoreArtist(artistName: string): void {
    blockedArtists = removeBlockedArtist(blockedArtists, artistName);
    persistBlockedArtists();
    if (!candidate) reselectCandidate();
    renderNav();
    renderBlockedArtists();
  }

  /** Human-readable label for a skipped curatedEntryKey ("listId:rank"),
   *  falling back to the raw key if the list/rank no longer resolves (a
   *  list was renamed/removed since the skip was recorded). */
  function describeCuratedSkip(entryKey: string): string {
    const [listId, rankStr] = entryKey.split(':');
    const rank = Number(rankStr);
    const entry = listId ? CURATED_LISTS[listId]?.albums.find((a) => a.rank === rank) : undefined;
    return entry ? `${entry.artist} – ${entry.title}` : entryKey;
  }

  function unskipCuratedEntry(entryKey: string): void {
    curatedSkips.delete(entryKey);
    persistCuratedSkips();
    renderBlockedArtists();
    renderCuratedListsView();
  }

  /** Shared review/undo screen for both hide-state mechanisms: blocked
   *  artists (global, all views) and skipped curated albums (per-entry,
   *  curated lists only) -- one screen rather than two, per the design
   *  discussion (both are "I hid this, let me get it back" in spirit). */
  function renderBlockedArtists(): void {
    stage.textContent = '';

    if (blockedArtists.length === 0 && curatedSkips.size === 0) {
      const empty = document.createElement('p');
      empty.className = 'saved-empty';
      empty.textContent = 'No blocked artists or skipped albums.';
      stage.append(empty);
      return;
    }

    if (blockedArtists.length > 0) {
      const heading = document.createElement('p');
      heading.className = 'curated-list-status';
      heading.textContent = 'Blocked artists';
      stage.append(heading);

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

    if (curatedSkips.size > 0) {
      const heading = document.createElement('p');
      heading.className = 'curated-list-status';
      heading.textContent = 'Skipped curated albums';
      stage.append(heading);

      const list = document.createElement('ul');
      list.className = 'saved-list';
      for (const entryKey of curatedSkips) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const meta = document.createElement('div');
        meta.className = 'saved-meta';
        const name = document.createElement('p');
        name.className = 'saved-title';
        name.textContent = describeCuratedSkip(entryKey);
        meta.append(name);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'saved-mark';
        btn.textContent = 'Unskip';
        btn.addEventListener('click', () => unskipCuratedEntry(entryKey));

        item.append(meta, btn);
        list.append(item);
      }
      stage.append(list);
    }
  }

  function handleSelectCuratedList(listId: string): void {
    selectedCuratedListId = listId;
    curatedRateMessage = null;
    curatedPendingMatch = null;
    renderCuratedListsView();
  }

  /** Resolve this entry via MusicBrainz search, but don't insert anything yet
   *  -- hold the result as `curatedPendingMatch` for the owner to confirm
   *  (see handleConfirmCuratedMatch). A raw "${artist} ${title}" text search
   *  against MusicBrainz is NOT reliably the right album: querying "MF DOOM
   *  & Madlib Madvillainy" returned an unrelated 2026 release ("MF Doom" by
   *  Pozer) as the top hit, and it got inserted into the real ranked list at
   *  the owner's typed rating before this confirm step existed -- diagnosed
   *  2026-08-12 after the owner reported ratings "not saving" (the wrong
   *  album silently landed instead, and since its title/artist didn't match
   *  the curated entry's text, unrankedFromCuratedList kept showing the
   *  entry as unrated too, masking the corruption). */
  type CuratedSearchOutcome = { status: 'found'; album: Album } | { status: 'not-found' } | { status: 'stale' };

  /** Shared MusicBrainz search + in-flight row lock for an unresolved
   *  curated entry, used by both the rate flow and the want-to-listen flow
   *  -- see handleRateCuratedAlbum's doc comment for why a raw search
   *  result can't be inserted without owner confirmation. Sets/clears
   *  curatedRatingEntryKey; callers own curatedPendingMatch and rendering. */
  async function searchCuratedEntry(
    entry: CuratedAlbumEntry,
    listId: string,
    entryKey: string,
  ): Promise<CuratedSearchOutcome> {
    curatedRatingEntryKey = entryKey;
    renderCuratedListsView();

    let album: Album | null = null;
    try {
      const q = `${entry.artist} ${entry.title}`;
      const res = await fetch(`/api/search-album?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const body = (await res.json()) as { albums?: Album[] };
        album = body.albums?.[0] ?? null;
      }
    } catch {
      album = null;
    }

    // The owner may have switched to a different curated list while this
    // was in flight -- discard a response that no longer applies, same
    // stale-response convention used elsewhere in this file. Still clear the
    // lock: leaving it set would strand every row disabled for the rest of
    // the session.
    if (selectedCuratedListId !== listId) {
      curatedRatingEntryKey = null;
      return { status: 'stale' };
    }
    if (!album) {
      curatedRatingEntryKey = null;
      return { status: 'not-found' };
    }
    // Keep curatedRatingEntryKey set (locks other rows) until the owner
    // confirms or cancels -- resolved in handleConfirmCuratedMatch /
    // handleCancelCuratedMatch.
    return { status: 'found', album };
  }

  async function handleRateCuratedAlbum(entry: CuratedAlbumEntry, rating: number): Promise<void> {
    if (!selectedCuratedListId || curatedRatingEntryKey) return;
    const listId = selectedCuratedListId;
    const entryKey = curatedEntryKey(listId, entry);
    curatedRateMessage = null;
    curatedPendingMatch = null;

    // Pre-vetted offline by resolve-curated-list-mbids.mjs (score>=90
    // MusicBrainz confidence bar, or a direct hit against the owner's own
    // already-ranked albums) -- no live search, no confirm step. The point
    // of the confirm gate below is defending against an unscoped live text
    // search; a resolved entry already cleared a stricter bar than that.
    if (entry.resolved) {
      const added = addSearchedAlbum(state.ranked, lists, entry.resolved, rating);
      state = { ranked: added.ranked, pending: null };
      lists = added.lists;
      persistRankingState();
      persistLists();
      reselectCandidate();
      renderNav();
      renderCuratedListsView();
      return;
    }

    const outcome = await searchCuratedEntry(entry, listId, entryKey);
    if (outcome.status === 'stale') return;
    if (outcome.status === 'not-found') {
      curatedRateMessage = { key: entryKey, text: `Could not find "${entry.title}" by ${entry.artist}.` };
      renderCuratedListsView();
      return;
    }
    curatedPendingMatch = { key: entryKey, album: outcome.album, kind: 'rate', rating };
    renderCuratedListsView();
  }

  /** Owner confirmed `curatedPendingMatch` is the right album. Rate matches
   *  use the same insertion path as the main search box's onRateSearchResult
   *  (addSearchedAlbum); wantToListen matches just append to that list. */
  function handleConfirmCuratedMatch(): void {
    if (!curatedPendingMatch) return;
    const match = curatedPendingMatch;
    if (match.kind === 'rate') {
      const added = addSearchedAlbum(state.ranked, lists, match.album, match.rating);
      state = { ranked: added.ranked, pending: null };
      lists = added.lists;
      persistRankingState();
      persistLists();
      curatedPendingMatch = null;
      curatedRatingEntryKey = null;
      reselectCandidate();
      renderNav();
      renderCuratedListsView();
      return;
    }
    lists = addToList(lists, match.album, 'wantToListen');
    persistLists();
    curatedPendingMatch = null;
    curatedRatingEntryKey = null;
    renderCuratedListsView();
  }

  function handleCancelCuratedMatch(): void {
    curatedPendingMatch = null;
    curatedRatingEntryKey = null;
    renderCuratedListsView();
  }

  /** No confirmation, no undo-toast -- entries in error just have "no simple
   *  way to skip" per the original complaint; unskip lives in the Blocked
   *  artists screen (renderBlockedArtists) instead, so this stays one tap. */
  function handleSkipCuratedEntry(listId: string, entry: CuratedAlbumEntry): void {
    curatedSkips.add(curatedEntryKey(listId, entry));
    persistCuratedSkips();
    renderCuratedListsView();
  }

  /** Same block mechanism as the main discovery pool's "No more X albums"
   *  (handleBlockArtist) -- curated entries carry an artist name but not
   *  always an Album record, so this can't reuse that function directly. */
  function handleHideCuratedArtist(entry: CuratedAlbumEntry): void {
    blockedArtists = addBlockedArtist(blockedArtists, entry.artist);
    persistBlockedArtists();
    removeBlockedFromPriorityQueue();
    renderCuratedListsView();
  }

  /** Resolved entries (pre-vetted offline, see handleRateCuratedAlbum's
   *  comment) add straight to wantToListen -- no search needed. Unresolved
   *  entries go through the same search-confirm flow as handleRateCuratedAlbum,
   *  landing in `lists.wantToListen` instead of the ranked list once the
   *  owner confirms the match (see handleConfirmCuratedMatch). */
  async function handleWantToListenCuratedEntry(entry: CuratedAlbumEntry): Promise<void> {
    if (!selectedCuratedListId || curatedRatingEntryKey) return;
    const listId = selectedCuratedListId;
    const entryKey = curatedEntryKey(listId, entry);
    curatedRateMessage = null;
    curatedPendingMatch = null;

    if (entry.resolved) {
      lists = addToList(lists, entry.resolved, 'wantToListen');
      persistLists();
      renderCuratedListsView();
      return;
    }

    const outcome = await searchCuratedEntry(entry, listId, entryKey);
    if (outcome.status === 'stale') return;
    if (outcome.status === 'not-found') {
      curatedRateMessage = { key: entryKey, text: `Could not find "${entry.title}" by ${entry.artist}.` };
      renderCuratedListsView();
      return;
    }
    curatedPendingMatch = { key: entryKey, album: outcome.album, kind: 'wantToListen' };
    renderCuratedListsView();
  }

  function renderCuratedListsView(): void {
    const unranked = selectedCuratedListId
      ? unrankedFromCuratedList(CURATED_LISTS[selectedCuratedListId].albums, state.ranked, {
          listId: selectedCuratedListId,
          skippedKeys: curatedSkips,
          blockedArtists,
        })
      : [];
    renderCuratedListView(stage, {
      lists: CURATED_LISTS,
      selectedListId: selectedCuratedListId,
      unranked,
      onSelectList: handleSelectCuratedList,
      onRateAlbum: (entry, rating) => {
        void handleRateCuratedAlbum(entry, rating);
      },
      onSkipEntry: (entry) => {
        if (selectedCuratedListId) handleSkipCuratedEntry(selectedCuratedListId, entry);
      },
      onHideArtist: handleHideCuratedArtist,
      onWantToListen: (entry) => {
        void handleWantToListenCuratedEntry(entry);
      },
      ratingEntryKey: curatedRatingEntryKey,
      rateMessage: curatedRateMessage,
      pendingMatch: curatedPendingMatch,
      onConfirmMatch: handleConfirmCuratedMatch,
      onCancelMatch: handleCancelCuratedMatch,
    });
  }

  function showView(next: ViewMode): void {
    // Leaving the drag view: cancel any in-flight drag / listeners.
    if (view === 'ranked' && next !== 'ranked') {
      rankList.teardown();
    }
    if (view === 'artistBatch' && next !== 'artistBatch') {
      artistBatchController?.teardown();
    }
    if (view === 'speedRound' && next !== 'speedRound') {
      speedRoundController?.teardown();
    }
    view = next;

    if (view === 'ranked') {
      rankList.render();
    } else if (view === 'blockedArtists') {
      renderBlockedArtists();
    } else if (view === 'artistBatch') {
      renderArtistBatchView();
    } else if (view === 'speedRound') {
      renderSpeedRound();
    } else if (view === 'curatedLists') {
      renderCuratedListsView();
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
  }

  /** Download the current ranking + lists as a standalone JSON file --
   *  createRankingBackup/parseRankingBackup already existed (backup.ts,
   *  fully tested) from the old restore-code flow but had nothing wiring
   *  them into the UI. An independent recovery point outside whatever
   *  browser/device this session is in, doesn't depend on server sync. */
  function handleExportBackup(): void {
    const json = createRankingBackup(state, lists);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `album-case-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderNav(): void {
    nav.textContent = '';
    const items: Array<{ mode: ViewMode; label: string }> = [
      { mode: 'ranked', label: `Ranked list (${state.ranked.length})` },
      { mode: 'wantToListen', label: `Want to listen (${lists.wantToListen.length})` },
      { mode: 'notHeard', label: `Haven't heard (${lists.notHeard.length})` },
      { mode: 'dontCare', label: `Don't care (${lists.dontCare.length})` },
      { mode: 'blockedArtists', label: `Blocked artists (${blockedArtists.length})` },
      { mode: 'speedRound', label: 'Voice speed round' },
      { mode: 'curatedLists', label: 'Curated lists' },
    ];

    for (const { mode, label } of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = mode === view ? 'view-tab view-tab-active' : 'view-tab';
      btn.textContent = label;
      btn.addEventListener('click', () => showView(mode));
      nav.append(btn);
    }

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

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'view-tab';
    exportBtn.textContent = 'Export backup';
    exportBtn.title = 'Download your ranking and lists as a JSON file';
    exportBtn.addEventListener('click', handleExportBackup);
    nav.append(exportBtn);
  }

  renderNav();
}

if (typeof document !== 'undefined') {
  void main();
}
