import { describe, it, expect } from 'vitest';
import type { Album, RankingState } from './ranking/types';
import { bootstrapComparison } from './main';

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

describe('bootstrapComparison (cold-start)', () => {
  it('chains startPlacement from a fully empty state until nextComparison yields a real pair', () => {
    const pool = [album('a'), album('b'), album('c')];
    const emptyState: RankingState = { ranked: [], pending: null };
    const persisted: RankingState[] = [];

    const { comparison } = bootstrapComparison(emptyState, pool, (s) => persisted.push(s));

    expect(comparison).not.toBeNull();
    expect(comparison?.candidate).toBeDefined();
    expect(comparison?.opponent).toBeDefined();
    // The bootstrap loop must have persisted at least once (two albums
    // seated: one to seed `ranked`, one as the pending candidate).
    expect(persisted.length).toBeGreaterThan(0);
  });

  it('returns a null comparison once every pool album is already ranked', () => {
    const pool = [album('a')];
    const rankedState: RankingState = { ranked: [album('a')], pending: null };

    const { comparison } = bootstrapComparison(rankedState, pool, () => {});

    expect(comparison).toBeNull();
  });

  it('resumes an in-progress placement without re-seeding a new candidate', () => {
    const pool = [album('a'), album('b')];
    const inProgress: RankingState = {
      ranked: [album('a')],
      pending: { album: album('b'), lo: 0, hi: 1 },
    };

    const { comparison, state } = bootstrapComparison(inProgress, pool, () => {});

    expect(comparison).toEqual({ candidate: album('b'), opponent: album('a') });
    expect(state).toEqual(inProgress);
  });
});
