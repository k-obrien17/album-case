import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import {
  artistKeys,
  nextPriorityCandidate,
  priorityQueueFromAlbumPlan,
  priorityQueueFromArtists,
  priorityQueueFromArtistText,
} from './priority';

function album(mbid: string, artist: string, title = `Title ${mbid}`): Album {
  return {
    mbid,
    title,
    primary_artist_name: artist,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

const pool = [
  album('k1', 'Kanye West', 'The College Dropout'),
  album('k2', 'Kanye West', 'My Beautiful Dark Twisted Fantasy'),
  album('r1', 'Radiohead', 'OK Computer'),
  album('b1', 'Beyoncé', 'Lemonade'),
  album('m1', 'Massive Attack', 'Blue Lines'),
];

describe('priority queue from artist text', () => {
  it('matches artists in pasted order and includes their seed albums', () => {
    expect(priorityQueueFromArtistText('Radiohead3826 Kanye West58 Beyoncé13', pool)).toEqual([
      'r1',
      'k1',
      'k2',
      'b1',
    ]);
  });

  it('accent-folds artist names', () => {
    expect(priorityQueueFromArtistText('Beyonce', pool)).toEqual(['b1']);
  });

  it('ignores unknown artists', () => {
    expect(priorityQueueFromArtistText('Ben Frost / The Clean', pool)).toEqual([]);
  });

  it('matches a slash-credited album ("Genius/GZA") from its listed member ("GZA")', () => {
    const slashPool = [album('gza', 'Genius/GZA', 'Liquid Swords')];
    expect(priorityQueueFromArtistText('GZA', slashPool)).toEqual(['gza']);
  });
});

describe('artistKeys', () => {
  it('splits slash-credits so either member can match', () => {
    expect(artistKeys('Genius/GZA')).toContain('gza');
    expect(artistKeys('Jonny Greenwood')).toEqual(['jonny greenwood']);
  });
});

describe('priorityQueueFromArtists (auto-seed)', () => {
  it('yields the highest-priority artist first, slash-aware', () => {
    const seedPool = [
      album('x1', 'Some Canon Band'),
      album('gza', 'Genius/GZA', 'Liquid Swords'),
      album('r1', 'Radiohead', 'Kid A'),
      album('gw', 'Jonny Greenwood', 'There Will Be Blood'),
    ];
    // Ordered highest-plays first: Radiohead, GZA, Jonny Greenwood.
    expect(priorityQueueFromArtists(['Radiohead', 'GZA', 'Jonny Greenwood'], seedPool)).toEqual([
      'r1',
      'gza',
      'gw',
    ]);
  });
});

describe('priorityQueueFromAlbumPlan', () => {
  it('matches album titles in plan order', () => {
    expect(
      priorityQueueFromAlbumPlan(
        [
          { artist: 'Kanye West', title: 'My Beautiful Dark Twisted Fantasy' },
          { artist: 'Radiohead', title: 'OK Computer' },
          { artist: 'Kanye West', title: 'The College Dropout' },
        ],
        pool
      )
    ).toEqual(['k2', 'r1', 'k1']);
  });

  it('uses artist names to disambiguate matching titles', () => {
    const duplicateTitlePool = [
      album('bowie-low', 'David Bowie', 'Low'),
      album('band-low', 'Low', 'Low'),
    ];

    expect(
      priorityQueueFromAlbumPlan(
        [{ artist: 'Low', title: 'Low' }],
        duplicateTitlePool
      )
    ).toEqual(['band-low']);
  });

  it('ignores unavailable albums and de-dupes repeated plan entries', () => {
    expect(
      priorityQueueFromAlbumPlan(
        [
          { artist: 'Radiohead', title: 'OK Computer' },
          { artist: 'Radiohead', title: 'OK Computer' },
          { artist: 'Unknown', title: 'Missing Album' },
        ],
        pool
      )
    ).toEqual(['r1']);
  });

  it('only queues accepted or unreviewed plan entries', () => {
    expect(
      priorityQueueFromAlbumPlan(
        [
          { artist: 'Radiohead', title: 'OK Computer', review_status: 'accept' },
          { artist: 'Kanye West', title: 'The College Dropout', review_status: 'reject' },
          { artist: 'Massive Attack', title: 'Blue Lines', review_status: 'defer' },
          { artist: 'Kanye West', title: 'My Beautiful Dark Twisted Fantasy' },
        ],
        pool
      )
    ).toEqual(['r1', 'k2']);
  });
});

describe('nextPriorityCandidate', () => {
  it('returns the first queued album that is not ranked or excluded', () => {
    const result = nextPriorityCandidate(['k1', 'r1', 'm1'], pool, [album('k1', 'Kanye West')], new Set(['r1']));

    expect(result.candidate?.mbid).toBe('m1');
    expect(result.queue).toEqual(['m1']);
  });

  it('drops unknown and duplicate ids from the queue', () => {
    const result = nextPriorityCandidate(['missing', 'k1', 'k1'], pool, [], new Set());

    expect(result.candidate?.mbid).toBe('k1');
    expect(result.queue).toEqual(['k1']);
  });
});
