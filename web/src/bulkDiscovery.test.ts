import { describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import type { DiscoverArtistResult } from './discovery';
import { topRankedArtists, runBulkDiscovery } from './bulkDiscovery';

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

describe('runBulkDiscovery', () => {
  const radiohead = { mbid: 'artist-radiohead', name: 'Radiohead' };
  const bjork = { mbid: 'artist-bjork', name: 'Björk' };

  function rankedFor(artists: { mbid: string; name: string }[]): Album[] {
    return artists.map((a, i) =>
      album({ mbid: `ranked-${i}`, primary_artist_name: a.name, primary_artist_mbid: a.mbid })
    );
  }

  it('short-circuits with an unlock message when the first call is locked', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'locked' }));

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      ['existing-mbid'],
      { discover, delayMs: 0 }
    );

    expect(result).toEqual({
      priorityQueue: ['existing-mbid'],
      summary: 'Unlock writes to fill in more albums.',
    });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('continues the batch when one artist errors, and reports the failure count', async () => {
    const discover = vi.fn(async (artistName: string): Promise<DiscoverArtistResult> => {
      if (artistName === 'Radiohead') return { status: 'error' };
      return {
        status: 'found',
        albums: [album({ mbid: 'new-bjork-album', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' })],
      };
    });

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      [],
      { discover, delayMs: 0 }
    );

    expect(result.priorityQueue).toEqual(['new-bjork-album']);
    expect(result.summary).toBe('Added 1 new albums from 2 artists. 0 already fully discovered, 1 failed.');
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('prepends newly found albums in top-artist-first order, ahead of the existing queue', async () => {
    const discover = vi.fn(async (artistName: string): Promise<DiscoverArtistResult> => ({
      status: 'found',
      albums: [
        album({
          mbid: `new-${artistName}`,
          primary_artist_name: artistName,
          primary_artist_mbid: artistName === 'Radiohead' ? 'artist-radiohead' : 'artist-bjork',
        }),
      ],
    }));

    const result = await runBulkDiscovery(
      rankedFor([radiohead, bjork]),
      [],
      ['old-queued-mbid'],
      { discover, delayMs: 0 }
    );

    expect(result.priorityQueue).toEqual(['new-Radiohead', 'new-Björk', 'old-queued-mbid']);
  });

  it('reports an empty-catalog artist without treating it as a failure', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    const result = await runBulkDiscovery(rankedFor([radiohead]), [], [], { discover, delayMs: 0 });

    expect(result.summary).toBe('Added 0 new albums from 1 artists. 1 already fully discovered, 0 failed.');
  });

  it('returns a "rank some albums first" message and makes no calls when nothing is ranked', async () => {
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    const result = await runBulkDiscovery([], [], ['old-mbid'], { discover, delayMs: 0 });

    expect(result).toEqual({ priorityQueue: ['old-mbid'], summary: 'Rank some albums first.' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('passes each artist\'s pool-matched mbids as knownMbids', async () => {
    const pool: Album[] = [
      album({ mbid: 'existing-radiohead-1', primary_artist_name: 'Radiohead', primary_artist_mbid: 'artist-radiohead' }),
      album({ mbid: 'existing-bjork-1', primary_artist_name: 'Björk', primary_artist_mbid: 'artist-bjork' }),
    ];
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    await runBulkDiscovery(rankedFor([radiohead]), pool, [], { discover, delayMs: 0 });

    expect(discover).toHaveBeenCalledWith('Radiohead', 'artist-radiohead', ['existing-radiohead-1']);
  });

  it('does not count an already-pooled album as "new" in the summary', async () => {
    // The API merges previously-unranked albums back into a "found" result
    // (so the single-artist "discover more" button can resurface backlog).
    // For an artist already discovered before, that means `result.albums`
    // can include an mbid the client's `pool` already has.
    const alreadyPooled = album({
      mbid: 'existing-bjork-1',
      primary_artist_name: 'Björk',
      primary_artist_mbid: 'artist-bjork',
    });
    const pool: Album[] = [alreadyPooled];
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({
      status: 'found',
      albums: [alreadyPooled],
    }));

    const result = await runBulkDiscovery(rankedFor([bjork]), pool, [], { discover, delayMs: 0 });

    expect(pool).toHaveLength(1);
    expect(result.summary).toBe('Added 0 new albums from 1 artists.');
  });
});
