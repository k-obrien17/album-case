import type { Album, RankedAlbum } from './ranking/types';
import { ratingForDropIndex } from './ranking/rating';
import { setAsideAlbum } from './ranking/setAside';
import { addToList, removeFromAllLists, type ListName, type SavedLists } from './lists';
import type { RankingStore } from './rankingStore';

/**
 * Remove `album` from `ranked` if present (re-rating an existing album),
 * compute its new rating for landing at `targetIndex` in the resulting
 * array, then return the full list with `album` re-inserted at exactly
 * that position. `targetIndex` should already reflect any lock-safety
 * clamping (nearestValidDropIndex) the caller performed.
 *
 * Splices at `clampedIndex` directly instead of appending and re-sorting
 * by rating (mirrors insertion.ts's applyPick). `ratingForDropIndex`
 * computes `rating` specifically so this item belongs at `clampedIndex`,
 * so placing it there is always correct on its own -- sorting afterward
 * is not just redundant, it's actively wrong on ties: once the post-backfill
 * #1 album sits at rating 10.00, dropping anything else at index 0 also
 * computes 10.00, and Array.prototype.sort's stability would leave the
 * incumbent ahead of the new item, making position 0 unreachable.
 */
export function reRate(ranked: RankedAlbum[], album: Album, targetIndex: number): RankedAlbum[] {
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  const clampedIndex = Math.max(0, Math.min(targetIndex, without.length));
  const rating = ratingForDropIndex(without, clampedIndex);
  const rated: RankedAlbum = { ...album, rating };
  return [...without.slice(0, clampedIndex), rated, ...without.slice(clampedIndex)];
}

/**
 * Insert `album` at `rating` into `ranked` by finding its correct position
 * directly, rather than appending and re-sorting (the same bug class fixed in
 * `reRate`). A directly-typed rating has no drop-position intent to preserve,
 * so ties resolve by placing the new entry immediately after any existing
 * entries at the same rating -- e.g. typing "10" when rank #1 is already the
 * 10.00 ceiling lands the new album at index 1, not scrambled elsewhere in
 * the list and not fighting the incumbent for index 0.
 */
export function insertAtRating(ranked: RankedAlbum[], album: Album, rating: number): RankedAlbum[] {
  // Guard against a duplicate mbid: a duplicate would fail the API's
  // parseRankedAlbumList validation (400 invalid_snapshot), surfacing only
  // as a sync failure in the banner. Mirrors what reRate already does.
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  const rated: RankedAlbum = { ...album, rating };
  const insertAt = without.findIndex((a) => a.rating < rating);
  const index = insertAt === -1 ? without.length : insertAt;
  return [...without.slice(0, index), rated, ...without.slice(index)];
}

/**
 * Add a searched (MusicBrainz-fallback) album to the ranked list at `rating`,
 * and strip it out of every saved list it might already be sitting in (e.g.
 * a prior "Want to listen"). HARD REQUIREMENT: api/ranking.ts rejects any
 * snapshot where an album is both ranked and in a saved list (400
 * ranked_album_in_saved_list) -- this exact bug class already blocked the
 * canon import once. Pure and exported so the regression is actually
 * guarded by a test that exercises this function directly, not a re-run of
 * the same sequence in the test body.
 */
export function addSearchedAlbum(
  ranked: RankedAlbum[],
  lists: SavedLists,
  album: Album,
  rating: number
): { ranked: RankedAlbum[]; lists: SavedLists } {
  const newRanked = insertAtRating(ranked, album, rating);
  const newLists = removeFromAllLists(lists, album);
  return { ranked: newRanked, lists: newLists };
}

/**
 * Set the rating of the ranked album currently at global index `from` to
 * `rating`, re-inserting it at wherever that rating lands it. No lock
 * parameter -- artist locks are paused (see ranking/locks.ts). Removes the
 * album, then re-inserts via `insertAtRating`, which splices at the computed
 * index directly rather than appending and re-sorting -- append-then-sort
 * broke on rating ties (a stable sort strands the new album behind an
 * equal-rated incumbent). See insertAtRating's own doc comment.
 */
export function setRating(ranked: RankedAlbum[], from: number, rating: number): RankedAlbum[] {
  const album = ranked[from];
  if (!album) return ranked;
  const without = ranked.filter((a) => a.mbid !== album.mbid);
  return insertAtRating(without, album, rating);
}

/**
 * Store-aware ranking actions: the handful of shapes main.ts's ~18 mutation
 * call sites collapse into (see rankingStore.ts for the state/lists/
 * artistLocks/blockedArtists/curatedSkips container these operate on).
 * Persisting, re-rendering, and reselecting a candidate are caller
 * concerns -- these functions only ever change `state`/`lists`, nothing
 * else, so every call site stays free to decide what happens after.
 */

/** Insert/move `album` to `rating` via the search/curated/backlog/saved-list
 *  rating path -- addSearchedAlbum's insert-and-strip-from-lists, applied to
 *  the live store. */
export function rateAlbum(store: RankingStore, album: Album, rating: number): void {
  const added = addSearchedAlbum(store.getState().ranked, store.getLists(), album, rating);
  store.setState({ ranked: added.ranked, pending: null });
  store.setLists(added.lists);
}

/** Move the ranked album currently at global index `from` to `to` --
 *  the drag-reorder / "Overall" rank edit path, shared by the main ranked
 *  list and the artist-batch view's own mini list. */
export function reRateAt(store: RankingStore, from: number, to: number): void {
  const ranked = store.getState().ranked;
  const album = ranked[from];
  store.setState({ ranked: reRate(ranked, album, to), pending: null });
}

/** Set the rating of the ranked album at global index `from` directly,
 *  re-sorting it to wherever that rating lands it. */
export function setRatingAt(store: RankingStore, from: number, rating: number): void {
  store.setState({ ranked: setRating(store.getState().ranked, from, rating), pending: null });
}

/** Rate the current candidate directly (typed rating or speed-round voice
 *  rating) instead of dragging or comparing it into place. */
export function directRate(store: RankingStore, album: Album, rating: number): void {
  store.setState({ ranked: insertAtRating(store.getState().ranked, album, rating), pending: null });
  store.setLists(removeFromAllLists(store.getLists(), album));
}

/** Set `album` aside into a saved list, removing it from the ranked list
 *  (setAsideAlbum also clears any stale placement). */
export function setAside(store: RankingStore, album: Album, which: ListName): void {
  store.setLists(addToList(store.getLists(), album, which));
  store.setState(setAsideAlbum(store.getState(), album.mbid));
}

/** Insert `placed` at `clamped` (already resolved against the pre-mutation
 *  `before` list the caller drag-computed) and strip it from every saved
 *  list. Takes `before`/`clamped` rather than recomputing them so onPlace's
 *  atom-logging (which needs the same pre-mutation neighbors) stays
 *  untouched by this call. */
export function placeAt(store: RankingStore, before: RankedAlbum[], placed: Album, clamped: number): void {
  store.setState({ ranked: reRate(before, placed, clamped), pending: null });
  store.setLists(removeFromAllLists(store.getLists(), placed));
}
