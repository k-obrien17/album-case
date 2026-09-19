import type { Album, RankedAlbum } from '../../src/ranking/types';

/**
 * Deterministic e2e fixtures. Real MBIDs aren't needed -- parseAlbum
 * (src/album.ts) only requires primary_artist_mbid to look like a UUID, not
 * to resolve against MusicBrainz. Every fixture album gets its own distinct
 * "artist" so `pickCandidate` (src/seed.ts) never has more than one eligible
 * unranked album to choose from per spec, keeping candidate selection
 * deterministic without needing to inject an rng.
 */

function uuid(seed: number): string {
  const hex = seed.toString(16).padStart(4, '0'); // 4 hex chars
  return `${hex}${hex}-${hex}-${hex}-${hex}-${hex}${hex}${hex}`; // 8-4-4-4-12
}

export function album(seed: number, overrides: Partial<Album> = {}): Album {
  return {
    mbid: `album-${seed}`,
    title: `Fixture Album ${seed}`,
    primary_artist_name: `Fixture Artist ${seed}`,
    primary_artist_mbid: uuid(seed),
    release_year: 2000 + seed,
    cover_url: '',
    ...overrides,
  };
}

export function ranked(seed: number, rating: number, overrides: Partial<Album> = {}): RankedAlbum {
  return { ...album(seed, overrides), rating };
}

/** A distinct album (its own mbid/title) credited to the same artist as
 *  `album(artistSeed, ...)` -- for scenarios that need an artist with both a
 *  ranked and an unranked album (e.g. to reach the "View all N <artist>
 *  albums" button, which only renders once an artist has 2+ total). */
export function albumForArtist(seed: number, artistSeed: number, overrides: Partial<Album> = {}): Album {
  const artist = album(artistSeed);
  return album(seed, {
    primary_artist_name: artist.primary_artist_name,
    primary_artist_mbid: artist.primary_artist_mbid,
    ...overrides,
  });
}

export type SnapshotFixture = {
  ranked: RankedAlbum[];
  lists?: {
    wantToListen: Album[];
    notHeard: Album[];
    dontCare: Album[];
  };
  artist_locks?: unknown[];
  blocked_artists?: string[];
  curated_skips?: string[];
  updated_at: number;
};

export function snapshot(rankedAlbums: RankedAlbum[], updatedAt = 1): SnapshotFixture {
  return {
    ranked: rankedAlbums,
    lists: { wantToListen: [], notHeard: [], dontCare: [] },
    artist_locks: [],
    blocked_artists: [],
    curated_skips: [],
    updated_at: updatedAt,
  };
}
