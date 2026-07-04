import type { RankingState } from './ranking/types';

const RANKING_KEY = 'tastetest-ranking';

// In-memory fallback mirrors the same graceful-failure rule as session.ts:
// localStorage may be unavailable (private browsing, quota exceeded, or a
// non-browser test environment) or throw on write. Either way the ranking
// loop keeps working in-memory for the current page load rather than
// crashing; only a real page reload loses state in that case.
let memoryRanking: RankingState | null = null;

/**
 * Persist `state` under `tastetest-ranking`. Saved immediately after every
 * mutation so in-memory state and storage never diverge. Falls back to the
 * in-memory cache (with a console warning) if localStorage is unavailable
 * or throws.
 */
export function saveRanking(state: RankingState): void {
  memoryRanking = state;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(RANKING_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('tastetest: failed to persist ranking state to localStorage, continuing in-memory', err);
  }
}

/**
 * Load the persisted RankingState, or `null` if nothing has been saved yet
 * (a fresh player) or storage is unreadable. Migration-safe: if the stored
 * value is from an older/mismatched shape (no `ranked` array), it is treated
 * as absent (returns `null`) rather than crashing the app. `pending` is
 * always normalized to `null` -- the drag-to-place flow keeps the ranking as
 * the ordered `ranked` array only.
 */
export function loadRanking(): RankingState | null {
  const normalize = (value: RankingState | null): RankingState | null => {
    if (!value || !Array.isArray(value.ranked)) return null;
    return { ranked: value.ranked, pending: null };
  };

  if (typeof localStorage === 'undefined') return normalize(memoryRanking);

  try {
    const raw = localStorage.getItem(RANKING_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw) as RankingState);
  } catch (err) {
    console.warn('tastetest: failed to read ranking state from localStorage, using in-memory state', err);
    return normalize(memoryRanking);
  }
}
