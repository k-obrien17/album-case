/**
 * Binary-insertion ranking engine.
 *
 * Pure state machine with zero browser/runtime environment dependencies.
 * Each new album is inserted into the player's existing ranked list via
 * binary search: every pick narrows the [lo, hi) bounds until they collapse
 * to a single index, at which point the candidate is spliced in. Because
 * placement is driven by binary search over an already-consistent list,
 * the result is transitive by construction: the player can never be shown
 * (or record) a comparison that contradicts the final order.
 *
 * NOT Elo. There are no ratings, scores, or probabilistic outcomes here,
 * only ordinal position.
 */
import type { Album, Comparison, RankingState } from './types';

/**
 * Begin inserting `album` into `state.ranked`.
 *
 * On an empty list there is nothing to compare against, so the placement
 * finalizes immediately: `album` becomes the sole element and `pending`
 * is left `null` (so a subsequent `nextComparison` call returns `null`).
 */
export function startPlacement(state: RankingState, album: Album): RankingState {
  const lo = 0;
  const hi = state.ranked.length;

  if (lo >= hi) {
    return {
      ranked: [...state.ranked, album],
      pending: null,
    };
  }

  return {
    ranked: state.ranked,
    pending: { album, lo, hi },
  };
}

/**
 * The next pair to show the player, or `null` if no placement is active
 * (including immediately after a placement finalizes). The opponent is
 * always the element already in `ranked` at the deterministic midpoint
 * `floor((lo + hi) / 2)` -- never a random or unrelated pairing (RANK-03).
 */
export function nextComparison(state: RankingState): Comparison | null {
  const { pending } = state;
  if (!pending) return null;

  const { album, lo, hi } = pending;
  if (lo >= hi) return null;

  const mid = Math.floor((lo + hi) / 2);
  return { candidate: album, opponent: state.ranked[mid] };
}

/**
 * Record the player's pick for the current comparison and narrow the
 * placement bounds accordingly:
 *   - candidate wins  -> hi := mid   (candidate ranks above the opponent)
 *   - opponent wins   -> lo := mid+1 (candidate ranks below the opponent)
 * Once lo >= hi the index is fully determined; the candidate is spliced
 * into `ranked` at that index and `pending` clears.
 *
 * `winnerMbid` must be either the candidate's or the current opponent's
 * mbid; anything else indicates a caller bug (stale comparison, wrong
 * state) and throws rather than silently corrupting the list.
 */
export function applyPick(state: RankingState, winnerMbid: string): RankingState {
  const { pending } = state;
  if (!pending) return state;

  const { album, lo, hi } = pending;
  if (lo >= hi) return state;

  const mid = Math.floor((lo + hi) / 2);
  const opponent = state.ranked[mid];

  let newLo = lo;
  let newHi = hi;

  if (winnerMbid === album.mbid) {
    newHi = mid;
  } else if (winnerMbid === opponent.mbid) {
    newLo = mid + 1;
  } else {
    throw new Error(
      `applyPick: winnerMbid "${winnerMbid}" is neither the candidate ("${album.mbid}") nor the current opponent ("${opponent.mbid}")`
    );
  }

  if (newLo >= newHi) {
    const ranked = [
      ...state.ranked.slice(0, newLo),
      album,
      ...state.ranked.slice(newLo),
    ];
    return { ranked, pending: null };
  }

  return {
    ranked: state.ranked,
    pending: { album, lo: newLo, hi: newHi },
  };
}
