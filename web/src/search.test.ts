import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import { filterAlbums } from './search';

function album(overrides: Partial<Album> & { mbid: string }): Album {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Unknown Artist',
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

const albums = [
  album({ mbid: 'a', title: 'OK Computer', primary_artist_name: 'Radiohead' }),
  album({ mbid: 'b', title: 'Kid A', primary_artist_name: 'Radiohead' }),
  album({ mbid: 'c', title: 'Dummy', primary_artist_name: 'Portishead' }),
];

describe('filterAlbums', () => {
  it('returns everything for an empty query', () => {
    expect(filterAlbums(albums, '')).toHaveLength(3);
  });

  it('returns everything for a whitespace-only query', () => {
    expect(filterAlbums(albums, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(filterAlbums(albums, 'ok comp').map((a) => a.mbid)).toEqual(['a']);
  });

  it('matches on artist, case-insensitively', () => {
    expect(filterAlbums(albums, 'RADIOHEAD').map((a) => a.mbid)).toEqual(['a', 'b']);
  });

  it('matches a substring anywhere in the field', () => {
    expect(filterAlbums(albums, 'head').map((a) => a.mbid)).toEqual(['a', 'b', 'c']);
  });

  it('trims the query before matching', () => {
    expect(filterAlbums(albums, '  dummy  ').map((a) => a.mbid)).toEqual(['c']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterAlbums(albums, 'zzz')).toEqual([]);
  });

  it('preserves the input order', () => {
    expect(filterAlbums(albums, 'head').map((a) => a.mbid)).toEqual(['a', 'b', 'c']);
  });
});
