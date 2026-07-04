import { describe, expect, it } from 'vitest';
import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';
import { snapshotPayload } from './rankingSync';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('ranking snapshot payload', () => {
  it('serializes only MBIDs plus session id', () => {
    const state: RankingState = { ranked: [album('a'), album('b')], pending: null };
    const lists: SavedLists = { wantToListen: [album('c')], notHeard: [album('d')] };

    expect(snapshotPayload('session-1', state, lists)).toEqual({
      session_id: 'session-1',
      ranked: ['a', 'b'],
      lists: {
        wantToListen: ['c'],
        notHeard: ['d'],
      },
    });
  });
});
