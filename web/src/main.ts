import './style.css';
import type { Album, RankingState } from './ranking/types';
import { insertAt, moveItem } from './ranking/order';
import { setAsideAlbum } from './ranking/setAside';
import { loadSeedPool, loadPreferredArtists, playsMapFromPreferred, pickCandidate } from './seed';
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
  nextPriorityCandidate,
  priorityQueueFromArtists,
  savePriorityQueue,
} from './priority';
import { loadRankingSnapshot, saveRankingSnapshot } from './rankingSync';
import { loadDiscoveredAlbums, discoverArtist } from './discovery';
import {
  addBlockedArtist,
  blockedArtistMbids,
  loadBlockedArtists,
  removeBlockedArtist,
  saveBlockedArtists,
} from './artistBlocks';

type ViewMode = 'ranked' | ListName | 'blockedArtists';

type RestoreSnapshot = { state: RankingState; lists: SavedLists };

/**
 * Outcome of attempting to restore a ranking from a session code. Retained as
 * a tested module (the UI no longer surfaces restore codes -- Taste Test is a
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
  serverSnapshot: { ranked: Album[]; lists: SavedLists } | null,
  cached: { state: RankingState; lists: SavedLists }
): { state: RankingState; lists: SavedLists; fromServer: boolean } {
  if (serverSnapshot) {
    return {
      state: { ranked: serverSnapshot.ranked, pending: null },
      lists: serverSnapshot.lists,
      fromServer: true,
    };
  }
  return { state: cached.state, lists: cached.lists, fromServer: false };
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
  let blockedArtists = loadBlockedArtists();
  const serverSnapshot = await loadRankingSnapshot(OWNER_ID);
  const discovered = await loadDiscoveredAlbums(OWNER_ID);
  const knownPoolIds = new Set(pool.map((album) => album.mbid));
  for (const album of discovered) {
    if (!knownPoolIds.has(album.mbid)) {
      pool.push(album);
      knownPoolIds.add(album.mbid);
    }
  }
  const initial = resolveInitialState(serverSnapshot, {
    state: cachedState,
    lists: cachedLists,
  });
  let state: RankingState = initial.state;
  let lists: SavedLists = initial.lists;
  if (initial.fromServer) {
    saveRanking(state);
    saveLists(lists);
  } else if (
    state.ranked.length > 0 ||
    lists.wantToListen.length > 0 ||
    lists.notHeard.length > 0 ||
    lists.dontCare.length > 0
  ) {
    void saveRankingSnapshot(session.session_id, state, lists);
  }

  // First-visit correctness: an empty list plus a first candidate, never a
  // blank screen. Priority albums are offered first; random eligible albums
  // are the fallback.
  let candidate: Album | null = null;

  // Session-only "Skip for now" set: deferred albums are excluded from
  // selection but NEVER written to the saved lists or excludedMbids. When the
  // fresh pool drains, deferred albums are re-offered (see reselectCandidate)
  // rather than showing "you've placed everything" prematurely.
  const deferred = new Set<string>();

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const heading = document.createElement('h1');
  heading.className = 'app-heading';
  heading.textContent = 'Taste Test';

  const nav = document.createElement('nav');
  nav.className = 'view-switcher';

  const stage = document.createElement('div');
  stage.className = 'app-stage';

  shell.append(heading, nav, stage);
  app.textContent = '';
  app.append(shell);

  let view: ViewMode = 'ranked';

  function pickFrom(excluded: Set<string>): Album | null {
    const priority = nextPriorityCandidate(priorityQueue, pool, state.ranked, excluded);
    priorityQueue = priority.queue;
    savePriorityQueue(priorityQueue);
    return (
      priority.candidate ?? pickCandidate(pool, state.ranked, excluded, Math.random, playsByArtist)
    );
  }

  function reselectCandidate(): void {
    // Selection excludes set-aside lists AND session-deferred skips.
    const excluded = excludedMbids(lists);
    for (const mbid of blockedArtistMbids(pool, blockedArtists)) excluded.add(mbid);
    for (const mbid of deferred) excluded.add(mbid);
    candidate = pickFrom(excluded);

    // Fresh pool drained but skips remain: rotate deferred back in rather than
    // declaring the pool finished. Skips are a soft "later", not a set-aside.
    if (!candidate && deferred.size > 0) {
      deferred.clear();
      const retryExcluded = excludedMbids(lists);
      for (const mbid of blockedArtistMbids(pool, blockedArtists)) retryExcluded.add(mbid);
      candidate = pickFrom(retryExcluded);
    }
  }

  function persistRankingState(): void {
    saveRanking(state);
    void saveRankingSnapshot(session.session_id, state, lists);
  }

  function persistLists(): void {
    saveLists(lists);
    void saveRankingSnapshot(session.session_id, state, lists);
  }

  function removeBlockedFromPriorityQueue(): void {
    const blockedIds = blockedArtistMbids(pool, blockedArtists);
    priorityQueue = priorityQueue.filter((mbid) => !blockedIds.has(mbid));
    savePriorityQueue(priorityQueue);
  }

  function handleBlockArtist(album: Album): void {
    blockedArtists = addBlockedArtist(blockedArtists, album.primary_artist_name);
    saveBlockedArtists(blockedArtists);
    deferred.delete(album.mbid);
    removeBlockedFromPriorityQueue();
    reselectCandidate();
    rankList.showStatus(`No more ${album.primary_artist_name} albums.`);
    renderNav();
  }

  async function handleDiscoverArtist(album: Album): Promise<void> {
    const artistName = album.primary_artist_name;
    const knownMbids = pool
      .filter((a) => a.primary_artist_name === artistName)
      .map((a) => a.mbid);

    const found = await discoverArtist(session.session_id, artistName, knownMbids);
    if (found.length === 0) {
      rankList.showStatus(`No more ${artistName} albums found.`);
      return;
    }

    const poolIds = new Set(pool.map((a) => a.mbid));
    const newToPool = found.filter((a) => !poolIds.has(a.mbid));
    pool.push(...newToPool);

    priorityQueue = [...found.map((a) => a.mbid), ...priorityQueue];
    savePriorityQueue(priorityQueue);
    reselectCandidate();
    rankList.render();
  }

  reselectCandidate();

  const rankList = mountRankList(stage, {
    getRanked: () => state.ranked,
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

      state = { ranked: insertAt(before, placed, clamped), pending: null };
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onReorder: (from, to) => {
      state = { ranked: moveItem(state.ranked, from, to), pending: null };
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
      // Non-destructive: defer for this session only. Not saved to any list,
      // not added to excludedMbids, not persisted -- it reappears on drain.
      deferred.add(album.mbid);
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
    view = next;

    if (view === 'ranked') {
      rankList.render();
    } else if (view === 'blockedArtists') {
      renderBlockedArtists();
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
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
  }

  renderNav();
}

if (typeof document !== 'undefined') {
  void main();
}
