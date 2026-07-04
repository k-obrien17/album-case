import { describe, it, expect } from 'vitest';
import type { Album, Comparison } from '../ranking/types';
import { assignSides } from './pickLoop';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('assignSides (display-side randomization)', () => {
  const comparison: Comparison = {
    candidate: album('candidate'),
    opponent: album('opponent'),
  };

  it('always shows both albums, one per side, whatever the assignment', () => {
    for (let i = 0; i < 200; i++) {
      const sides = assignSides(comparison);
      const shown = new Set([sides.left.mbid, sides.right.mbid]);
      expect(shown).toEqual(new Set(['candidate', 'opponent']));
      expect(sides.left.mbid).not.toBe(sides.right.mbid);
    }
  });

  it('does not glue the candidate to one side: over many runs it appears on both', () => {
    let candidateLeft = 0;
    let candidateRight = 0;
    for (let i = 0; i < 200; i++) {
      const sides = assignSides(comparison);
      if (sides.left.mbid === 'candidate') candidateLeft++;
      else candidateRight++;
    }
    expect(candidateLeft).toBeGreaterThan(0);
    expect(candidateRight).toBeGreaterThan(0);
  });
});
