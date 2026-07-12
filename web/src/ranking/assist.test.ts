import { describe, it, expect } from 'vitest';
import type { Album, RankedAlbum } from './types';
import {
  startAssist,
  assistOpponent,
  assistResolved,
  assistPick,
  assistIndex,
} from './assist';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

/** Build a minimal RankedAlbum fixture with a unique mbid and a given rating. */
function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return { ...album(mbid), rating };
}

/**
 * Drive an assisted placement to completion using a preference function:
 * `prefersCandidate(opponentMbid)` returns true when the candidate should rank
 * above that opponent. Returns the final insertion index.
 */
function runAssist(
  ranked: RankedAlbum[],
  candidate: Album,
  prefersCandidate: (opponentMbid: string) => boolean
): { index: number; opponentsShown: string[] } {
  let placement = startAssist(ranked, candidate);
  const opponentsShown: string[] = [];
  // Bounded loop: binary search over N items resolves in <= log2(N)+1 steps.
  for (let guard = 0; guard < 64 && !assistResolved(placement); guard += 1) {
    const opponent = assistOpponent(placement);
    if (!opponent) break;
    opponentsShown.push(opponent.mbid);
    const winner = prefersCandidate(opponent.mbid) ? candidate.mbid : opponent.mbid;
    placement = assistPick(placement, winner);
  }
  return { index: assistIndex(placement), opponentsShown };
}

describe('assisted binary placement', () => {
  // A ranked list ordered best-first: a > b > c > d > e > f > g > h.
  const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((mbid, i) => rankedAlbum(mbid, 10 - i));

  it('lands the candidate at the correct index for a known comparison sequence', () => {
    const x = album('x');
    // x belongs between c and d: x is preferred over d..h, not over a..c.
    const preferOver = new Set(['d', 'e', 'f', 'g', 'h']);
    const { index, opponentsShown } = runAssist(ranked, x, (mbid) => preferOver.has(mbid));

    // mid of [0,8) = e -> prefer x; [0,4) mid = c -> keep c; [3,4) mid = d -> prefer x.
    expect(opponentsShown).toEqual(['e', 'c', 'd']);
    expect(index).toBe(3);

    const finalOrder = [...ranked.slice(0, index), x, ...ranked.slice(index)].map((a) => a.mbid);
    expect(finalOrder).toEqual(['a', 'b', 'c', 'x', 'd', 'e', 'f', 'g', 'h']);
  });

  it('places a candidate preferred over everything at the top', () => {
    const { index } = runAssist(ranked, album('top'), () => true);
    expect(index).toBe(0);
  });

  it('places a candidate preferred over nothing at the bottom', () => {
    const { index } = runAssist(ranked, album('bottom'), () => false);
    expect(index).toBe(ranked.length);
  });

  it('resolves within log2(n) comparisons', () => {
    const { opponentsShown } = runAssist(ranked, album('mid'), (mbid) => mbid > 'd');
    // 8 items -> at most 3 comparisons.
    expect(opponentsShown.length).toBeLessThanOrEqual(3);
  });
});
