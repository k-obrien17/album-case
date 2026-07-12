import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';
import {
  loadRankingSnapshot,
  loadRankingSnapshotDetailed,
  saveRankingSnapshot,
  snapshotPayload,
} from './rankingSync';
import { clearWriteKey, setWriteKey } from './writeKey';

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
  afterEach(() => {
    clearWriteKey();
    vi.restoreAllMocks();
  });

  it('serializes FULL album records (not just mbids) plus session id', () => {
    const state: RankingState = { ranked: [album('a'), album('b')], pending: null };
    const lists: SavedLists = {
      wantToListen: [album('c')],
      notHeard: [album('d')],
      dontCare: [album('e')],
    };
    const artistLocks = [{ artistMbid: '33333333-3333-4333-8333-333333333333', order: ['a'] }];

    expect(snapshotPayload('session-1', state, lists, artistLocks)).toEqual({
      session_id: 'session-1',
      ranked: [album('a'), album('b')],
      lists: {
        wantToListen: [album('c')],
        notHeard: [album('d')],
        dontCare: [album('e')],
      },
      artist_locks: artistLocks,
    });
  });

  it('includes the snapshot version when provided', () => {
    const state: RankingState = { ranked: [album('a')], pending: null };
    const lists: SavedLists = { wantToListen: [], notHeard: [], dontCare: [] };

    expect(snapshotPayload('session-1', state, lists, [], 123)).toEqual({
      session_id: 'session-1',
      ranked: [album('a')],
      lists,
      artist_locks: [],
      base_updated_at: 123,
    });
  });

  it('reports conflict on a stale versioned save', async () => {
    setWriteKey('secret-123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
      } as unknown as Response)
    );

    const result = await saveRankingSnapshot(
      '11111111-1111-4111-8111-111111111111',
      { ranked: [album('a')], pending: null },
      { wantToListen: [], notHeard: [], dontCare: [] },
      [],
      123
    );

    expect(result).toEqual({ status: 'conflict' });
  });
});

describe('loadRankingSnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full album records including dontCare, no seed pool needed', async () => {
    const snapshot = {
      ranked: [{ ...album('a'), rating: 8.43 }],
      lists: {
        wantToListen: [album('b')],
        notHeard: [album('c')],
        dontCare: [album('d')],
      },
      artist_locks: [{ artistMbid: '33333333-3333-4333-8333-333333333333', order: ['a'] }],
      updated_at: 123,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ snapshot }),
      } as unknown as Response)
    );

    const result = await loadRankingSnapshot('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual({
      ranked: [{ ...album('a'), rating: 8.43 }],
      lists: {
        wantToListen: [album('b')],
        notHeard: [album('c')],
        dontCare: [album('d')],
      },
      artistLocks: snapshot.artist_locks,
    });
  });

  it('defaults a missing dontCare bucket to an empty list (older snapshot)', async () => {
    const snapshot = {
      ranked: [{ ...album('a'), rating: 8.43 }],
      lists: { wantToListen: [], notHeard: [] },
      updated_at: 1,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ snapshot }),
      } as unknown as Response)
    );

    const result = await loadRankingSnapshot('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual({
      ranked: [{ ...album('a'), rating: 8.43 }],
      lists: { wantToListen: [], notHeard: [], dontCare: [] },
      artistLocks: [],
    });
  });

  it('returns null when the server has no snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ snapshot: null }),
      } as unknown as Response)
    );

    const result = await loadRankingSnapshot('11111111-1111-4111-8111-111111111111');

    expect(result).toBeNull();
  });

  it('distinguishes a missing snapshot from a load error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ snapshot: null }),
      } as unknown as Response)
    );

    await expect(
      loadRankingSnapshotDetailed('11111111-1111-4111-8111-111111111111')
    ).resolves.toEqual({ status: 'missing' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(
      loadRankingSnapshotDetailed('11111111-1111-4111-8111-111111111111')
    ).resolves.toEqual({ status: 'error' });
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

    const result = await loadRankingSnapshot('11111111-1111-4111-8111-111111111111');

    expect(result).toBeNull();
  });
});
