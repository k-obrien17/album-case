import { describe, it, expect } from 'vitest';
import type { Album } from './ranking/types';
import { eligibleCandidates, pickCandidate, playsMapFromPreferred } from './seed';

function album(mbid: string, artist = `Artist ${mbid}`): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: artist,
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

describe('pickCandidate (play-weighted)', () => {
  it('favors a high-play artist over unlisted canon for a mid-range rng', () => {
    const weighted = [album('r1', 'Radiohead'), album('x1', 'Some Canon Band')];
    const plays = playsMapFromPreferred([{ rank: 1, artist: 'Radiohead', plays: 733, hours: 30 }]);
    // Radiohead weight 733 vs floor 1 -> it wins across almost the whole range.
    const picked = pickCandidate(weighted, [], new Set(), () => 0.9, plays);
    expect(picked?.mbid).toBe('r1');
  });

  it('still reaches the unlisted album at the far end of the range', () => {
    const weighted = [album('r1', 'Radiohead'), album('x1', 'Some Canon Band')];
    const plays = playsMapFromPreferred([{ rank: 1, artist: 'Radiohead', plays: 733, hours: 30 }]);
    // Only the last sliver (>733/734) of the range lands on the floor album.
    const picked = pickCandidate(weighted, [], new Set(), () => 0.999, plays);
    expect(picked?.mbid).toBe('x1');
  });

  it('counts a slash-credited album ("Genius/GZA") toward its listed member ("GZA")', () => {
    const weighted = [album('g1', 'Genius/GZA'), album('x1', 'Some Canon Band')];
    const plays = playsMapFromPreferred([{ rank: 1, artist: 'GZA', plays: 100, hours: 4 }]);
    const picked = pickCandidate(weighted, [], new Set(), () => 0, plays);
    expect(picked?.mbid).toBe('g1');
  });
});
