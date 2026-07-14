import { describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import type { DiscoverArtistResult } from './discovery';
import {
  topRankedArtists,
  runBulkDiscovery,
  rankSimilarArtists,
  runSimilarExpansion,
  type SimilarArtist,
} from './bulkDiscovery';

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

const radiohead = { mbid: 'artist-radiohead', name: 'Radiohead' };
const bjork = { mbid: 'artist-bjork', name: 'Björk' };

function rankedFor(artists: { mbid: string; name: string }[]): Album[] {
  return artists.map((a, i) =>
    album({ mbid: `ranked-${i}`, primary_artist_name: a.name, primary_artist_mbid: a.mbid })
  );
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
      found: 0,
      locked: true,
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

    expect(result).toEqual({
      priorityQueue: ['old-mbid'],
      summary: 'Rank some albums first.',
      found: 0,
      locked: false,
    });
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

describe('rankSimilarArtists', () => {
  const sa = (mbid: string, name: string, score: number): SimilarArtist => ({ mbid, name, score });

  it('normalizes each seed list before summing, so one seed\'s larger raw scale cannot dominate', () => {
    // Seed A scores in the thousands, seed B in single digits. "shared" is
    // mid-strength in both: normalized 600/1000 + 6/10 = 1.2, strictly above
    // "loud" (1000/1000 = 1.0) despite loud's huge raw score.
    const seedA = [sa('loud', 'Loud', 1000), sa('shared', 'Shared', 600)];
    const seedB = [sa('shared', 'Shared', 6), sa('quiet', 'Quiet', 10)];
    const out = rankSimilarArtists([seedA, seedB], new Set(), [], 3);
    expect(out[0]).toEqual({ mbid: 'shared', name: 'Shared' });
  });

  it('an artist similar to several seeds outranks one similar to a single seed', () => {
    // multi: 60/100 + 60/100 = 1.2 -- strictly above the per-list maxes
    // (topA/topB at 1.0 each) and solo (80/100 = 0.8). No ties anywhere.
    const seedA = [sa('topA', 'TopA', 100), sa('multi', 'Multi', 60), sa('solo', 'Solo', 80)];
    const seedB = [sa('topB', 'TopB', 100), sa('multi', 'Multi', 60)];
    const out = rankSimilarArtists([seedA, seedB], new Set(), [], 4);
    expect(out[0].mbid).toBe('multi');
    expect(out.findIndex((a) => a.mbid === 'multi')).toBeLessThan(out.findIndex((a) => a.mbid === 'solo'));
  });

  it('excludes artists already represented in the library (by mbid)', () => {
    const seed = [sa('have', 'Have', 100), sa('new', 'New', 50)];
    const out = rankSimilarArtists([seed], new Set(['have']), [], 5);
    expect(out.map((a) => a.mbid)).toEqual(['new']);
  });

  it('excludes blocked artists by name, case-insensitively', () => {
    const seed = [sa('x', 'Coldplay', 100), sa('y', 'Pixies', 90)];
    const out = rankSimilarArtists([seed], new Set(), ['coldplay'], 5);
    expect(out.map((a) => a.name)).toEqual(['Pixies']);
  });

  it('caps at n', () => {
    const seed = [sa('a', 'A', 5), sa('b', 'B', 4), sa('c', 'C', 3)];
    expect(rankSimilarArtists([seed], new Set(), [], 2)).toHaveLength(2);
  });

  it('returns empty for no seed lists', () => {
    expect(rankSimilarArtists([], new Set(), [], 5)).toEqual([]);
  });

  it('ignores empty seed lists without dividing by zero', () => {
    const seed = [sa('a', 'A', 10)];
    expect(rankSimilarArtists([seed, []], new Set(), [], 5).map((a) => a.mbid)).toEqual(['a']);
  });
});

describe('runSimilarExpansion', () => {
  it("reports a ListenBrainz failure when every seed's similar-artist fetch fails", async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => null);
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    const result = await runSimilarExpansion(
      rankedFor([radiohead, bjork]),
      [],
      ['existing-mbid'],
      [],
      { fetchSimilar, discover, delayMs: 0 }
    );

    expect(result).toEqual({
      priorityQueue: ['existing-mbid'],
      summary: "Couldn't reach ListenBrainz — try again.",
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it('excludes similar artists already represented in ranked/pool before discovering', async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => [
      { mbid: 'artist-radiohead', name: 'Radiohead', score: 100 },
      { mbid: 'artist-new', name: 'Pixies', score: 90 },
    ]);
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({
      status: 'found',
      albums: [album({ mbid: 'new-pixies-album', primary_artist_name: 'Pixies', primary_artist_mbid: 'artist-new' })],
    }));

    await runSimilarExpansion(rankedFor([radiohead]), [], [], [], { fetchSimilar, discover, delayMs: 0 });

    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith('Pixies', 'artist-new', []);
  });

  it('short-circuits with an unlock message when a discovery call is locked', async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => [
      { mbid: 'artist-pixies', name: 'Pixies', score: 90 },
    ]);
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'locked' }));

    const result = await runSimilarExpansion(
      rankedFor([radiohead]),
      [],
      ['old-mbid'],
      [],
      { fetchSimilar, discover, delayMs: 0 }
    );

    expect(result).toEqual({
      priorityQueue: ['old-mbid'],
      summary: 'Unlock writes to fill in more albums.',
    });
  });

  it('discovers each new similar artist and names them in the summary', async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => [
      { mbid: 'artist-pixies', name: 'Pixies', score: 90 },
      { mbid: 'artist-slowdive', name: 'Slowdive', score: 80 },
    ]);
    const discover = vi.fn(async (artistName: string): Promise<DiscoverArtistResult> => ({
      status: 'found',
      albums: [
        album({
          mbid: `new-${artistName}`,
          primary_artist_name: artistName,
          primary_artist_mbid: artistName === 'Pixies' ? 'artist-pixies' : 'artist-slowdive',
        }),
      ],
    }));

    const result = await runSimilarExpansion(
      rankedFor([radiohead]),
      [],
      ['old-mbid'],
      [],
      { fetchSimilar, discover, delayMs: 0 }
    );

    expect(result.priorityQueue).toEqual(['new-Pixies', 'new-Slowdive', 'old-mbid']);
    expect(result.summary).toBe('Added 2 albums from 2 similar artists: Pixies, Slowdive.');
  });

  it('reports no new similar artists when every candidate is already represented or blocked', async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => [
      { mbid: 'artist-radiohead', name: 'Radiohead', score: 100 },
    ]);
    const discover = vi.fn(async (): Promise<DiscoverArtistResult> => ({ status: 'empty' }));

    const result = await runSimilarExpansion(
      rankedFor([radiohead]),
      [],
      [],
      [],
      { fetchSimilar, discover, delayMs: 0 }
    );

    expect(result.summary).toBe('No new similar artists found.');
    expect(discover).not.toHaveBeenCalled();
  });

  it('tolerates a per-artist discovery failure and reports both outcomes honestly', async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtist[] | null> => [
      { mbid: 'artist-pixies', name: 'Pixies', score: 90 },
      { mbid: 'artist-slowdive', name: 'Slowdive', score: 80 },
    ]);
    const discover = vi.fn(async (artistName: string): Promise<DiscoverArtistResult> => {
      if (artistName === 'Pixies') return { status: 'error' };
      return {
        status: 'found',
        albums: [
          album({ mbid: 'new-slowdive-album', primary_artist_name: 'Slowdive', primary_artist_mbid: 'artist-slowdive' }),
        ],
      };
    });

    const result = await runSimilarExpansion(
      rankedFor([radiohead]),
      [],
      [],
      [],
      { fetchSimilar, discover, delayMs: 0 }
    );

    expect(result.summary).toBe('Added 1 albums from 1 similar artists: Slowdive. 1 failed.');
  });
});
