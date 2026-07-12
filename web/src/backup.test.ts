import { describe, expect, it } from 'vitest';
import { createRankingBackup, parseRankingBackup } from './backup';
import type { SavedLists } from './lists';
import type { Album, RankedAlbum, RankingState } from './ranking/types';
import { ratingForDropIndex } from './ranking/rating';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function rankedAlbum(mbid: string, rating: number = 5.0) {
  return { ...album(mbid), rating };
}

// Helper to build expected RankedAlbums with ratings computed as the backup system restores them
function restoreRanked(mbids: string[]): RankedAlbum[] {
  const result: RankedAlbum[] = [];
  for (const mbid of mbids) {
    const rating = ratingForDropIndex(result, result.length);
    result.push({ ...album(mbid), rating });
  }
  return result;
}

const pool = [album('a'), album('b'), album('c'), album('d')];
const lists: SavedLists = { wantToListen: [album('c')], notHeard: [album('d')], dontCare: [] };

describe('ranking backups', () => {
  it('exports and imports a ranking backup bundle, preserving each album\'s real rating', () => {
    // Distinct ratings per album: if restore silently recomputed from
    // position instead of preserving the stored value, these would come
    // back as different numbers than 9.2/6.7.
    const state: RankingState = { ranked: [rankedAlbum('a', 9.2), rankedAlbum('b', 6.7)], pending: null };
    const parsed = parseRankingBackup(createRankingBackup(state, lists), pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [rankedAlbum('a', 9.2), rankedAlbum('b', 6.7)], pending: null },
      lists,
    });
  });

  it('falls back to recomputing ratings from position for a legacy backup with no stored rating', () => {
    // Simulates a pre-migration backup file: ranked entries have no `rating`
    // field at all (built directly, bypassing createRankingBackup).
    const raw = JSON.stringify({
      version: 1,
      ranking: {
        ranked: [
          { ...album('a') },
          { ...album('b') },
        ],
        pending: null,
      },
      lists,
    });
    const parsed = parseRankingBackup(raw, pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: restoreRanked(['a', 'b']), pending: null },
      lists,
    });
  });

  it('imports a legacy direct RankingState JSON file', () => {
    // "legacy" here means the direct (unwrapped) RankingState shape, not a
    // missing rating -- these entries carry real ratings, which must survive.
    const parsed = parseRankingBackup(JSON.stringify({ ranked: [rankedAlbum('b'), rankedAlbum('a')], pending: null }), pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [rankedAlbum('b'), rankedAlbum('a')], pending: null },
      lists: null,
    });
  });

  it('defaults a legacy lists bundle with no dontCare to an empty dontCare list', () => {
    const raw = JSON.stringify({
      version: 1,
      ranking: { ranked: [rankedAlbum('a')], pending: null },
      lists: { wantToListen: [album('c')], notHeard: [] },
    });
    const parsed = parseRankingBackup(raw, pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [rankedAlbum('a')], pending: null },
      lists: { wantToListen: [album('c')], notHeard: [], dontCare: [] },
    });
  });

  it('preserves a previously-ranked album that is no longer in the seed', () => {
    // A backup must survive a seed change: an album ranked under an older seed
    // is kept from its stored record rather than dropped, and its stored
    // rating is preserved along with it.
    const parsed = parseRankingBackup(JSON.stringify({ ranked: [rankedAlbum('a'), rankedAlbum('gone')], pending: null }), pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [rankedAlbum('a'), rankedAlbum('gone')], pending: null },
      lists: null,
    });
  });

  it('rejects a malformed album entry (missing title)', () => {
    const parsed = parseRankingBackup(
      JSON.stringify({ ranked: [{ mbid: 'x', primary_artist_name: 'A' }], pending: null }),
      pool
    );

    expect(parsed.ok).toBe(false);
  });

  it('rejects duplicate album ids', () => {
    const parsed = parseRankingBackup(JSON.stringify({ ranked: [album('a'), album('a')], pending: null }), pool);

    expect(parsed.ok).toBe(false);
  });
});
