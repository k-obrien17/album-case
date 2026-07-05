/**
 * Assisted "find my slot" placement.
 *
 * A thin wrapper over the tested binary-insertion engine (insertion.ts) that
 * drives a this-or-that placement of a single candidate into an already-ranked
 * list. Every answer narrows the search window (via `applyPick`) until the exact
 * slot is found. Because it reuses the same engine as the rest of the app, the
 * result stays transitive by construction: the player can never record a
 * comparison that contradicts the final order.
 *
 * Pure and DOM-free. The UI layer holds one `AssistPlacement` at a time, shows
 * the current `opponent`, and hands the resolved `index` back to the normal
 * `onPlace` path so neighbor pairwise atoms still fire.
 */
import type { Album, RankingState } from './types';
import { startPlacement, nextComparison, applyPick } from './insertion';

export type AssistPlacement = {
  /** The album being placed. */
  album: Album;
  /** Engine state; the binary-search window lives in `state.pending`. */
  state: RankingState;
};

/**
 * Begin an assisted placement of `album` into `ranked`. On an empty (or
 * single-comparison-away) list the engine may resolve immediately; callers
 * should check `assistResolved` before rendering a comparison.
 */
export function startAssist(ranked: Album[], album: Album): AssistPlacement {
  return { album, state: startPlacement({ ranked, pending: null }, album) };
}

/** The album to compare the candidate against next, or `null` once resolved. */
export function assistOpponent(placement: AssistPlacement): Album | null {
  const comparison = nextComparison(placement.state);
  return comparison ? comparison.opponent : null;
}

/** Whether the search has narrowed to a single slot (no comparison left). */
export function assistResolved(placement: AssistPlacement): boolean {
  return nextComparison(placement.state) === null;
}

/**
 * Record a pick and narrow the window. `winnerMbid` must be the candidate's or
 * the current opponent's mbid (the engine throws otherwise). Returns a new
 * placement; the input is never mutated.
 */
export function assistPick(placement: AssistPlacement, winnerMbid: string): AssistPlacement {
  return { album: placement.album, state: applyPick(placement.state, winnerMbid) };
}

/**
 * The final insertion index once resolved: the candidate's position in the
 * finalized list. Only meaningful after `assistResolved` is true; before then
 * the candidate is not yet in the list, so this falls back to the list length.
 */
export function assistIndex(placement: AssistPlacement): number {
  const index = placement.state.ranked.indexOf(placement.album);
  return index < 0 ? placement.state.ranked.length : index;
}
