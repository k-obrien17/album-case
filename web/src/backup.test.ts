import { describe, expect, it } from 'vitest';
import { createRankingBackup, parseRankingBackup } from './backup';
import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

const pool = [album('a'), album('b'), album('c'), album('d')];
const lists: SavedLists = { wantToListen: [album('c')], notHeard: [album('d')], dontCare: [] };

describe('ranking backups', () => {
  it('exports and imports a ranking backup bundle', () => {
    const state: RankingState = { ranked: [album('a'), album('b')], pending: null };
    const parsed = parseRankingBackup(createRankingBackup(state, lists), pool);

    expect(parsed).toEqual({ ok: true, state, lists });
  });

  it('imports a legacy direct RankingState JSON file', () => {
    const parsed = parseRankingBackup(JSON.stringify({ ranked: [album('b'), album('a')], pending: null }), pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [album('b'), album('a')], pending: null },
      lists: null,
    });
  });

  it('defaults a legacy lists bundle with no dontCare to an empty dontCare list', () => {
    const raw = JSON.stringify({
      version: 1,
      ranking: { ranked: [album('a')], pending: null },
      lists: { wantToListen: [album('c')], notHeard: [] },
    });
    const parsed = parseRankingBackup(raw, pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [album('a')], pending: null },
      lists: { wantToListen: [album('c')], notHeard: [], dontCare: [] },
    });
  });

  it('preserves a previously-ranked album that is no longer in the seed', () => {
    // A backup must survive a seed change: an album ranked under an older seed
    // is kept from its stored record rather than dropped.
    const gone = album('gone');
    const parsed = parseRankingBackup(JSON.stringify({ ranked: [album('a'), gone], pending: null }), pool);

    expect(parsed).toEqual({
      ok: true,
      state: { ranked: [album('a'), gone], pending: null },
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
