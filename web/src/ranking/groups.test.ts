import { describe, it, expect } from 'vitest';
import type { RankedAlbum } from './types';
import { groupRanked, type GroupDimension } from './groups';

function album(overrides: Partial<RankedAlbum> & { mbid: string; rating: number }): RankedAlbum {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Artist X',
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

describe('groupRanked', () => {
  it('groups by decade in chronological order, newest first', () => {
    const a1994 = album({ mbid: 'a', rating: 9.5, release_year: 1994 });
    const a2001 = album({ mbid: 'b', rating: 9.0, release_year: 2001 });
    const a1991 = album({ mbid: 'c', rating: 8.0, release_year: 1991 });
    // The best album lives in the 1990s; the 2000s still come first.
    const sections = groupRanked([a1994, a2001, a1991], 'decade');
    expect(sections.map((s) => s.key)).toEqual(['decade:2000', 'decade:1990']);
    expect(sections[1].label).toBe('1990s');
    expect(sections[1].albums).toEqual([a1994, a1991]);
    expect(sections[1].count).toBe(2);
    expect(sections[1].meanRating).toBe(8.75);
  });

  it('groups by year in chronological order, newest first', () => {
    const sections = groupRanked(
      [
        album({ mbid: 'a', rating: 9.0, release_year: 1999 }),
        album({ mbid: 'b', rating: 8.0, release_year: 2007 }),
        album({ mbid: 'c', rating: 7.0, release_year: 2007 }),
      ],
      'year'
    );
    // Best album is from 1999, but years read chronologically.
    expect(sections.map((s) => s.key)).toEqual(['year:2007', 'year:1999']);
    expect(sections[0].label).toBe('2007');
    expect(sections[0].count).toBe(2);
    // Global rating order still holds inside a section.
    expect(sections[0].albums.map((a) => a.mbid)).toEqual(['b', 'c']);
  });

  it('groups by artist using the mbid-first key rule', () => {
    const sections = groupRanked(
      [
        album({ mbid: 'a', rating: 9.0, primary_artist_name: 'The Beatles', primary_artist_mbid: 'mb-1' }),
        album({ mbid: 'b', rating: 8.0, primary_artist_name: 'The Beatles', primary_artist_mbid: 'mb-2' }),
        album({ mbid: 'c', rating: 7.0, primary_artist_name: 'No Mbid Band' }),
      ],
      'artist'
    );
    expect(sections.map((s) => s.key)).toEqual(['artist:mb-1', 'artist:mb-2', 'artist:No Mbid Band']);
    expect(sections[0].label).toBe('The Beatles');
    expect(sections[2].label).toBe('No Mbid Band');
  });

  it('puts null-year albums in a trailing unknown section for year and decade', () => {
    for (const dimension of ['year', 'decade'] as const) {
      const sections = groupRanked(
        [
          album({ mbid: 'a', rating: 9.0, release_year: null }),
          album({ mbid: 'b', rating: 8.0, release_year: 1994 }),
        ],
        dimension
      );
      const last = sections[sections.length - 1];
      expect(last.key).toBe('year:unknown');
      expect(last.label).toBe('Year unknown');
      expect(last.albums.map((x) => x.mbid)).toEqual(['a']);
    }
  });

  it('sorts genre sections by count and collapses singletons into More genres', () => {
    const rock1 = album({ mbid: 'a', rating: 9.0, genres: ['rock', 'shoegaze'] });
    const rock2 = album({ mbid: 'b', rating: 8.0, genres: ['rock'] });
    const ambient = album({ mbid: 'c', rating: 7.0, genres: ['ambient'] });
    const untagged = album({ mbid: 'd', rating: 6.0 });
    const sections = groupRanked([rock1, rock2, ambient, untagged], 'genre');
    expect(sections.map((s) => s.key)).toEqual(['genre:rock', 'genre:more', 'genre:none']);
    expect(sections[0].albums.map((x) => x.mbid)).toEqual(['a', 'b']);
    // shoegaze and ambient are singleton genres; their albums collapse (deduped).
    expect(sections[1].label).toBe('More genres');
    expect(sections[1].albums.map((x) => x.mbid)).toEqual(['a', 'c']);
    expect(sections[2].label).toBe('No genre yet');
    expect(sections[2].albums.map((x) => x.mbid)).toEqual(['d']);
  });

  it('puts a multi-genre album in each of its genre sections', () => {
    const sections = groupRanked(
      [
        album({ mbid: 'a', rating: 9.0, genres: ['rock', 'shoegaze'] }),
        album({ mbid: 'b', rating: 8.0, genres: ['rock'] }),
        album({ mbid: 'c', rating: 7.0, genres: ['shoegaze'] }),
      ],
      'genre'
    );
    expect(sections.map((s) => s.key)).toEqual(['genre:rock', 'genre:shoegaze']);
    expect(sections[0].albums.map((x) => x.mbid)).toEqual(['a', 'b']);
    expect(sections[1].albums.map((x) => x.mbid)).toEqual(['a', 'c']);
  });

  it('breaks genre count ties alphabetically by label', () => {
    const sections = groupRanked(
      [
        album({ mbid: 'a', rating: 9.0, genres: ['shoegaze'] }),
        album({ mbid: 'b', rating: 8.0, genres: ['shoegaze'] }),
        album({ mbid: 'c', rating: 7.0, genres: ['ambient'] }),
        album({ mbid: 'd', rating: 6.0, genres: ['ambient'] }),
      ],
      'genre'
    );
    expect(sections.map((s) => s.key)).toEqual(['genre:ambient', 'genre:shoegaze']);
  });

  it('returns no sections for an empty list in every dimension', () => {
    for (const dimension of ['artist', 'year', 'decade', 'genre'] as GroupDimension[]) {
      expect(groupRanked([], dimension)).toEqual([]);
    }
  });
});
