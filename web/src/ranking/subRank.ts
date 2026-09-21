import type { Album } from './types';

export type SubRank = {
  artistRank: number;
  artistTotal: number;
  yearRank: number | null;
  yearTotal: number | null;
  overallRank: number;
  overallTotal: number;
};

// Artists collide by display name across distinct real MusicBrainz artists
// (and one artist's name can be inconsistently cased/formatted), so group by
// the stable `primary_artist_mbid` when it's present, falling back to
// `primary_artist_name` only when an album has no mbid on record.
function artistGroupKey(album: Album): string {
  return album.primary_artist_mbid ?? album.primary_artist_name;
}

export function computeSubRanks(ranked: Album[]): Map<string, SubRank> {
  const byArtist = new Map<string, Album[]>();
  const byYear = new Map<number, Album[]>();

  for (const album of ranked) {
    const key = artistGroupKey(album);
    const artistGroup = byArtist.get(key) ?? [];
    artistGroup.push(album);
    byArtist.set(key, artistGroup);

    if (album.release_year != null) {
      const yearGroup = byYear.get(album.release_year) ?? [];
      yearGroup.push(album);
      byYear.set(album.release_year, yearGroup);
    }
  }

  const result = new Map<string, SubRank>();
  ranked.forEach((album, index) => {
    const artistGroup = byArtist.get(artistGroupKey(album)) as Album[];
    const artistRank = artistGroup.indexOf(album) + 1;
    const artistTotal = artistGroup.length;

    let yearRank: number | null = null;
    let yearTotal: number | null = null;
    if (album.release_year != null) {
      const yearGroup = byYear.get(album.release_year) as Album[];
      yearRank = yearGroup.indexOf(album) + 1;
      yearTotal = yearGroup.length;
    }

    result.set(album.mbid, {
      artistRank,
      artistTotal,
      yearRank,
      yearTotal,
      overallRank: index + 1,
      overallTotal: ranked.length,
    });
  });

  return result;
}
