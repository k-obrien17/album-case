import { describe, expect, test } from 'vitest';
import type { Album, RankedAlbum } from '../ranking/types';
import { startAssist } from '../ranking/assist';
import { assistNeedsRestart } from './rankList';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return { ...album(mbid), rating };
}

describe('assistNeedsRestart', () => {
  const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((mbid, i) =>
    rankedAlbum(mbid, 10 - i)
  );

  test('no restart needed mid-comparison when nothing changed', () => {
    const candidate = album('x');
    const assist = startAssist(ranked, candidate);
    expect(assistNeedsRestart(assist, candidate, ranked)).toBe(false);
  });

  test('restarts when the candidate changes', () => {
    const assist = startAssist(ranked, album('x'));
    expect(assistNeedsRestart(assist, album('y'), ranked)).toBe(true);
  });

  test('restarts when the ranked list mutates mid-comparison (row edited/removed elsewhere)', () => {
    const candidate = album('x');
    const assist = startAssist(ranked, candidate);
    // Another row was edited/reordered/removed while this comparison was in
    // flight -- a genuinely new ranked array, same candidate.
    const mutatedRanked = ranked.filter((a) => a.mbid !== 'c');
    expect(assistNeedsRestart(assist, candidate, mutatedRanked)).toBe(true);
  });

  test('no restart when a new array reference has the same identity as the one assist started with', () => {
    const candidate = album('x');
    const assist = startAssist(ranked, candidate);
    // Re-render with the exact same ranked reference (no mutation happened).
    expect(assistNeedsRestart(assist, candidate, ranked)).toBe(false);
  });
});
