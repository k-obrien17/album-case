import type { Album, ArtistLock, RankedAlbum, RankingState } from './ranking/types';
import { allSavedAlbums, mergeRefresherIntoWantToListen, type SavedLists } from './lists';
import type { Session } from './session';
import { createRankingBackup } from './backup';
import { saveRanking } from './storage';
import { saveLists } from './lists';
import { saveArtistLocks } from './artistLocksStorage';
import { saveBlockedArtists } from './artistBlocks';
import { saveCuratedSkips } from './curatedSkipsStorage';
import { loadRankingSnapshotDetailed, saveRankingSnapshot } from './rankingSync';
import { setWriteKey } from './writeKey';
import { saveSkippedAlbums } from './skippedAlbums';
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

// parseAlbum (album.ts) never OMITS cover_url/release_year -- unlike a
// genuinely-optional field (primary_artist_mbid, genres), a stored album
// with no known cover/year still carries cover_url: '' / release_year: null,
// so the default "stored album's own keys win" spread below can never let a
// fresher pool value through for these two. Override them specifically,
// preferring the pool's value only when the stored one is falsy, while every
// other field keeps the existing stored-wins precedence.
export function hydrateAlbums<T extends Album>(albums: T[], byId: Map<string, Album>): T[] {
  return albums.map((album) => {
    const pooled = byId.get(album.mbid);
    return {
      ...(pooled ?? {}),
      ...album,
      cover_url: album.cover_url || pooled?.cover_url || album.cover_url,
      release_year: album.release_year ?? pooled?.release_year ?? null,
    };
  });
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
  skippedAlbums: string[];
  baseUpdatedAt: number | null | undefined;
}

export type SyncSnapshotResult =
  | { outcome: 'saved'; updatedAt: number }
  | { outcome: 'conflict' }
  /** Needs a write key; stop retrying until the user unlocks. */
  | { outcome: 'locked'; nextBaseUpdatedAt: number | null | undefined }
  /** The server permanently refuses this snapshot; stop retrying. */
  | { outcome: 'rejected'; httpStatus: number; nextBaseUpdatedAt: number | null | undefined }
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
    resolvedBase,
    input.skippedAlbums
  );

  if (result.status === 'saved') {
    return { outcome: 'saved', updatedAt: result.updatedAt };
  }
  if (result.status === 'conflict') return { outcome: 'conflict' };
  if (result.status === 'locked') return { outcome: 'locked', nextBaseUpdatedAt: resolvedBase };
  if (result.status === 'rejected') {
    return { outcome: 'rejected', httpStatus: result.httpStatus, nextBaseUpdatedAt: resolvedBase };
  }
  // 'error' (network/server): the base we resolved is still presumed valid,
  // so it carries forward unchanged for the next retry.
  return {
    outcome: 'pending',
    nextBaseUpdatedAt: resolvedBase,
  };
}

const SYNC_RETRY_MS = 4000;

function unionStrings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

export type SyncEngineDeps = {
  session: Session;
  getState: () => RankingState;
  getLists: () => SavedLists;
  getArtistLocks: () => ArtistLock[];
  getBlockedArtists: () => string[];
  getCuratedSkips: () => Set<string>;
  /** Albums the owner removed for good; saved with the snapshot so a new
   *  device or a discarded conflict cannot bring them back. */
  getSkippedAlbums: () => Set<string>;
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
  persistSkippedAlbums: () => void;
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
 * (session/pool/server-snapshot loading) now lives in bootstrap.ts's
 * bootstrapApp(), which main.ts calls before constructing this engine and
 * hands it the resolved seed `baseUpdatedAt`.
 */
export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  let snapshotBaseUpdatedAt = deps.baseUpdatedAt;
  let snapshotSaveChain: Promise<void> = Promise.resolve();
  let saveRevision = 0;
  let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  // Set when a save can't succeed by retrying: the server wants a write key
  // ('locked') or permanently refuses this snapshot ('rejected'). While set,
  // the retry loop is stopped and the banner says so instead of "Retrying...".
  let syncProblem: { kind: 'locked' } | { kind: 'rejected'; httpStatus: number } | null = null;
  // True when the server holds a newer revision than this tab last saw and
  // there is nothing unsaved locally, so reloading is safe and lossless.
  let serverAhead = false;

  // Visible, persistent (not a transient rankList.showStatus toast) warning
  // for a save that hasn't reached the server yet -- e.g. a network hiccup.
  const bannerElement = document.createElement('p');
  bannerElement.className = 'sync-banner';
  bannerElement.setAttribute('role', 'status');
  bannerElement.setAttribute('aria-live', 'polite');
  bannerElement.hidden = true;

  function exportBackup(): void {
    const json = createRankingBackup(deps.getState(), deps.getLists(), {
      blocked_artists: deps.getBlockedArtists(),
      curated_skips: [...deps.getCuratedSkips()],
      skipped_albums: [...deps.getSkippedAlbums()],
      artist_locks: deps.getArtistLocks(),
    });
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

  function bannerButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'view-tab';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function adoptServerCopy(fresh: Extract<Awaited<ReturnType<typeof loadRankingSnapshotDetailed>>, { status: 'found' }>): void {
    // Hidden artists, curated skips and removed albums only ever grow, so keep
    // everything hidden on either side instead of letting the server copy
    // erase hides made here. Anything only this browser had is saved right
    // after the reload.
    const blocked = unionStrings(deps.getBlockedArtists(), fresh.blockedArtists);
    const curated = unionStrings([...deps.getCuratedSkips()], fresh.curatedSkips);
    const skipped = unionStrings([...deps.getSkippedAlbums()], fresh.skippedAlbums);
    const hasLocalOnly =
      blocked.length > fresh.blockedArtists.length ||
      curated.length > fresh.curatedSkips.length ||
      skipped.length > fresh.skippedAlbums.length;
    saveRanking({ ranked: fresh.ranked, pending: null });
    saveLists(fresh.lists);
    saveArtistLocks(fresh.artistLocks);
    saveBlockedArtists(blocked);
    saveCuratedSkips(curated);
    saveSkippedAlbums(new Set(skipped));
    saveSyncBase(fresh.updatedAt);
    clearSyncConflict();
    if (hasLocalOnly) markPendingSync();
    else clearPendingSync();
    window.location.reload();
  }

  function renderUnlockControls(): void {
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'sync-key-input';
    input.autocomplete = 'off';
    input.placeholder = 'Write key';
    input.setAttribute('aria-label', 'Write key');
    const unlock = () => {
      if (!input.value.trim()) return;
      setWriteKey(input.value);
      syncProblem = null;
      updateSyncBanner();
      queueSave();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') unlock();
    });
    bannerElement.append(input, bannerButton('Unlock & save', unlock), bannerButton('Export unsaved backup', exportBackup));
  }

  function updateSyncBanner(): void {
    const unsaved = hasPendingSync();
    if (!unsaved && !serverAhead) {
      bannerElement.hidden = true;
      bannerElement.textContent = '';
      return;
    }
    bannerElement.hidden = false;
    if (!unsaved && serverAhead) {
      bannerElement.textContent = 'The saved copy changed on another device. Reload to see the latest.';
      bannerElement.append(bannerButton('Reload', () => window.location.reload()));
      return;
    }
    if (hasSyncConflict()) {
      bannerElement.textContent = 'The saved copy changed in another tab or device. Your unsaved work is kept here. Export it before discarding it.';
      const reload = bannerButton('Discard unsaved changes & load saved copy', () => {
        // Two taps: the first only arms the button, so a stray tap can't
        // throw away unsaved work.
        if (reload.dataset.armed !== '1') {
          reload.dataset.armed = '1';
          reload.textContent = 'Tap again to discard your unsaved changes';
          return;
        }
        void (async () => {
          reload.disabled = true;
          const fresh = await loadRankingSnapshotDetailed(deps.session.session_id);
          if (fresh.status !== 'found') {
            reload.disabled = false;
            reload.dataset.armed = '';
            reload.textContent = 'Could not load saved copy. Try again';
            return;
          }
          adoptServerCopy(fresh);
        })();
      });
      bannerElement.append(bannerButton('Export unsaved backup', exportBackup), reload);
      return;
    }
    if (syncProblem?.kind === 'locked') {
      bannerElement.textContent = 'Saving is locked on this device. Your changes are kept here, not saved. Enter the write key to save them.';
      renderUnlockControls();
      return;
    }
    if (syncProblem?.kind === 'rejected') {
      bannerElement.textContent = `The server refused to save your list (error ${syncProblem.httpStatus}). Your changes are kept here, not saved. Export a backup.`;
      bannerElement.append(bannerButton('Export unsaved backup', exportBackup));
      return;
    }
    bannerElement.textContent = 'Not saved to the server yet. Retrying...';
  }

  // Stale-tab detection used to happen only on the next write. When the tab
  // comes back into view (or the network returns) with nothing unsaved,
  // compare against the server and offer a lossless reload if it moved on.
  async function checkServerAhead(): Promise<void> {
    if (hasPendingSync() || syncProblem || typeof snapshotBaseUpdatedAt !== 'number') return;
    const fresh = await loadRankingSnapshotDetailed(deps.session.session_id);
    if (fresh.status !== 'found' || hasPendingSync()) return;
    const ahead = typeof snapshotBaseUpdatedAt === 'number' && fresh.updatedAt > snapshotBaseUpdatedAt;
    if (ahead !== serverAhead) {
      serverAhead = ahead;
      updateSyncBanner();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkServerAhead();
    });
    window.addEventListener('online', () => void checkServerAhead());
  }

  async function syncRankingSnapshot(): Promise<void> {
    // Nothing outstanding -- e.g. a queued retry fired after an earlier
    // call in the chain already resolved things. Skip the redundant round-trip.
    if (!hasPendingSync() || hasSyncConflict() || syncProblem) return;
    const revision = saveRevision;

    const result = await performRankingSync({
      sessionId: deps.session.session_id,
      state: deps.getState(),
      lists: deps.getLists(),
      artistLocks: deps.getArtistLocks(),
      blockedArtists: deps.getBlockedArtists(),
      curatedSkips: [...deps.getCuratedSkips()],
      skippedAlbums: [...deps.getSkippedAlbums()],
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
    } else if (result.outcome === 'locked' || result.outcome === 'rejected') {
      // Retrying can't fix either: stop the loop and tell the user why.
      syncProblem = result.outcome === 'locked' ? { kind: 'locked' } : { kind: 'rejected', httpStatus: result.httpStatus };
      snapshotBaseUpdatedAt = result.nextBaseUpdatedAt;
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

  function retryRejectedOnEdit(): void {
    if (syncProblem?.kind === 'rejected') syncProblem = null;
    serverAhead = false;
  }

  function queueSave(): void {
    saveRevision += 1;
    snapshotSaveChain = snapshotSaveChain.then(syncRankingSnapshot, syncRankingSnapshot);
    void snapshotSaveChain;
  }

  function persistRankingState(): void {
    retryRejectedOnEdit();
    saveRanking(deps.getState());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistLists(): void {
    retryRejectedOnEdit();
    saveLists(deps.getLists());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistBlockedArtists(): void {
    retryRejectedOnEdit();
    saveBlockedArtists(deps.getBlockedArtists());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistSkippedAlbums(): void {
    retryRejectedOnEdit();
    saveSkippedAlbums(deps.getSkippedAlbums());
    markPendingSync();
    updateSyncBanner();
    queueSave();
  }

  function persistCuratedSkips(): void {
    retryRejectedOnEdit();
    saveCuratedSkips([...deps.getCuratedSkips()]);
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
    persistSkippedAlbums,
    updateSyncBanner,
    exportBackup,
    bannerElement,
  };
}
