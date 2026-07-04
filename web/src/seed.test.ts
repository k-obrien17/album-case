import { describe, it, expect } from 'vitest';
import type { Album } from './ranking/types';
import { nextUnrankedCandidate } from './seed';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

const pool = [album('a'), album('b'), album('c')];

describe('nextUnrankedCandidate', () => {
  it('returns the first album not already ranked', () => {
    const next = nextUnrankedCandidate(pool, [album('a')], null);
    expect(next?.mbid).toBe('b');
  });

  it('skips the album currently mid-placement (pendingMbid)', () => {
    const next = nextUnrankedCandidate(pool, [], 'a');
    expect(next?.mbid).toBe('b');
  });

  it('skips albums in the excluded set', () => {
    const next = nextUnrankedCandidate(pool, [], null, new Set(['a', 'b']));
    expect(next?.mbid).toBe('c');
  });

  it('combines ranked, pending, and excluded exclusions', () => {
    const next = nextUnrankedCandidate(pool, [album('a')], 'b', new Set(['c']));
    expect(next).toBeNull();
  });

  it('defaults excluded to empty when omitted (existing callers keep working)', () => {
    const next = nextUnrankedCandidate(pool, [], null);
    expect(next?.mbid).toBe('a');
  });
});
