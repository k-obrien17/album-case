import './style.css';
import type { Album, Comparison, RankingState } from './ranking/types';
import { startPlacement, nextComparison } from './ranking/insertion';
import { loadSeedPool, nextUnrankedCandidate } from './seed';
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
import { mountPickLoop } from './ui/pickLoop';
import { renderRankedList } from './ui/rankedList';
import { renderSavedList } from './ui/savedList';

/**
 * Cold-start bootstrap (mandatory -- see 02-03-PLAN.md). On an empty
 * `ranked` list, `startPlacement` seats the first candidate immediately and
 * `nextComparison` then returns `null` (nothing to compare against yet).
 * Chain `startPlacement` on the next unranked candidate, persisting after
 * every step, until `nextComparison` yields a real pair or the seed pool is
 * exhausted. Guarantees a true first-visit player (zero ranked albums) is
 * always shown a real two-album comparison, never a blank/crashed screen.
 *
 * `excluded` is the set of set-aside album mbids to skip while seeding
 * candidates; it is read fresh on every bootstrap call so newly-flagged
 * albums are excluded immediately.
 */
export function bootstrapComparison(
  initialState: RankingState,
  pool: Album[],
  onPersist: (state: RankingState) => void,
  excluded: Set<string> = new Set()
): { state: RankingState; comparison: Comparison | null } {
  let state = initialState;
  let comparison = nextComparison(state);

  while (comparison === null) {
    const pendingMbid = state.pending?.album.mbid ?? null;
    const candidate = nextUnrankedCandidate(pool, state.ranked, pendingMbid, excluded);
    if (!candidate) break; // whole seed pool ranked/excluded; nothing to bootstrap

    state = startPlacement(state, candidate);
    onPersist(state);
    comparison = nextComparison(state);
  }

  return { state, comparison };
}

type ViewMode = 'pick' | 'ranked' | 'wantToListen' | 'notHeard';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
  }

  getOrCreateSession();

  const pool = await loadSeedPool();
  let lists: SavedLists = loadLists();
  const restored = loadRanking();
  let state: RankingState = restored ?? { ranked: [], pending: null };

  const bootstrapped = bootstrapComparison(state, pool, saveRanking, excludedMbids(lists));
  state = bootstrapped.state;

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

  let view: ViewMode = 'pick';

  // mountPickLoop renders the first comparison immediately.
  const pickLoop = mountPickLoop(
    stage,
    state,
    bootstrapped.comparison,
    // The bootstrap closure re-reads the CURRENT lists on every call, so an
    // album flagged during play is excluded from the very next candidate.
    (s) => bootstrapComparison(s, pool, saveRanking, excludedMbids(lists)),
    (s) => {
      state = s;
    },
    // recordSetAside: add to the correct list, persist, and update the
    // in-scope `lists` BEFORE the pick loop re-bootstraps, so the newly
    // flagged album is already excluded from the next candidate search.
    (album: Album, which: ListName) => {
      lists = addToList(lists, album, which);
      saveLists(lists);
      renderNav();
    }
  );

  function markAsHeard(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    saveLists(lists);
    // The album is eligible again (the excluded set shrank); bootstrap will
    // offer it the next time a candidate is needed. Re-render the current
    // saved list and refresh the nav counts.
    renderNav();
    renderCurrentSavedList(which);
  }

  function renderCurrentSavedList(which: ListName): void {
    const albums = which === 'wantToListen' ? lists.wantToListen : lists.notHeard;
    renderSavedList(stage, albums, (album) => markAsHeard(album, which));
  }

  function showView(next: ViewMode): void {
    // Leaving the pick view: detach its keyboard listener so a stray
    // keypress can't fire a phantom pick from another view.
    if (view === 'pick' && next !== 'pick') {
      pickLoop.teardown();
    }
    view = next;

    if (view === 'pick') {
      pickLoop.render();
    } else if (view === 'ranked') {
      renderRankedList(stage, state.ranked);
    } else {
      renderCurrentSavedList(view);
    }
    renderNav();
  }

  function renderNav(): void {
    nav.textContent = '';
    const items: Array<{ mode: ViewMode; label: string }> = [
      { mode: 'pick', label: 'Picking' },
      { mode: 'ranked', label: `Ranked (${state.ranked.length})` },
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
