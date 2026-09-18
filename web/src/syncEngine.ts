import type { Album, ArtistLock, RankedAlbum, RankingState } from './ranking/types';
import { allSavedAlbums, mergeRefresherIntoWantToListen, type SavedLists } from './lists';
import type { Session } from './session';
import { createRankingBackup } from './backup';
import { saveRanking } from './storage';
import { saveLists } from './lists';
import { saveArtistLocks } from './artistLocksStorage';
import { saveBlockedArtists } from './artistBlocks';
import { loadRankingSnapshotDetailed, saveRankingSnapshot } from './rankingSync';
import {
  clearPendingSync,
  hasPendingSync,
  markPendingSync,
  clearSyncConflict,
  hasSyncConflict,
  markSyncConflict,
  saveSyncBase,
} from './syncStatus';

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
      lists: mergeRefresherIntoWantToListen(serverSnapshot.lists),
      artistLocks: serverSnapshot.artistLocks,
      fromServer: true,
    };
  }
  return { state: cached.state, lists: mergeRefresherIntoWantToListen(cached.lists), artistLocks: cached.artistLocks, fromServer: false };
}

function snapshotAlbumCount(snapshot: { ranked: Album[]; lists: SavedLists }): number {
  return (
    snapshot.ranked.length +
    allSavedAlbums(snapshot.lists).length + (snapshot.lists.backlog?.pendingReview?.length ?? 0)
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
    ...lists,
    wantToListen: hydrateAlbums(lists.wantToListen, byId),
    notHeard: hydrateAlbums(lists.notHeard, byId),
    dontCare: hydrateAlbums(lists.dontCare, byId),
    ...(lists.backlog && { backlog: {
      ...lists.backlog,
      readyToRank: hydrateAlbums(lists.backlog.readyToRank, byId),
      needsRefresher: hydrateAlbums(lists.backlog.needsRefresher, byId),
      ...(lists.backlog.pendingReview && { pendingReview: hydrateAlbums(lists.backlog.pendingReview, byId) }),
    } }),
  };
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
  | { outcome: 'conflict' }
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
 *  ship-check backlog. `syncRankingSnapshot` (in `createSyncEngine` below) is
 *  a thin side-effecting wrapper that applies the result to engine state. */
export async function performRankingSync(
  input: SyncSnapshotInput,
  deps: SyncSnapshotDeps = defaultSyncSnapshotDeps
): Promise<SyncSnapshotResult> {
  let resolvedBase = input.baseUpdatedAt;

  if (resolvedBase === undefined) {
    // With no known base, only a missing snapshot is safe to create. A
    // fresh version number does not make stale local content safe to save.
    const fresh = await deps.loadFresh(input.sessionId);
    if (fresh.status === 'found') {
      return { outcome: 'conflict' };
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
  if (result.status === 'conflict') return { outcome: 'conflict' };
  // 'error' (network/server): the base we resolved is still presumed valid,
  // so it carries forward unchanged for the next retry.
  return {
    outcome: 'pending',
    nextBaseUpdatedAt: resolvedBase,
  };
}

const SYNC_RETRY_MS = 4000;

export type SyncEngineDeps = {
  session: Session;
  getState: () => RankingState;
  getLists: () => SavedLists;
  getArtistLocks: () => ArtistLock[];
  getBlockedArtists: () => string[];
  getCuratedSkips: () => Set<string>;
  /** Seeded from the bootstrap load-on-open flow in main.ts. */
  baseUpdatedAt: number | null | undefined;
};

export type SyncEngine = {
  /** Was `queueRankingSnapshotSync`: the single choke point every mutation
   *  handler funnels through. Chains onto any in-flight save so a later call
   *  always ships the current state, never a stale queued one. */
  queueSave: () => void;
  persistRankingState: () => void;
  persistLists: () => void;
  persistBlockedArtists: () => void;
  persistCuratedSkips: () => void;
  updateSyncBanner: () => void;
  exportBackup: () => void;
  /** Append this wherever the banner belongs in the DOM; the engine owns and
   *  mutates it internally from then on. */
  bannerElement: HTMLElement;
};

/**
 * Owns the steady-state save/retry/banner engine: the in-memory sync state
 * (save chain, revision counter, retry timer, base version, banner DOM) that
 * used to live as closure locals in main()'s `main()` function. Bootstrap
 * (session/pool/server-snapshot loading) stays in main.ts -- it's tangled
 * with the priority-queue/discovery bootstrap in a way that isn't safe to
 * disentangle in this pass -- and hands this engine its seed `baseUpdatedAt`
 * once the initial state is resolved.
 */
export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  let snapshotBaseUpdatedAt = deps.baseUpdatedAt;
  let snapshotSaveChain: Promise<void> = Promise.resolve();
  let saveRevision = 0;
  let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // Visible, persistent (not a transient rankList.showStatus toast) warning
  // for a save that hasn't reached the server yet -- e.g. a network hiccup.
  const bannerElement = document.createElement('p');
  bannerElement.className = 'sync-banner';
  bannerElement.hidden = true;

  function exportBackup(): void {
    const json = createRankingBackup(deps.getState(), deps.getLists());
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

  // Write-key enforcement is dropped for now, so the only thing left to
  // warn about is a genuine save failure (network/server), not a locked
  // session -- there's no more "locked" state.
  function updateSyncBanner(): void {
    if (!hasPendingSync()) {
      bannerElement.hidden = true;
      bannerElement.textContent = '';
      return;
    }
    bannerElement.hidden = false;
    if (hasSyncConflict()) {
      bannerElement.textContent = 'The saved copy changed in another tab or device. Your unsaved work is kept here. Export it before discarding it.';
      const backup = document.createElement('button');
      backup.className = 'view-tab';
      backup.textContent = 'Export unsaved backup';
      backup.addEventListener('click', exportBackup);
      const reload = document.createElement('button');
      reload.className = 'view-tab';
      reload.textContent = 'Discard unsaved changes & load saved copy';
      reload.addEventListener('click', () => {
        void (async () => {
          reload.disabled = true;
          const fresh = await loadRankingSnapshotDetailed(deps.session.session_id);
          if (fresh.status !== 'found') {
            reload.disabled = false;
            reload.textContent = 'Could not load saved copy. Try again';
            return;
          }
          saveRanking({ ranked: fresh.ranked, pending: null });
          saveLists(fresh.lists);
          saveArtistLocks(fresh.artistLocks);
          saveBlockedArtists(fresh.blockedArtists);
          saveSyncBase(fresh.updatedAt);
          clearSyncConflict();
          clearPendingSync();
          window.location.reload();
        })();
      });
      bannerElement.append(backup, reload);
      return;
    }
    bannerElement.textContent = 'Not saved to the server yet. Retrying...';
  }

  async function syncRankingSnapshot(): Promise<void> {
    // Nothing outstanding -- e.g. a queued retry fired after an earlier
    // call in the chain already resolved things. Skip the redundant round-trip.
    if (!hasPendingSync() || hasSyncConflict()) return;
    const revision = saveRevision;

    const result = await performRankingSync({
      sessionId: deps.session.session_id,
      state: deps.getState(),
      lists: deps.getLists(),
      artistLocks: deps.getArtistLocks(),
      blockedArtists: deps.getBlockedArtists(),
      curatedSkips: [...deps.getCuratedSkips()],
      baseUpdatedAt: snapshotBaseUpdatedAt,
    });

    if (result.outcome === 'saved') {
      snapshotBaseUpdatedAt = result.updatedAt;
      saveSyncBase(result.updatedAt);
      // Another decision may have arrived while this request was in flight.
      // Its queued save must still run against the newly acknowledged version.
      if (revision === saveRevision) clearPendingSync();
    } else if (result.outcome === 'conflict') {
      markSyncConflict();
      markPendingSync();
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
      queueSave();
    }, SYNC_RETRY_MS);
  }

  function queueSave(): void {
    saveRevision += 1;
    snapshotSaveChain = snapshotSaveChain.then(syncRankingSnapshot, syncRankingSnapshot);
    void snapshotSaveChain;
  }

  function persistRankingState(): void {
    saveRanking(deps.getState());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistLists(): void {
    saveLists(deps.getLists());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistBlockedArtists(): void {
    saveBlockedArtists(deps.getBlockedArtists());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistCuratedSkips(): void {
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  return {
    queueSave,
    persistRankingState,
    persistLists,
    persistBlockedArtists,
    persistCuratedSkips,
    updateSyncBanner,
    exportBackup,
    bannerElement,
  };
}
