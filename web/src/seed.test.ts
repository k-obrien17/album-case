import { describe, it, expect } from 'vitest';
import type { Album } from './ranking/types';
import { eligibleCandidates, pickCandidate } from './seed';

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

describe('eligibleCandidates', () => {
  it('excludes ranked and set-aside albums', () => {
    const eligible = eligibleCandidates(pool, [album('a')], new Set(['b']));
    expect(eligible.map((x) => x.mbid)).toEqual(['c', 'd']);
  });
});

describe('pickCandidate', () => {
  it('excludes ranked and set-aside albums from selection', () => {
    // rng 0 would normally pick the first pool album; with a/b removed the
    // first eligible is c.
    const picked = pickCandidate(pool, [album('a')], new Set(['b']), () => 0);
    expect(picked?.mbid).toBe('c');
  });

  it('is randomized: an injected RNG can return a NON-first eligible album', () => {
    // rng near 1 selects the last eligible album, proving order is not fixed.
    const picked = pickCandidate(pool, [], new Set(), () => 0.99);
    expect(picked?.mbid).toBe('d');
  });

  it('returns null when nothing is eligible', () => {
    const picked = pickCandidate(pool, pool, new Set(), () => 0.5);
    expect(picked).toBeNull();
  });

  it('never indexes out of range even when rng returns exactly 1', () => {
    const picked = pickCandidate(pool, [], new Set(), () => 1);
    expect(picked?.mbid).toBe('d');
  });
});
