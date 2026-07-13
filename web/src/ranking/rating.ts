import type { RankedAlbum } from './types';

/**
 * The rating a newly-placed album should get to land at `index` in `ranked`
 * -- an array already sorted by rating descending, assumed NOT to contain
 * the album being placed (remove it first if re-rating an existing one).
 *
 * Interpolates the midpoint between the ratings immediately above and below
 * the target index; clamps to the 0-10 range at either end of the list.
 * 2 decimal places, matching the site-export formula's precision (see
 * docs/superpowers/specs/2026-07-11-album-score-export-design.md for why:
 * avoids ties across a realistic album count).
 *
 * Known, accepted limitation: repeatedly dropping albums into the exact
 * same narrow gap will eventually exhaust the 0.01 precision available
 * between two neighbors, producing a tie. Not solved here.
 */
export function ratingForDropIndex(ranked: RankedAlbum[], index: number): number {
  // Out-of-range indices return extreme ratings directly
  if (index < 0) return 10;
  if (index > ranked.length) return 0;

  const clamped = Math.max(0, Math.min(index, ranked.length));
  const above = ranked[clamped - 1]?.rating;
  const below = ranked[clamped]?.rating;

  if (above == null && below == null) return 10;
  if (above == null) return Math.min(10, round2(below! + 0.5));
  if (below == null) return Math.max(0, round2(above - 0.5));
  return round2((above + below) / 2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
