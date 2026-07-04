import type { Album } from './types';

/**
 * Drag-to-place ordering helpers. Pure and DOM-free.
 *
 * The ranked list is represented directly as an ordered `Album[]` (index 0 =
 * most preferred). Placing an album at a chosen index in an already-ordered
 * list keeps the list an exact total order, so it stays transitive by
 * construction -- the player can never produce a self-contradicting order.
 * This is NOT Elo; there are no ratings, only ordinal position.
 */

/**
 * Return a new array with `album` inserted at `index`. `index` is clamped to
 * `[0, ranked.length]`, so a drop past the end appends and a negative index
 * prepends. The input is never mutated.
 */
export function insertAt(ranked: Album[], album: Album, index: number): Album[] {
  const clamped = Math.max(0, Math.min(index, ranked.length));
  const copy = [...ranked];
  copy.splice(clamped, 0, album);
  return copy;
}

/**
 * Return a new array with the item at `from` moved to `to`. Both indices are
 * interpreted against the array AFTER removal of the moved item (standard
 * splice-move semantics) and clamped to valid bounds. The input is never
 * mutated; an out-of-range `from` returns a shallow copy unchanged.
 */
export function moveItem(ranked: Album[], from: number, to: number): Album[] {
  if (from < 0 || from >= ranked.length) return [...ranked];
  const copy = [...ranked];
  const [item] = copy.splice(from, 1);
  const clamped = Math.max(0, Math.min(to, copy.length));
  copy.splice(clamped, 0, item);
  return copy;
}
