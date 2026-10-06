import './style.css';
import type { Album, RankingState } from './ranking/types';
import { pickCandidate } from './seed';
import { saveRanking } from './storage';
import { filterAlbums } from './search';
import { getOrCreateSession, isValidSessionId } from './session';
import { OWNER_ID } from './owner';
import {
  saveLists,
  addToList,
  removeFromList,
  excludedMbids,
  allSavedAlbums,
  type ListName,
  type SavedLists,
} from './lists';
import { mountRankList, type SearchResultsState } from './ui/rankList';
import { MIN_AUTO_SEARCH_CHARS } from './ui/rankListSearch';
import { createSearchBar } from './ui/searchBar';
import { searchArtists, type ArtistResult } from './artistSearch';
import { mountArtistBatchView } from './ui/artistBatchView';
import { mountSpeedRound } from './ui/speedRound';
import { artistAlbumsFor } from './artistLockAlbums';
import { renderSavedList } from './ui/savedList';
import { enqueueAtom, flushAtomQueue } from './atoms';
import {
  nextPriorityCandidate,
  savePriorityQueue,
} from './priority';
import { discoverArtistDetailed } from './discovery';
import { runBulkDiscovery, runSimilarExpansion, TOP_ARTIST_DISCOVERY_COUNT } from './bulkDiscovery';
import type { SimilarArtist } from './bulkDiscovery';
import { markPendingSync } from './syncStatus';
import {
  addBlockedArtist,
  blockedArtistMbids,
  removeBlockedArtist,
} from './artistBlocks';
import { loadSkippedAlbums, saveSkippedAlbums } from './skippedAlbums';
import { saveArtistLocks } from './artistLocksStorage';
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
import { buildArtistGaps, decideAlbum, albumKey } from './backlog';
import { emptyBacklog } from '../shared/backlog';
import { renderBacklogView, type BacklogShelf } from './ui/backlogView';
import { suggestAlbum, loadSuggestionConnections, type Suggestion, type RelatedArtist } from './suggestions';
import { normalize } from './curatedListMatch';
import { createSyncEngine, resolveInitialState } from './syncEngine';
import { createRankingStore } from './rankingStore';
import { rateAlbum, reRateAt, setRatingAt, directRate, setAside, placeAt } from './rankingActions';
import { bootstrapApp } from './bootstrap';

type ViewMode = 'ranked' | ListName | 'blockedArtists' | 'artistBatch' | 'speedRound' | 'curatedLists' | 'backlog';

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

// reRate/insertAtRating/addSearchedAlbum/setRating now live in
// rankingActions.ts alongside the store-aware action functions built on
// top of them (rateAlbum/reRateAt/setRatingAt/directRate/setAside/
// placeAt) -- re-exported here so existing test imports (main.test.ts,
// backlog.test.ts) don't need to change.
export { reRate, insertAtRating, addSearchedAlbum, setRating } from './rankingActions';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
  }

  const session = getOrCreateSession();
  void flushAtomQueue();

  const bootstrap = await bootstrapApp(OWNER_ID);
  const pool = bootstrap.pool;
  let priorityQueue = bootstrap.priorityQueue;
  const preferred = bootstrap.preferred;
  const playsByArtist = bootstrap.playsByArtist;
  const cachedState = bootstrap.cachedState;
  const cachedLists = bootstrap.cachedLists;
  const cachedArtistLocks = bootstrap.cachedArtistLocks;
  const pendingSync = bootstrap.pendingSync;
  const blockedArtists = bootstrap.blockedArtists;
  const curatedSkips = bootstrap.curatedSkips;
  const serverSnapshot = bootstrap.serverSnapshot;
  const serverLoadStatus = bootstrap.serverLoadStatus;
  const snapshotBaseUpdatedAt = bootstrap.snapshotBaseUpdatedAt;
  const cached = {
    state: cachedState,
    lists: cachedLists,
    artistLocks: cachedArtistLocks,
  };
  // A pending removal or Undo can legitimately leave fewer albums locally.
  // Revision checks above decide conflicts; album counts cannot decide which
  // user's changes to keep.
  const initial = resolveInitialState(pendingSync ? null : serverSnapshot, cached);
  // Owns the ranking-snapshot domain from here on: state/lists/artistLocks/
  // blockedArtists/curatedSkips are no longer closure locals -- see
  // rankingStore.ts's module doc comment. Even an empty review state must
  // travel with new-client writes; this also lets Undo restore the first
  // review action without resembling an old client.
  const rankingStore = createRankingStore({
    state: initial.state,
    lists: { ...initial.lists, backlog: initial.lists.backlog ?? emptyBacklog<Album>() },
    artistLocks: initial.artistLocks,
    blockedArtists,
    curatedSkips,
  });

  // Owns the steady-state save/retry/banner engine (was closure locals here
  // in main()); bootstrap above now lives in bootstrapApp() -- see
  // bootstrap.ts's module doc comment.
  const syncEngine = createSyncEngine({
    session,
    getState: rankingStore.getState,
    getLists: rankingStore.getLists,
    getArtistLocks: rankingStore.getArtistLocks,
    getBlockedArtists: rankingStore.getBlockedArtists,
    getCuratedSkips: rankingStore.getCuratedSkips,
    baseUpdatedAt: snapshotBaseUpdatedAt,
  });

  if (initial.fromServer) {
    saveRanking(rankingStore.getState());
    saveLists(rankingStore.getLists());
    saveArtistLocks(rankingStore.getArtistLocks());
  } else if (
    pendingSync ||
    (serverLoadStatus === 'missing' &&
      (rankingStore.getState().ranked.length > 0 ||
        rankingStore.getLists().wantToListen.length > 0 ||
        rankingStore.getLists().notHeard.length > 0 ||
        rankingStore.getLists().dontCare.length > 0 || !!rankingStore.getLists().backlog))
  ) {
    markPendingSync();
    syncEngine.queueSave();
  }

  // First-visit correctness: an empty list plus a first candidate, never a
  // blank screen. Priority albums are offered first; random eligible albums
  // are the fallback.
  let candidate: Album | null = null;

  // Persisted, permanent excludes: an album the owner explicitly removed
  // from a saved list (see removeFromSavedList) never resurfaces as a
  // candidate, even across reloads.
  const skippedAlbums = loadSkippedAlbums();
  // "Skip for now" (rankList.ts's onSkip / the speed-round wiring below) is
  // session-scoped only, per its own doc comment: kept in memory for the
  // running session so it doesn't resurface immediately, but never
  // persisted -- a fresh page load makes a skipped album eligible again.
  const sessionSkipped = new Set<string>();
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

  // The app-wide search bar shows results in the ranked view. Typing from any
  // other view jumps there and remembers where you came from, so clearing
  // the search (Esc / ×) takes you back.
  let viewBeforeSearch: ViewMode | null = null;
  let autoSearchTimer: ReturnType<typeof setTimeout> | null = null;
  const AUTO_SEARCH_DELAY_MS = 500;

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

  const nav = document.createElement('nav');
  nav.className = 'view-switcher';

  const stage = document.createElement('div');
  stage.className = 'app-stage';

  const searchBar = createSearchBar({
    onInput: handleSearchInput,
    onClear: () => {
      const back = viewBeforeSearch;
      resetSearch();
      if (back && back !== view) showView(back);
      else if (view === 'ranked') rankList.render();
    },
  });

  shell.append(heading, searchBar.element, syncEngine.bannerElement, nav, stage);
  app.textContent = '';
  app.append(shell);

  let view: ViewMode = 'ranked';

  syncEngine.updateSyncBanner();

  function pickFrom(excluded: Set<string>): Album | null {
    const priority = nextPriorityCandidate(priorityQueue, pool, rankingStore.getState().ranked, excluded);
    priorityQueue = priority.queue;
    savePriorityQueue(priorityQueue);
    return (
      priority.candidate ?? pickCandidate(pool, rankingStore.getState().ranked, excluded, Math.random, playsByArtist)
    );
  }

  function reselectCandidate(): void {
    // Selection excludes set-aside lists, skipped albums, and blocked artists.
    let excluded = excludedMbids(rankingStore.getLists());
    for (const mbid of blockedArtistMbids(pool, rankingStore.getBlockedArtists())) excluded.add(mbid);
    for (const mbid of skippedAlbums) excluded.add(mbid);
    for (const mbid of sessionSkipped) excluded.add(mbid);
    excluded = applyArtistCooldown(pool, rankingStore.getState().ranked, excluded, candidateArtistCooldown);
    candidate = pickFrom(excluded);
    candidateArtistCooldown = pushArtistCooldown(candidateArtistCooldown, candidate);
    saveCandidateArtistCooldown(candidateArtistCooldown);
  }

  // Thin delegates so none of this file's ~30 mutation call sites need to
  // change -- the actual save/retry/banner logic now lives in syncEngine.ts.
  function persistRankingState(): void {
    syncEngine.persistRankingState();
  }

  function persistLists(): void {
    syncEngine.persistLists();
  }

  function persistBlockedArtists(): void {
    syncEngine.persistBlockedArtists();
  }

  function persistCuratedSkips(): void {
    syncEngine.persistCuratedSkips();
  }

  function removeBlockedFromPriorityQueue(): void {
    const blockedIds = blockedArtistMbids(pool, rankingStore.getBlockedArtists());
    priorityQueue = priorityQueue.filter((mbid) => !blockedIds.has(mbid));
    savePriorityQueue(priorityQueue);
  }

  function handleBlockArtist(album: Album): void {
    rankingStore.setBlockedArtists(addBlockedArtist(rankingStore.getBlockedArtists(), album.primary_artist_name));
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
      const result = await runBulkDiscovery(rankingStore.getState().ranked, pool, priorityQueue, deps);
      priorityQueue = result.priorityQueue;
      savePriorityQueue(priorityQueue);
      let summary = result.summary;

      // Tier 2: the top artists' own catalogs are exhausted -- expand to
      // similar artists via ListenBrainz. Not when Tier 1 actually found
      // albums.
      if (result.found === 0) {
        const expansion = await runSimilarExpansion(
          rankingStore.getState().ranked,
          pool,
          priorityQueue,
          rankingStore.getBlockedArtists(),
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
      rankingStore.getState().ranked.find((a) => a.primary_artist_mbid === artistMbid) ??
      allSavedAlbums(rankingStore.getLists()).find(
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
      getRanked: () => rankingStore.getState().ranked,
      getLists: () => rankingStore.getLists(),
      getPool: () => pool,
      onReorder: (from, to) => {
        reRateAt(rankingStore, from, to);
        persistRankingState();
        renderArtistBatchView();
      },
      onRemoveRanked: (album) => {
        rememberRemoval();
        setAside(rankingStore, album, 'dontCare');
        persistLists();
        persistRankingState();
        renderArtistBatchView();
        renderNav();
      },
      onUndoRemove: () => {
        if (!undoRemoval()) return;
        renderArtistBatchView();
        renderNav();
      },
      onSetOverallRank: (from, to) => {
        reRateAt(rankingStore, from, to);
        persistRankingState();
        renderArtistBatchView();
      },
      onSetRating: (from, rating) => {
        setRatingAt(rankingStore, from, rating);
        persistRankingState();
        renderArtistBatchView();
      },
      onRate: (album, rating) => {
        rateAlbum(rankingStore, album, rating);
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
    // was null -- same reselect-if-exhausted convention as rateFromSavedList /
    // restoreArtist / the old artist-search flow this replaces.
    if (!candidate) reselectCandidate();

    resetSearch();
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
        directRate(rankingStore, album, rating);
        persistLists();
        persistRankingState();
        reselectCandidate();
        renderSpeedRound();
        renderNav();
      },
      onSkip: (album) => {
        sessionSkipped.add(album.mbid);
        reselectCandidate();
        renderSpeedRound();
      },
      onClose: () => {
        showView('ranked');
      },
    });
  }

  reselectCandidate();

  // The list as it was before the last ranked-row removal (×), for its Undo
  // toast. Same whole-state snapshot approach as backlogUndo.
  let removeUndo: { state: RankingState; lists: SavedLists } | null = null;

  function rememberRemoval(): void {
    removeUndo = { state: rankingStore.getState(), lists: rankingStore.getLists() };
  }

  function undoRemoval(): boolean {
    if (!removeUndo) return false;
    rankingStore.setState(removeUndo.state);
    rankingStore.setLists(removeUndo.lists);
    removeUndo = null;
    persistLists();
    persistRankingState();
    return true;
  }

  function handleSearchInput(query: string): void {
    searchQuery = query;
    searchResults = { status: 'idle' }; // a new query invalidates old results
    artistSelectMessage = null; // and any leftover band-selection message
    if (autoSearchTimer) clearTimeout(autoSearchTimer);
    autoSearchTimer = null;

    const trimmed = query.trim();
    if (trimmed && view !== 'ranked') {
      viewBeforeSearch = view;
      showView('ranked');
    } else {
      rankList.render();
    }

    // Search new albums once typing pauses. runMusicBrainzSearch discards a
    // response if the query has moved on by the time it lands.
    if (trimmed.length >= MIN_AUTO_SEARCH_CHARS) {
      autoSearchTimer = setTimeout(() => {
        autoSearchTimer = null;
        if (view === 'ranked' && searchQuery.trim() === trimmed) runMusicBrainzSearch(trimmed);
      }, AUTO_SEARCH_DELAY_MS);
    }
  }

  /** Clears the query, results, pending auto-search and the bar's text. Does
   *  not render or navigate; callers do. */
  function resetSearch(): void {
    if (autoSearchTimer) clearTimeout(autoSearchTimer);
    autoSearchTimer = null;
    searchQuery = '';
    searchResults = { status: 'idle' };
    artistSelectMessage = null;
    viewBeforeSearch = null;
    searchBar.setValue('');
  }

  function runMusicBrainzSearch(query: string, options: { live?: boolean } = {}): void {
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
          const liveParam = options.live ? '&live=1' : '';
          const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}${liveParam}`);
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
    getRanked: () => filterAlbums(rankingStore.getState().ranked, searchQuery),
    getGlobalRanked: () => rankingStore.getState().ranked,
    getSearchQuery: () => searchQuery,
    onSearchMusicBrainz: runMusicBrainzSearch,
    getSearchResults: () => searchResults,
    onRateSearchResult: (album, rating) => {
      rateAlbum(rankingStore, album, rating);

      resetSearch();
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
      const before = rankingStore.getState().ranked;
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

      placeAt(rankingStore, before, placed, clamped);
      persistLists();
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onReorder: (from, to) => {
      reRateAt(rankingStore, from, to);
      persistRankingState();
      rankList.render();
    },
    onRemoveRanked: (album) => {
      rememberRemoval();
      setAside(rankingStore, album, 'dontCare');
      persistLists();
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onUndoRemove: () => {
      if (!undoRemoval()) return;
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    // Artist locks are paused (not enforced) -- see ranking/locks.ts's header
    // comment. This just moves to the requested index, no clamping.
    onSetOverallRank: (from, to) => {
      reRateAt(rankingStore, from, to);
      persistRankingState();
      rankList.render();
    },
    onSetRating: (from, rating) => {
      setRatingAt(rankingStore, from, rating);
      persistRankingState();
      rankList.render();
    },
    // Unlike onPlace, this does not enqueue any pairwise atoms -- no
    // comparison actually happened, so there's no winner/loser pair to log.
    onDirectRate: (rating) => {
      if (!candidate) return;
      directRate(rankingStore, candidate, rating);
      persistLists();
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onSetAside: (album, which) => {
      // setAside records to the saved list first (so it is excluded), then
      // drops it from ranking state, then this picks the next candidate.
      setAside(rankingStore, album, which);
      persistLists();
      persistRankingState();
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onSkip: (album) => {
      sessionSkipped.add(album.mbid);
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
      const grouped = artistAlbumsFor(album.primary_artist_mbid, rankingStore.getState().ranked, rankingStore.getLists(), pool);
      return grouped.ranked.length + grouped.unranked.length;
    },
  });

  function rateFromSavedList(album: Album, which: ListName, rating: number): void {
    rateAlbum(rankingStore, album, rating);
    persistRankingState();
    persistLists();
    reselectCandidate();
    renderNav();
    renderCurrentSavedList(which);
  }

  function removeFromSavedList(album: Album, which: ListName): void {
    rankingStore.setLists(removeFromList(rankingStore.getLists(), album.mbid, which));
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
      rankingStore.getLists()[which],
      (album, rating) => rateFromSavedList(album, which, rating),
      (album) => removeFromSavedList(album, which)
    );
  }

  function restoreArtist(artistName: string): void {
    rankingStore.setBlockedArtists(removeBlockedArtist(rankingStore.getBlockedArtists(), artistName));
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
    rankingStore.getCuratedSkips().delete(entryKey);
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

    if (rankingStore.getBlockedArtists().length === 0 && rankingStore.getCuratedSkips().size === 0) {
      const empty = document.createElement('p');
      empty.className = 'saved-empty';
      empty.textContent = 'No blocked artists or skipped albums.';
      stage.append(empty);
      return;
    }

    if (rankingStore.getBlockedArtists().length > 0) {
      const heading = document.createElement('p');
      heading.className = 'curated-list-status';
      heading.textContent = 'Blocked artists';
      stage.append(heading);

      const list = document.createElement('ul');
      list.className = 'saved-list';
      for (const artist of rankingStore.getBlockedArtists()) {
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

    if (rankingStore.getCuratedSkips().size > 0) {
      const heading = document.createElement('p');
      heading.className = 'curated-list-status';
      heading.textContent = 'Skipped curated albums';
      stage.append(heading);

      const list = document.createElement('ul');
      list.className = 'saved-list';
      for (const entryKey of rankingStore.getCuratedSkips()) {
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
      rateAlbum(rankingStore, entry.resolved, rating);
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
      rateAlbum(rankingStore, match.album, match.rating);
      persistRankingState();
      persistLists();
      curatedPendingMatch = null;
      curatedRatingEntryKey = null;
      reselectCandidate();
      renderNav();
      renderCuratedListsView();
      return;
    }
    rankingStore.setLists(addToList(rankingStore.getLists(), match.album, 'wantToListen'));
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
    rankingStore.getCuratedSkips().add(curatedEntryKey(listId, entry));
    persistCuratedSkips();
    renderCuratedListsView();
  }

  /** Same block mechanism as the main discovery pool's "No more X albums"
   *  (handleBlockArtist) -- curated entries carry an artist name but not
   *  always an Album record, so this can't reuse that function directly. */
  function handleHideCuratedArtist(entry: CuratedAlbumEntry): void {
    rankingStore.setBlockedArtists(addBlockedArtist(rankingStore.getBlockedArtists(), entry.artist));
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
      rankingStore.setLists(addToList(rankingStore.getLists(), entry.resolved, 'wantToListen'));
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

  /** "All {artist} albums" button on curated rows -- opens the same
   *  artist-batch view the rest of the app uses (renderArtistBatchView).
   *  A curated entry the owner hasn't touched yet won't be in `pool`, so
   *  this pushes the resolved album in directly (the batch view always has
   *  at least that one to show) and discovers the rest, best-effort. */
  async function handleViewArtistFromCurated(entry: CuratedAlbumEntry): Promise<void> {
    const album = entry.resolved;
    if (!album?.primary_artist_mbid) return;
    const artistMbid = album.primary_artist_mbid;

    const poolIds = new Set(pool.map((a) => a.mbid));
    if (!poolIds.has(album.mbid)) pool.push(album);

    const knownMbids = pool
      .filter((a) => a.primary_artist_mbid === artistMbid)
      .map((a) => a.mbid);
    const result = await discoverArtistDetailed(
      session.session_id,
      album.primary_artist_name,
      artistMbid,
      knownMbids
    );
    if (result.status === 'found') {
      const ids = new Set(pool.map((a) => a.mbid));
      for (const found of result.albums) {
        if (!ids.has(found.mbid)) {
          pool.push(found);
          ids.add(found.mbid);
        }
      }
    }

    batchArtistMbid = artistMbid;
    showView('artistBatch');
  }

  function renderCuratedListsView(): void {
    const unranked = selectedCuratedListId
      ? unrankedFromCuratedList(CURATED_LISTS[selectedCuratedListId].albums, rankingStore.getState().ranked, {
          listId: selectedCuratedListId,
          skippedKeys: rankingStore.getCuratedSkips(),
          blockedArtists: rankingStore.getBlockedArtists(),
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
      onViewArtist: (entry) => {
        void handleViewArtistFromCurated(entry);
      },
      ratingEntryKey: curatedRatingEntryKey,
      rateMessage: curatedRateMessage,
      pendingMatch: curatedPendingMatch,
      onConfirmMatch: handleConfirmCuratedMatch,
      onCancelMatch: handleCancelCuratedMatch,
    });
  }

  let backlogShelf: BacklogShelf = 'artists';
  let backlogShowOther = false;
  let backlogMessage = '';
  let suggestionState: { current: Suggestion | null; seen: Album[]; recent: string[]; count: number } = { current: null, seen: [], recent: [], count: 0 };
  let suggestionRelated: RelatedArtist[] = [];
  let suggestionAlbums: Album[] = [];
  const suggestionCurated = Object.values(CURATED_LISTS).flatMap(list => list.albums.map(entry => ({
    artist: entry.resolved?.primary_artist_name ?? entry.artist,
    title: entry.resolved?.title ?? entry.title, source: list.name,
  })));
  const suggestionCuratedAlbums = Object.values(CURATED_LISTS).flatMap(list => list.albums.flatMap(entry => entry.resolved ? [entry.resolved] : []));
  let suggestionLoading = false;
  let suggestionLoaded = false;
  let suggestionUnavailable = false;
  let backlogUndo: { state: RankingState; lists: SavedLists; suggestions: typeof suggestionState; persist: boolean } | null = null;

  function chooseSuggestion(): void {
    suggestionState = { ...suggestionState, current: suggestAlbum({
      pool: [...pool, ...suggestionAlbums, ...suggestionCuratedAlbums], ranked: rankingStore.getState().ranked, lists: rankingStore.getLists(), preferred,
      blocked: rankingStore.getBlockedArtists(), skipped: skippedAlbums, seen: suggestionState.seen,
      recentArtists: suggestionState.recent, related: suggestionRelated,
      discoveryTurn: suggestionState.count % 4 === 3,
      curated: suggestionCurated,
    }) };
  }

  function advanceSuggestion(): void {
    const current = suggestionState.current;
    if (current) suggestionState = {
      current: null, seen: [...suggestionState.seen, current.album],
      recent: [...suggestionState.recent, normalize(current.album.primary_artist_name)].slice(-3),
      count: suggestionState.count + 1,
    };
    chooseSuggestion();
  }

  async function enrichSuggestions(): Promise<void> {
    if (suggestionLoaded || suggestionLoading) return;
    suggestionLoading = true;
    const result = await loadSuggestionConnections(rankingStore.getState().ranked, rankingStore.getBlockedArtists(), pool);
    suggestionRelated = result.related;
    suggestionAlbums = result.albums;
    suggestionUnavailable = result.unavailable;
    suggestionLoading = false;
    suggestionLoaded = true;
    // Never replace a visible card or erase a score being typed when the
    // background lookup finishes. Its results apply to the next suggestion.
    if (!suggestionState.current && view === 'backlog' && backlogShelf === 'suggestions') {
      chooseSuggestion();
      renderBacklog();
    }
  }

  function renderBacklog(): void {
    const suggested = suggestionState.current?.album;
    if (backlogShelf === 'suggestions' && suggested && (
      [...rankingStore.getState().ranked, ...allSavedAlbums(rankingStore.getLists())].some(a => a.mbid === suggested.mbid || albumKey(a) === albumKey(suggested)) ||
      skippedAlbums.has(suggested.mbid) || rankingStore.getBlockedArtists().some(name => normalize(name) === normalize(suggested.primary_artist_name))
    )) chooseSuggestion();
    const artists = buildArtistGaps(pool, rankingStore.getState().ranked, rankingStore.getLists(), preferred, rankingStore.getBlockedArtists(), skippedAlbums);
    const selectedArtistId = rankingStore.getLists().backlog?.currentArtistId ?? artists[0]?.id ?? null;
    const remember = (persist = true) => { backlogUndo = { state: rankingStore.getState(), lists: rankingStore.getLists(), suggestions: suggestionState, persist }; };
    // Shared by onArtist and onDecide, both of which only ever change which
    // artist is showing -- onFinish changes reviewedArtistIds at the same
    // time, so it stays a direct setLists rather than reusing this.
    const setCurrentArtistId = (id: string | null) => {
      rankingStore.setLists({ ...rankingStore.getLists(), backlog: { ...(rankingStore.getLists().backlog ?? emptyBacklog<Album>()), currentArtistId: id } });
    };
    const commit = () => {
      persistLists();
      reselectCandidate();
      renderBacklog();
      renderNav();
    };
    renderBacklogView(stage, {
      artists, lists: rankingStore.getLists(), selectedArtistId, shelf: backlogShelf, showOther: backlogShowOther,
      message: backlogMessage, canUndo: !!backlogUndo,
      suggestion: suggestionState.current, suggestionLoading, suggestionUnavailable,
      onShelf: (shelf) => {
        backlogShelf = shelf;
        if (shelf === 'suggestions') {
          chooseSuggestion();
          if (suggestionUnavailable) suggestionLoaded = false;
          void enrichSuggestions();
        }
        renderBacklog();
      },
      onSkipSuggestion: () => {
        remember(false);
        advanceSuggestion();
        backlogMessage = 'Skipped for this visit.';
        renderBacklog();
      },
      onArtist: (id) => {
        setCurrentArtistId(id);
        backlogShowOther = false;
        backlogMessage = '';
        persistLists();
        renderBacklog();
      },
      onShowOther: (show) => { backlogShowOther = show; renderBacklog(); },
      onDecide: (album, decision) => {
        remember();
        rankingStore.setLists(decideAlbum(rankingStore.getLists(), album, decision));
        // Keep the same artist visible when its remaining count changes.
        setCurrentArtistId(selectedArtistId);
        backlogMessage = decision === 'readyToRank' ? `${album.title} is ready to rank.`
          : decision === 'wantToListen' ? `${album.title} is saved to Want to listen.`
          : decision === null ? `${album.title} is back in artist review.` : `${album.title} reviewed.`;
        if (backlogShelf === 'suggestions') advanceSuggestion();
        commit();
      },
      onRate: (album, rating) => {
        remember();
        rateAlbum(rankingStore, album, rating);
        backlogMessage = `${album.title} rated ${rating.toFixed(2)}.`;
        if (backlogShelf === 'suggestions') advanceSuggestion();
        persistRankingState();
        commit();
      },
      onFinish: (id) => {
        remember();
        const backlog = rankingStore.getLists().backlog ?? emptyBacklog<Album>();
        const reviewed = [...new Set([...backlog.reviewedArtistIds, id])];
        const next = artists.find((a) => !reviewed.includes(a.id));
        rankingStore.setLists({ ...rankingStore.getLists(), backlog: { ...backlog, reviewedArtistIds: reviewed, currentArtistId: next?.id ?? id } });
        backlogShowOther = false;
        backlogMessage = next ? 'Artist reviewed. Here’s the next one.' : 'You’ve reviewed every artist in this pass. Your familiar albums are waiting in Ready to rank.';
        commit();
      },
      onUndo: () => {
        if (!backlogUndo) return;
        rankingStore.setState(backlogUndo.state);
        rankingStore.setLists(backlogUndo.lists);
        suggestionState = backlogUndo.suggestions;
        const persist = backlogUndo.persist;
        backlogUndo = null;
        backlogMessage = 'Last change undone.';
        if (persist) {
          persistRankingState();
          commit();
        } else renderBacklog();
      },
      onRankings: handleOpenArtistBatch,
    });
  }

  function showView(next: ViewMode): void {
    // Results only render in the ranked view; leaving it ends the search.
    if (next !== 'ranked' && searchQuery) resetSearch();
    if (view === 'backlog' && next !== 'backlog') backlogUndo = null;
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
    } else if (view === 'backlog') {
      renderBacklog();
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

  function handleExportBackup(): void {
    syncEngine.exportBackup();
  }

  function renderNav(): void {
    nav.textContent = '';
    const lists = rankingStore.getLists();
    const listViews: Array<{ mode: ViewMode; label: string }> = [
      { mode: 'ranked', label: `Ranked ${rankingStore.getState().ranked.length}` },
      { mode: 'wantToListen', label: `Want to listen ${lists.wantToListen.length}` },
      { mode: 'notHeard', label: `Haven't heard ${lists.notHeard.length}` },
      { mode: 'dontCare', label: `Don't care ${lists.dontCare.length}` },
    ];
    const onMyList = listViews.some((item) => item.mode === view);

    const tabButton = (label: string, active: boolean, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = active ? 'view-tab view-tab-active' : 'view-tab';
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const tabs = document.createElement('div');
    tabs.className = 'view-tabs';
    tabs.append(
      tabButton('Find albums', view === 'backlog', () => showView('backlog')),
      // From another tab, My list opens the ranked list; it stays highlighted
      // on all four list views below.
      tabButton(`My list (${rankingStore.getState().ranked.length})`, onMyList, () => {
        if (!onMyList) showView('ranked');
      })
    );

    // Everything else lives behind More.
    const more = document.createElement('details');
    more.className = 'nav-more';
    const moreLabel = document.createElement('summary');
    const moreModes: ViewMode[] = ['blockedArtists', 'speedRound', 'curatedLists'];
    moreLabel.className = moreModes.includes(view) ? 'view-tab view-tab-active' : 'view-tab';
    moreLabel.textContent = 'More';
    const moreItems = document.createElement('div');
    moreItems.className = 'nav-more-items';
    more.append(moreLabel, moreItems);

    const moreViews: Array<{ mode: ViewMode; label: string }> = [
      { mode: 'blockedArtists', label: `Blocked artists (${rankingStore.getBlockedArtists().length})` },
      { mode: 'speedRound', label: 'Voice speed round' },
      { mode: 'curatedLists', label: 'Curated lists' },
    ];
    for (const { mode, label } of moreViews) {
      moreItems.append(tabButton(label, mode === view, () => showView(mode)));
    }

    const bulkDiscoverBtn = tabButton(
      bulkDiscoveryInFlight ? 'Discovering…' : 'Fill in more albums',
      false,
      () => void handleBulkDiscover()
    );
    bulkDiscoverBtn.disabled = bulkDiscoveryInFlight;
    bulkDiscoverBtn.title = `Bulk-discover the remaining catalog for your top ${TOP_ARTIST_DISCOVERY_COUNT} ranked artists`;

    const exportBtn = tabButton('Export backup', false, handleExportBackup);
    exportBtn.title = 'Download your ranking and lists as a JSON file';

    moreItems.append(bulkDiscoverBtn, exportBtn);
    tabs.append(more);
    nav.append(tabs);

    // My list's filters: the ranked list and the three saved lists.
    if (onMyList) {
      const filters = document.createElement('div');
      filters.className = 'view-filters';
      for (const { mode, label } of listViews) {
        const chip = tabButton(label, mode === view, () => showView(mode));
        chip.classList.add('view-filter');
        chip.setAttribute('aria-pressed', String(mode === view));
        filters.append(chip);
      }
      nav.append(filters);
      // The row can overflow at phone width: keep the active filter in view.
      // Sets the row's own scrollLeft (not scrollIntoView, which would also
      // scroll the page up to the nav on every re-render).
      const active = filters.querySelector<HTMLElement>('.view-tab-active');
      if (active) {
        const overflow = active.offsetLeft - filters.offsetLeft + active.offsetWidth - filters.clientWidth;
        if (overflow > 0) filters.scrollLeft = overflow + 16;
      }
    }
  }

  showView('backlog');
}

if (typeof document !== 'undefined') {
  void main();
}
