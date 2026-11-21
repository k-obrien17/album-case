import { describe, it, expect } from 'vitest';
import { recentlyRanked } from './recentlyRanked';
import type { RankedAlbum } from './ranking/types';

const a = (mbid: string, rated_at?: number): RankedAlbum => ({
  mbid, title: mbid, primary_artist_name: 'X', release_year: 2000, cover_url: '', rating: 5,
  ...(rated_at ? { rated_at } : {}),
});

describe('recentlyRanked', () => {
  it('sorts newest first, drops undated, respects limit', () => {
    const r = recentlyRanked([a('old', 1), a('none'), a('new', 3), a('mid', 2)], 2);
    expect(r.map((x) => x.mbid)).toEqual(['new', 'mid']);
  });
});
