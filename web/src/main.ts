import './style.css';
import type { Album, Comparison, RankingState } from './ranking/types';
import { startPlacement, nextComparison } from './ranking/insertion';
import { loadSeedPool, nextUnrankedCandidate } from './seed';
import { loadRanking, saveRanking } from './storage';
import { getOrCreateSession } from './session';
import { mountPickLoop } from './ui/pickLoop';
import { renderRankedList } from './ui/rankedList';

/**
 * Cold-start bootstrap (mandatory -- see 02-03-PLAN.md). On an empty
 * `ranked` list, `startPlacement` seats the first candidate immediately and
 * `nextComparison` then returns `null` (nothing to compare against yet).
 * Chain `startPlacement` on the next unranked candidate, persisting after
 * every step, until `nextComparison` yields a real pair or the seed pool is
 * exhausted. Guarantees a true first-visit player (zero ranked albums) is
 * always shown a real two-album comparison, never a blank/crashed screen.
 */
export function bootstrapComparison(
  initialState: RankingState,
  pool: Album[],
  onPersist: (state: RankingState) => void
): { state: RankingState; comparison: Comparison | null } {
  let state = initialState;
  let comparison = nextComparison(state);

  while (comparison === null) {
    const pendingMbid = state.pending?.album.mbid ?? null;
    const candidate = nextUnrankedCandidate(pool, state.ranked, pendingMbid);
    if (!candidate) break; // whole seed pool ranked; nothing left to bootstrap

    state = startPlacement(state, candidate);
    onPersist(state);
    comparison = nextComparison(state);
  }

  return { state, comparison };
}

type ViewMode = 'pick' | 'ranked';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app mount point not found');
  }

  getOrCreateSession();

  const pool = await loadSeedPool();
  const restored = loadRanking();
  let state: RankingState = restored ?? { ranked: [], pending: null };

  const bootstrapped = bootstrapComparison(state, pool, saveRanking);
  state = bootstrapped.state;

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const heading = document.createElement('h1');
  heading.className = 'app-heading';
  heading.textContent = 'Taste Test';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'view-toggle';

  const stage = document.createElement('div');
  stage.className = 'app-stage';

  shell.append(heading, toggle, stage);
  app.textContent = '';
  app.append(shell);

  let view: ViewMode = 'pick';

  // mountPickLoop renders the first comparison immediately, so the toggle
  // only needs to handle switching views from here on.
  const pickLoop = mountPickLoop(
    stage,
    state,
    bootstrapped.comparison,
    (s) => bootstrapComparison(s, pool, saveRanking),
    (s) => {
      state = s;
    }
  );
  toggle.textContent = 'View ranked list';

  toggle.addEventListener('click', () => {
    view = view === 'pick' ? 'ranked' : 'pick';

    if (view === 'ranked') {
      // Detach the pick loop's keyboard listener so a stray keypress can't
      // fire a phantom pick while the ranked list is on screen.
      pickLoop.teardown();
      toggle.textContent = 'Back to picking';
      renderRankedList(stage, state.ranked);
    } else {
      toggle.textContent = 'View ranked list';
      pickLoop.render();
    }
  });
}

if (typeof document !== 'undefined') {
  void main();
}
