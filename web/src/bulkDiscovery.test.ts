import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import { topRankedArtists } from './bulkDiscovery';

function album(overrides: Partial<Album> & { mbid: string }): Album {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Unknown Artist',
    primary_artist_mbid: undefined,
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    ...overrides,
  };
}

describe('topRankedArtists', () => {
  it('returns distinct artists in rank order, keeping the first (highest-ranked) occurrence', () => {
    const ranked = [
      album({ mbid: 'a1', primary_artist_name: 'Radiohead', primary_artist_mbid: 'artist-radiohead' }),
      album({ mbid: 'b1', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' }),
      album({ mbid: 'a2', primary_artist_name: 'Radiohead', primary_artist_mbid: 'artist-radiohead' }),
    ];

    const result = topRankedArtists(ranked, 10);

    expect(result).toEqual([
      { mbid: 'artist-radiohead', name: 'Radiohead' },
      { mbid: 'artist-bjork', name: 'Björk' },
    ]);
  });

  it('skips albums with no primary_artist_mbid', () => {
    const ranked = [
      album({ mbid: 'a1', primary_artist_name: 'No MBID Artist', primary_artist_mbid: undefined }),
      album({ mbid: 'b1', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' }),
    ];

    const result = topRankedArtists(ranked, 10);

    expect(result).toEqual([{ mbid: 'artist-bjork', name: 'Björk' }]);
  });

  it('stops at n distinct artists even if the ranked list has more', () => {
    const ranked = [
      album({ mbid: 'a1', primary_artist_name: 'Artist A', primary_artist_mbid: 'artist-a' }),
      album({ mbid: 'b1', primary_artist_name: 'Artist B', primary_artist_mbid: 'artist-b' }),
      album({ mbid: 'c1', primary_artist_name: 'Artist C', primary_artist_mbid: 'artist-c' }),
    ];

    const result = topRankedArtists(ranked, 2);

    expect(result).toEqual([
      { mbid: 'artist-a', name: 'Artist A' },
      { mbid: 'artist-b', name: 'Artist B' },
    ]);
  });

  it('returns everything when there are fewer than n distinct artists', () => {
    const ranked = [album({ mbid: 'a1', primary_artist_name: 'Artist A', primary_artist_mbid: 'artist-a' })];

    const result = topRankedArtists(ranked, 10);

    expect(result).toEqual([{ mbid: 'artist-a', name: 'Artist A' }]);
  });

  it('returns an empty array for an empty ranked list', () => {
    expect(topRankedArtists([], 10)).toEqual([]);
  });
});
