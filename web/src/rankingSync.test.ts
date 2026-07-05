import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';
import { loadRankingSnapshot, snapshotPayload } from './rankingSync';

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
    const lists: SavedLists = {
      wantToListen: [album('c')],
      notHeard: [album('d')],
      dontCare: [album('e')],
    };

    expect(snapshotPayload('session-1', state, lists)).toEqual({
      session_id: 'session-1',
      ranked: ['a', 'b'],
      lists: {
        wantToListen: ['c'],
        notHeard: ['d'],
        dontCare: ['e'],
      },
    });
  });
});

describe('loadRankingSnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null without throwing on a 200 non-JSON response (SPA/HTML fallback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response)
    );

    const result = await loadRankingSnapshot('11111111-1111-4111-8111-111111111111', [album('a')]);

    expect(result).toBeNull();
  });
});
