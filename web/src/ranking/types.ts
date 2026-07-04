/**
 * Album record shape shared with the MVP seed (web/public/seed/albums.json)
 * and the backend allowlist. Kept in sync with the `entities` album row.
 */
export type Album = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  release_year: number | null;
  cover_url: string;
};

/** An in-progress binary-insertion placement of `album` into a ranked list. */
export type Pending = {
  album: Album;
  lo: number;
  hi: number;
};

/**
 * The full state of the ranking engine: the player's current ordered list
 * (index 0 = most preferred) plus at most one in-progress placement.
 * Deliberately plain-data so it round-trips through JSON for persistence.
 */
export type RankingState = {
  ranked: Album[];
  pending: Pending | null;
};

/** The pair to show the player next: `candidate` vs the current `opponent`. */
export type Comparison = {
  candidate: Album;
  opponent: Album;
};
