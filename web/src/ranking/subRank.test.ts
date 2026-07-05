import { describe, it, expect } from 'vitest';
import type { Album } from './types';
import { computeSubRanks } from './subRank';

function album(overrides: Partial<Album> & { mbid: string }): Album {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Artist X',
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

describe('computeSubRanks', () => {
  it('ranks albums by the same artist in overall ranked order', () => {
    const ranked = [
      album({ mbid: 'a', primary_artist_name: 'Radiohead' }),
      album({ mbid: 'b', primary_artist_name: 'Other' }),
      album({ mbid: 'c', primary_artist_name: 'Radiohead' }),
    ];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toMatchObject({ artistRank: 1, artistTotal: 2 });
    expect(ranks.get('c')).toMatchObject({ artistRank: 2, artistTotal: 2 });
    expect(ranks.get('b')).toMatchObject({ artistRank: 1, artistTotal: 1 });
  });

  it('ranks albums from the same year in overall ranked order', () => {
    const ranked = [
      album({ mbid: 'a', release_year: 2007 }),
      album({ mbid: 'b', release_year: 2000 }),
      album({ mbid: 'c', release_year: 2007 }),
    ];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toMatchObject({ yearRank: 1, yearTotal: 2 });
    expect(ranks.get('c')).toMatchObject({ yearRank: 2, yearTotal: 2 });
    expect(ranks.get('b')).toMatchObject({ yearRank: 1, yearTotal: 1 });
  });

  it('excludes a null-year album from year grouping but still ranks it by artist', () => {
    const ranked = [album({ mbid: 'a', release_year: null })];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toEqual({
      artistRank: 1,
      artistTotal: 1,
      yearRank: null,
      yearTotal: null,
    });
  });

  it('always includes an entry for a solo artist/year, no suppression', () => {
    const ranked = [album({ mbid: 'a' })];
    const ranks = computeSubRanks(ranked);
    expect(ranks.get('a')).toEqual({ artistRank: 1, artistTotal: 1, yearRank: 1, yearTotal: 1 });
  });

  it('returns an empty map for an empty ranked list', () => {
    expect(computeSubRanks([]).size).toBe(0);
  });
});
