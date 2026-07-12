import { describe, it, expect } from 'vitest';
import type { Album, RankedAlbum, RankingState } from './types';
import { startPlacement, nextComparison, applyPick } from './insertion';

/** Build a minimal Album fixture with a unique mbid. */
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

/** Deterministic PRNG (mulberry32) so fuzz runs are reproducible. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Insert every album in `insertionOrder` into `state`, answering every
 * comparison according to `hiddenOrder` (index 0 = most preferred). */
function runFullInsertion(
  insertionOrder: Album[],
  hiddenOrder: Album[]
): { state: RankingState; comparisonCounts: number[] } {
  const rankIndex = new Map(hiddenOrder.map((a, i) => [a.mbid, i]));
  let state: RankingState = { ranked: [], pending: null };
  const comparisonCounts: number[] = [];

  for (const candidate of insertionOrder) {
    state = startPlacement(state, candidate);
    let comparisons = 0;
    let comparison = nextComparison(state);
    while (comparison !== null) {
      comparisons++;
      const candidateRank = rankIndex.get(comparison.candidate.mbid)!;
      const opponentRank = rankIndex.get(comparison.opponent.mbid)!;
      const winnerMbid =
        candidateRank < opponentRank ? comparison.candidate.mbid : comparison.opponent.mbid;
      state = applyPick(state, winnerMbid);
      comparison = nextComparison(state);
    }
    comparisonCounts.push(comparisons);
  }

  return { state, comparisonCounts };
}

describe('startPlacement', () => {
  it('finalizes immediately on an empty list', () => {
    const state: RankingState = { ranked: [], pending: null };
    const a = album('a');
    const next = startPlacement(state, a);

    expect(next.ranked).toEqual([a]);
    expect(next.pending).toBeNull();
    expect(nextComparison(next)).toBeNull();
  });

  it('sets lo=0, hi=ranked.length for a non-empty list', () => {
    const ranked = [rankedAlbum('a', 10), rankedAlbum('b', 9), rankedAlbum('c', 8)];
    const state: RankingState = { ranked, pending: null };
    const candidate = album('x');
    const next = startPlacement(state, candidate);

    expect(next.pending).toEqual({ album: candidate, lo: 0, hi: 3 });
    expect(next.ranked).toEqual(ranked);
  });
});

describe('nextComparison', () => {
  it('returns null when there is no pending placement', () => {
    const state: RankingState = { ranked: [rankedAlbum('a', 10)], pending: null };
    expect(nextComparison(state)).toBeNull();
  });

  it('returns the candidate vs the element at the deterministic midpoint', () => {
    const ranked = [rankedAlbum('a', 10), rankedAlbum('b', 9), rankedAlbum('c', 8), rankedAlbum('d', 7)];
    const state: RankingState = { ranked, pending: null };
    const candidate = album('x');
    const withPending = startPlacement(state, candidate);

    // lo=0, hi=4 -> mid = floor(4/2) = 2 -> ranked[2] = 'c'
    const comparison = nextComparison(withPending);
    expect(comparison).toEqual({ candidate, opponent: ranked[2] });
  });

  it('never returns an opponent outside the current ranked list', () => {
    const ranked = [
      rankedAlbum('a', 10),
      rankedAlbum('b', 9),
      rankedAlbum('c', 8),
      rankedAlbum('d', 7),
      rankedAlbum('e', 6),
    ];
    let state: RankingState = startPlacement({ ranked, pending: null }, album('x'));

    let comparison = nextComparison(state);
    while (comparison !== null) {
      const opponentIsInRanked = state.ranked.some((a) => a.mbid === comparison!.opponent.mbid);
      expect(opponentIsInRanked).toBe(true);
      // Candidate always wins in this sub-test; just needs any deterministic answer.
      state = applyPick(state, comparison.candidate.mbid);
      comparison = nextComparison(state);
    }
  });
});

describe('applyPick narrowing', () => {
  it('narrows hi to mid when the candidate wins', () => {
    const ranked = [rankedAlbum('a', 10), rankedAlbum('b', 9), rankedAlbum('c', 8), rankedAlbum('d', 7)];
    let state = startPlacement({ ranked, pending: null }, album('x'));
    // mid = 2, candidate wins -> hi becomes 2
    const comparison = nextComparison(state)!;
    state = applyPick(state, comparison.candidate.mbid);
    expect(state.pending).toEqual({ album: album('x'), lo: 0, hi: 2 });
  });

  it('narrows lo to mid+1 when the opponent wins', () => {
    const ranked = [rankedAlbum('a', 10), rankedAlbum('b', 9), rankedAlbum('c', 8), rankedAlbum('d', 7)];
    let state = startPlacement({ ranked, pending: null }, album('x'));
    // mid = 2, opponent wins -> lo becomes 3
    const comparison = nextComparison(state)!;
    state = applyPick(state, comparison.opponent.mbid);
    expect(state.pending).toEqual({ album: album('x'), lo: 3, hi: 4 });
  });

  it('finalizes and splices the candidate into ranked once lo>=hi', () => {
    // Known scenario: ranked = [A,B,C,D] (most to least preferred).
    // Insert X such that X < B (loses to B) and X > C (beats C).
    const A = rankedAlbum('A', 10);
    const B = rankedAlbum('B', 9);
    const C = rankedAlbum('C', 8);
    const D = rankedAlbum('D', 7);
    const X = album('X');
    let state: RankingState = startPlacement({ ranked: [A, B, C, D], pending: null }, X);

    // mid = 2 -> opponent C, X beats C -> hi = 2
    let comparison = nextComparison(state)!;
    expect(comparison.opponent.mbid).toBe('C');
    state = applyPick(state, X.mbid);

    // mid = 1 -> opponent B, B beats X -> lo = 2
    comparison = nextComparison(state)!;
    expect(comparison.opponent.mbid).toBe('B');
    state = applyPick(state, B.mbid);

    // lo=2, hi=2 -> finalized
    expect(state.pending).toBeNull();
    expect(state.ranked.map((a) => a.mbid)).toEqual(['A', 'B', 'X', 'C', 'D']);
  });

  it('gives the finalized album a rating interpolated between its neighbors', () => {
    const ranked = [rankedAlbum('a', 9), rankedAlbum('b', 7)];
    let state = startPlacement({ ranked, pending: null }, album('x'));

    // lo=0, hi=2 -> mid=1 -> opponent b (rating 7); candidate beats b -> hi=1
    let comparison = nextComparison(state)!;
    expect(comparison.opponent.mbid).toBe('b');
    state = applyPick(state, comparison.candidate.mbid);

    // lo=0, hi=1 -> mid=0 -> opponent a (rating 9); a beats candidate -> lo=1
    comparison = nextComparison(state)!;
    expect(comparison.opponent.mbid).toBe('a');
    state = applyPick(state, comparison.opponent.mbid);

    // lo=1, hi=1 -> finalized between a (9) and b (7) -> rating 8 (midpoint)
    expect(state.pending).toBeNull();
    expect(state.ranked.map((a) => a.mbid)).toEqual(['a', 'x', 'b']);
    const inserted = state.ranked.find((a) => a.mbid === 'x');
    expect(inserted?.rating).toBe(8);
  });

  it('throws if the winner is neither the candidate nor the current opponent', () => {
    const ranked = [rankedAlbum('a', 10), rankedAlbum('b', 9), rankedAlbum('c', 8)];
    const state = startPlacement({ ranked, pending: null }, album('x'));
    expect(() => applyPick(state, 'not-a-real-mbid')).toThrow();
  });

  it('is a no-op when there is no pending placement', () => {
    const state: RankingState = { ranked: [rankedAlbum('a', 10)], pending: null };
    const next = applyPick(state, 'a');
    expect(next).toEqual(state);
  });
});

describe('comparison count bound', () => {
  it('inserts into a list of length k in at most ceil(log2(k+1)) comparisons', () => {
    for (const k of [0, 1, 2, 3, 4, 5, 8, 16, 31, 32, 100]) {
      const ranked = Array.from({ length: k }, (_, i) => rankedAlbum(`existing-${i}`, k - i));
      const bound = Math.ceil(Math.log2(k + 1));

      let state = startPlacement({ ranked, pending: null }, album('candidate'));
      let comparisons = 0;
      let comparison = nextComparison(state);
      while (comparison !== null) {
        comparisons++;
        // Always answer "candidate loses" to force a worst-case walk to the end.
        state = applyPick(state, comparison.opponent.mbid);
        comparison = nextComparison(state);
      }
      expect(comparisons).toBeLessThanOrEqual(bound);
    }
  });
});

describe('transitivity / no self-contradiction (property test)', () => {
  it('reproduces the hidden total order across many randomized insertion sequences', () => {
    const POOL_SIZE = 40;
    const ITERATIONS = 25;
    const pool = Array.from({ length: POOL_SIZE }, (_, i) => album(`p${i}`));

    for (let seed = 0; seed < ITERATIONS; seed++) {
      const rand = mulberry32(seed * 7919 + 13);
      const hiddenOrder = shuffled(pool, rand);
      const insertionOrder = shuffled(pool, mulberry32(seed * 104729 + 3));

      const { state } = runFullInsertion(insertionOrder, hiddenOrder);

      expect(state.pending).toBeNull();
      expect(state.ranked.map((a) => a.mbid)).toEqual(hiddenOrder.map((a) => a.mbid));
    }
  });

  it('never produces a pair whose final order contradicts a recorded pick', () => {
    const POOL_SIZE = 20;
    const pool = Array.from({ length: POOL_SIZE }, (_, i) => album(`q${i}`));
    const rand = mulberry32(42);
    const hiddenOrder = shuffled(pool, rand);
    const insertionOrder = shuffled(pool, mulberry32(99));

    const rankIndex = new Map(hiddenOrder.map((a, i) => [a.mbid, i]));
    const recordedPicks: { winner: string; loser: string }[] = [];

    let state: RankingState = { ranked: [], pending: null };
    for (const candidate of insertionOrder) {
      state = startPlacement(state, candidate);
      let comparison = nextComparison(state);
      while (comparison !== null) {
        const candidateRank = rankIndex.get(comparison.candidate.mbid)!;
        const opponentRank = rankIndex.get(comparison.opponent.mbid)!;
        const winner =
          candidateRank < opponentRank ? comparison.candidate : comparison.opponent;
        const loser = winner === comparison.candidate ? comparison.opponent : comparison.candidate;
        recordedPicks.push({ winner: winner.mbid, loser: loser.mbid });
        state = applyPick(state, winner.mbid);
        comparison = nextComparison(state);
      }
    }

    const finalIndex = new Map(state.ranked.map((a, i) => [a.mbid, i]));
    for (const pick of recordedPicks) {
      expect(finalIndex.get(pick.winner)!).toBeLessThan(finalIndex.get(pick.loser)!);
    }
  });
});

describe('resumability (JSON round-trip)', () => {
  it('survives JSON.stringify/parse mid-placement and continues from the same bounds', () => {
    const ranked = [
      rankedAlbum('a', 10),
      rankedAlbum('b', 9),
      rankedAlbum('c', 8),
      rankedAlbum('d', 7),
      rankedAlbum('e', 6),
    ];
    let state = startPlacement({ ranked, pending: null }, album('x'));

    // Advance one comparison before "refreshing".
    const firstComparison = nextComparison(state)!;
    state = applyPick(state, firstComparison.opponent.mbid);

    const serialized = JSON.stringify(state);
    const restored: RankingState = JSON.parse(serialized);

    expect(restored).toEqual(state);
    expect(restored.pending).not.toBeNull();

    // Continue the insertion from the restored state and confirm it finalizes normally.
    let resumed = restored;
    let comparison = nextComparison(resumed);
    while (comparison !== null) {
      resumed = applyPick(resumed, comparison.candidate.mbid);
      comparison = nextComparison(resumed);
    }
    expect(resumed.pending).toBeNull();
    expect(resumed.ranked.some((a) => a.mbid === 'x')).toBe(true);
  });
});
