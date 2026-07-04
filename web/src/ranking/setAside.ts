import type { RankingState } from './types';

/**
 * Set an album aside from ranking (the player flagged it "Haven't heard" or
 * "Want to listen"). Pure and DOM-free; does NOT touch the guarded insertion
 * engine (insertion.ts) or its types.
 *
 * ALWAYS drops `pending` to null. This is the safety hinge: cancelling any
 * in-progress placement means removing an album from `ranked` can never leave
 * a dangling lo/hi index pointing past the shortened list. A candidate that
 * was mid-placement (and was NOT the flagged album) simply returns to the
 * unranked pool and gets re-placed later via the cold-start bootstrap loop.
 * The transitive guarantee is preserved because we never rewrite `ranked`
 * order and never resume a stale placement against a mutated list.
 *
 * Returns a new state; the input is never mutated.
 */
export function setAsideAlbum(state: RankingState, mbid: string): RankingState {
  return {
    ranked: state.ranked.filter((album) => album.mbid !== mbid),
    pending: null,
  };
}
