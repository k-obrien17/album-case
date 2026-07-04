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
import { enqueueAtom, flushAtomQueue } from './atoms';
import { createRankingBackup, parseRankingBackup } from './backup';
import {
  loadPriorityQueue,
  nextPriorityCandidate,
  priorityQueueFromArtistText,
  savePriorityQueue,
} from './priority';
import { loadRankingSnapshot, saveRankingSnapshot } from './rankingSync';

type ViewMode = 'ranked' | 'wantToListen' | 'notHeard';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
  }

  const session = getOrCreateSession();
  void flushAtomQueue();

  const pool = await loadSeedPool();
  let lists: SavedLists = loadLists();
  let priorityQueue = loadPriorityQueue();
  const restored = loadRanking();
  // The drag-to-place flow keeps the ranking as the ordered `ranked` array;
  // `pending` is always null.
  let state: RankingState = restored ?? { ranked: [], pending: null };
  const snapshot = await loadRankingSnapshot(session.session_id, pool);
  if (snapshot && state.ranked.length === 0) {
    state = snapshot.state;
    lists = snapshot.lists;
    saveRanking(state);
    saveLists(lists);
  } else if (state.ranked.length > 0 || lists.wantToListen.length > 0 || lists.notHeard.length > 0) {
    void saveRankingSnapshot(session.session_id, state, lists);
  }
  // First-visit correctness: an empty list plus a first candidate, never a
  // blank screen. Priority albums are offered first; random eligible albums
  // are the fallback.
  let candidate: Album | null = null;

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const heading = document.createElement('h1');
  heading.className = 'app-heading';
  heading.textContent = 'Taste Test';

  const nav = document.createElement('nav');
  nav.className = 'view-switcher';

  const backupControls = document.createElement('div');
  backupControls.className = 'backup-controls';

  const stage = document.createElement('div');
  stage.className = 'app-stage';

  shell.append(heading, nav, backupControls, stage);
  app.textContent = '';
  app.append(shell);

  let view: ViewMode = 'ranked';

  function reselectCandidate(): void {
    const excluded = excludedMbids(lists);
    const priority = nextPriorityCandidate(priorityQueue, pool, state.ranked, excluded);
    priorityQueue = priority.queue;
    savePriorityQueue(priorityQueue);
    candidate = priority.candidate ?? pickCandidate(pool, state.ranked, excluded);
  }

  function persistRankingState(): void {
    saveRanking(state);
    void saveRankingSnapshot(session.session_id, state, lists);
  }

  function persistLists(): void {
    saveLists(lists);
    void saveRankingSnapshot(session.session_id, state, lists);
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
      renderBackupControls();
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
      renderBackupControls();
    },
  });

  function markAsHeard(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    persistLists();
    // Eligible again: if the pool was exhausted (no candidate), offer it now.
    if (!candidate) reselectCandidate();
    renderNav();
    renderBackupControls();
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

  function renderBackupControls(): void {
    backupControls.textContent = '';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'backup-button';
    exportBtn.textContent = 'Export backup';
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([createRankingBackup(state, lists)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tastetest-ranking-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.className = 'backup-input';
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;

      const parsed = parseRankingBackup(await file.text(), pool);
      if (!parsed.ok) {
        window.alert(`Could not import backup: ${parsed.error}`);
        return;
      }

      state = parsed.state;
      if (parsed.lists) {
        lists = parsed.lists;
      }
      persistRankingState();
      persistLists();
      reselectCandidate();
      renderBackupControls();
      showView('ranked');
    });

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'backup-button';
    importBtn.textContent = 'Import backup';
    importBtn.addEventListener('click', () => importInput.click());

    const priorityBtn = document.createElement('button');
    priorityBtn.type = 'button';
    priorityBtn.className = 'backup-button';
    priorityBtn.textContent = `Prioritize artists (${priorityQueue.length})`;
    priorityBtn.addEventListener('click', () => {
      const input = window.prompt('Paste artist names to prioritize. Matched seed albums will appear before random picks.');
      if (input == null) return;

      priorityQueue = priorityQueueFromArtistText(input, pool);
      savePriorityQueue(priorityQueue);
      reselectCandidate();
      rankList.render();
      renderBackupControls();
    });

    backupControls.append(exportBtn, importBtn, priorityBtn, importInput);
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
  renderBackupControls();
}

if (typeof document !== 'undefined') {
  void main();
}
