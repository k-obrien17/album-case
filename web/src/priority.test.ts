import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import { nextPriorityCandidate, priorityQueueFromArtistText } from './priority';

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
