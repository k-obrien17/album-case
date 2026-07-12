import { describe, expect, it } from 'vitest';
import type { RankedAlbum } from './types';
import { ratingForDropIndex } from './rating';

function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: 'Artist',
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
    rating,
  };
}

describe('ratingForDropIndex', () => {
  it('returns the midpoint of the two neighboring ratings', () => {
    const ranked = [rankedAlbum('a', 9), rankedAlbum('b', 7)];
    expect(ratingForDropIndex(ranked, 1)).toBe(8);
  });

  it('rounds the midpoint to 2 decimal places', () => {
    const ranked = [rankedAlbum('a', 9.5), rankedAlbum('b', 9.49)];
    expect(ratingForDropIndex(ranked, 1)).toBe(9.5);
  });

  it('clamps at the ceiling when dropped at the very top', () => {
    const ranked = [rankedAlbum('a', 9.8), rankedAlbum('b', 5)];
    expect(ratingForDropIndex(ranked, 0)).toBe(10);
  });

  it('does not exceed 10 when dropped at the top of an already-high list', () => {
    const ranked = [rankedAlbum('a', 9.9)];
    expect(ratingForDropIndex(ranked, 0)).toBe(10);
  });

  it('clamps at the floor when dropped at the very bottom', () => {
    const ranked = [rankedAlbum('a', 5), rankedAlbum('b', 1.2)];
    expect(ratingForDropIndex(ranked, 2)).toBe(1);
  });

  it('does not go below 1 when dropped at the bottom of an already-low list', () => {
    const ranked = [rankedAlbum('a', 1.1)];
    expect(ratingForDropIndex(ranked, 1)).toBe(1);
  });

  it('returns 10 for the first album in an empty list', () => {
    expect(ratingForDropIndex([], 0)).toBe(10);
  });

  it('clamps an out-of-range index into range before interpolating', () => {
    const ranked = [rankedAlbum('a', 9), rankedAlbum('b', 7)];
    expect(ratingForDropIndex(ranked, 99)).toBe(1);
    expect(ratingForDropIndex(ranked, -5)).toBe(10);
  });
});
