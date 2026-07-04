import './style.css';
import type { Album, RankingState } from './ranking/types';
import { insertAt, moveItem } from './ranking/order';
import { setAsideAlbum } from './ranking/setAside';
import { loadSeedPool, pickCandidate } from './seed';
import { loadRanking, saveRanking } from './storage';
import { getOrCreateSession } from './session';
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

type ViewMode = 'ranked' | 'wantToListen' | 'notHeard';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
  }

  getOrCreateSession();

  const pool = await loadSeedPool();
  let lists: SavedLists = loadLists();
  const restored = loadRanking();
  // The drag-to-place flow keeps the ranking as the ordered `ranked` array;
  // `pending` is always null.
  let state: RankingState = restored ?? { ranked: [], pending: null };
  // First-visit correctness: an empty list plus a first candidate, never a
  // blank screen. pickCandidate returns a random eligible album.
  let candidate: Album | null = pickCandidate(pool, state.ranked, excludedMbids(lists));

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

  function reselectCandidate(): void {
    candidate = pickCandidate(pool, state.ranked, excludedMbids(lists));
  }

  const rankList = mountRankList(stage, {
    getRanked: () => state.ranked,
    getCandidate: () => candidate,
    onPlace: (index) => {
      if (!candidate) return;
      state = { ranked: insertAt(state.ranked, candidate, index), pending: null };
      saveRanking(state);
      reselectCandidate();
      rankList.render();
      renderNav();
    },
    onReorder: (from, to) => {
      state = { ranked: moveItem(state.ranked, from, to), pending: null };
      saveRanking(state);
      rankList.render();
    },
    onSetAside: (album, which) => {
      // Record to the saved list first (so it is excluded), then drop it from
      // ranking state (setAsideAlbum also clears any stale placement), then
      // pick the next candidate.
      lists = addToList(lists, album, which);
      saveLists(lists);
      state = setAsideAlbum(state, album.mbid);
      saveRanking(state);
      reselectCandidate();
      rankList.render();
      renderNav();
    },
  });

  function markAsHeard(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    saveLists(lists);
    // Eligible again: if the pool was exhausted (no candidate), offer it now.
    if (!candidate) reselectCandidate();
    renderNav();
    renderCurrentSavedList(which);
  }

  function renderCurrentSavedList(which: ListName): void {
    const albums = which === 'wantToListen' ? lists.wantToListen : lists.notHeard;
    renderSavedList(stage, albums, (album) => markAsHeard(album, which));
  }

  function showView(next: ViewMode): void {
    // Leaving the drag view: cancel any in-flight drag / listeners.
    if (view === 'ranked' && next !== 'ranked') {
      rankList.teardown();
    }
    view = next;

    if (view === 'ranked') {
      rankList.render();
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
