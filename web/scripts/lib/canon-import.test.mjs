import { describe, it, expect } from 'vitest';
import { parseCanonCsv, isLpReleaseGroup, isConfidentMatch } from './canon-import.mjs';

describe('parseCanonCsv', () => {
  it('parses the header and rows into typed objects', () => {
    const csv = 'Ranking,Album,Artist,Year,Rating\n1,OK Computer,Radiohead,1997,10\n2,154,Wire,1979,9.99\n';
    const rows = parseCanonCsv(csv);
    expect(rows).toEqual([
      { ranking: 1, album: 'OK Computer', artist: 'Radiohead', year: 1997, rating: 10 },
      { ranking: 2, album: '154', artist: 'Wire', year: 1979, rating: 9.99 },
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    const csv = 'Ranking,Album,Artist,Year,Rating\n1,"Track, Track","Artist, Inc.",2000,8\n';
    const rows = parseCanonCsv(csv);
    expect(rows).toEqual([{ ranking: 1, album: 'Track, Track', artist: 'Artist, Inc.', year: 2000, rating: 8 }]);
  });

  it('returns an empty array for a header-only CSV', () => {
    expect(parseCanonCsv('Ranking,Album,Artist,Year,Rating\n')).toEqual([]);
  });
});

describe('isLpReleaseGroup', () => {
  it('accepts primary-type Album with no secondary types', () => {
    expect(isLpReleaseGroup({ 'primary-type': 'Album' })).toBe(true);
  });
  it('rejects a Compilation', () => {
    expect(isLpReleaseGroup({ 'primary-type': 'Album', 'secondary-types': ['Compilation'] })).toBe(false);
  });
  it('rejects a non-Album primary type', () => {
    expect(isLpReleaseGroup({ 'primary-type': 'EP' })).toBe(false);
  });
});

describe('isConfidentMatch', () => {
  it('accepts exactly one candidate scoring 90 or above', () => {
    expect(isConfidentMatch([{ score: 100 }])).toBe(true);
    expect(isConfidentMatch([{ score: 90 }])).toBe(true);
  });
  it('rejects a single low-scoring candidate', () => {
    expect(isConfidentMatch([{ score: 89 }])).toBe(false);
  });
  it('rejects zero candidates', () => {
    expect(isConfidentMatch([])).toBe(false);
  });
  it('rejects multiple candidates even if one scores high', () => {
    expect(isConfidentMatch([{ score: 100 }, { score: 50 }])).toBe(false);
  });
});
