import { describe, it, expect } from 'vitest';
import { saveRanking, loadRanking } from './storage';
import type { RankingState } from './ranking/types';

describe('ranking state persistence', () => {
  it('round-trips a RankingState through save/load', () => {
    const state: RankingState = {
      ranked: [
        {
          mbid: 'a',
          title: 'A',
          primary_artist_name: 'Artist A',
          release_year: 2000,
          cover_url: 'https://example.test/a.jpg',
        },
      ],
      pending: null,
    };

    saveRanking(state);
    expect(loadRanking()).toEqual(state);
  });

  it('normalizes stale pending placement data away on load', () => {
    const state: RankingState = {
      ranked: [
        {
          mbid: 'a',
          title: 'A',
          primary_artist_name: 'Artist A',
          release_year: 2000,
          cover_url: 'https://example.test/a.jpg',
        },
      ],
      pending: {
        album: {
          mbid: 'b',
          title: 'B',
          primary_artist_name: 'Artist B',
          release_year: 2001,
          cover_url: 'https://example.test/b.jpg',
        },
        lo: 0,
        hi: 1,
      },
    };

    saveRanking(state);
    expect(loadRanking()).toEqual({ ranked: state.ranked, pending: null });
  });
});
