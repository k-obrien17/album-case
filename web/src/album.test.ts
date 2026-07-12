import { describe, expect, it } from 'vitest';
import { parseAlbum, parseAlbumArray, parseRankedAlbum } from './album';

describe('album parsing', () => {
  it('keeps valid album fields including primary artist mbid', () => {
    expect(
      parseAlbum({
        mbid: 'album-1',
        title: 'Kid A',
        primary_artist_name: 'Radiohead',
        primary_artist_mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        release_year: 2000,
        cover_url: 'https://example.test/kid-a.jpg',
      })
    ).toEqual({
      mbid: 'album-1',
      title: 'Kid A',
      primary_artist_name: 'Radiohead',
      primary_artist_mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      release_year: 2000,
      cover_url: 'https://example.test/kid-a.jpg',
    });
  });

  it('drops malformed entries from arrays', () => {
    expect(
      parseAlbumArray([
        { mbid: 'a', title: 'A', primary_artist_name: 'Artist A' },
        { mbid: '', title: 'B', primary_artist_name: 'Artist B' },
        { mbid: 'c', primary_artist_name: 'Artist C' },
      ])
    ).toEqual([
      {
        mbid: 'a',
        title: 'A',
        primary_artist_name: 'Artist A',
        release_year: null,
        cover_url: '',
      },
    ]);
  });
});

describe('parseRankedAlbum', () => {
  it('parses a valid rating', () => {
    const result = parseRankedAlbum({
      mbid: 'a1',
      title: 'Title',
      primary_artist_name: 'Artist',
      release_year: 2000,
      cover_url: 'https://example.test/a1.jpg',
      rating: 8.43,
    });
    expect(result?.rating).toBe(8.43);
  });

  it('rejects a missing or non-numeric rating', () => {
    const base = {
      mbid: 'a1',
      title: 'Title',
      primary_artist_name: 'Artist',
      release_year: 2000,
      cover_url: 'https://example.test/a1.jpg',
    };
    expect(parseRankedAlbum(base)).toBeNull();
    expect(parseRankedAlbum({ ...base, rating: 'high' })).toBeNull();
  });
});
