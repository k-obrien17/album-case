/**
 * Album record shape shared with the MVP seed (web/public/seed/albums.json)
 * and the backend allowlist. Kept in sync with the `entities` album row.
 */
export type Album = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  primary_artist_mbid?: string;
  release_year: number | null;
  cover_url: string;
};

/** An album that's actually in the ranked list — carries a rating, the
 *  single source of truth for its position. Pool/candidate/seed albums
 *  are plain `Album`s with no rating until they're placed. */
export type RankedAlbum = Album & {
  rating: number; // 0.00-10.00, 2 decimal places.
};

/**
 * A frozen relative order for one artist's albums. `order` holds album mbids
 * in locked relative order (index 0 = most preferred). Enforcement only
 * checks the relative order of these mbids within `ranked` -- other albums
 * may sit anywhere between/around them.
 */
export type ArtistLock = {
  artistMbid: string;
  order: string[];
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
  ranked: RankedAlbum[];
  pending: Pending | null;
};

/** The pair to show the player next: `candidate` vs the current `opponent`. */
export type Comparison = {
  candidate: Album;
  opponent: Album;
};
