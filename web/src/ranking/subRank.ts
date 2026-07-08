import type { Album } from './types';

export type SubRank = {
  artistRank: number;
  artistTotal: number;
  yearRank: number | null;
  yearTotal: number | null;
  overallRank: number;
  overallTotal: number;
};

export function computeSubRanks(ranked: Album[]): Map<string, SubRank> {
  const byArtist = new Map<string, Album[]>();
  const byYear = new Map<number, Album[]>();

  for (const album of ranked) {
    const artistGroup = byArtist.get(album.primary_artist_name) ?? [];
    artistGroup.push(album);
    byArtist.set(album.primary_artist_name, artistGroup);

    if (album.release_year != null) {
      const yearGroup = byYear.get(album.release_year) ?? [];
      yearGroup.push(album);
      byYear.set(album.release_year, yearGroup);
    }
  }

  const result = new Map<string, SubRank>();
  ranked.forEach((album, index) => {
    const artistGroup = byArtist.get(album.primary_artist_name) as Album[];
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
