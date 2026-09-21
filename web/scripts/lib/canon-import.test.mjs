import { describe, it, expect } from 'vitest';
import { parseCanonCsv, isLpReleaseGroup, isConfidentMatch, isValidRow } from './canon-import.mjs';

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

  it('parses a malformed row (missing trailing fields) into undefined fields instead of throwing', () => {
    // A row with fewer commas than expected -- Artist/Year/Rating missing.
    const csv = 'Ranking,Album,Artist,Year,Rating\n1,OK Computer\n';
    const rows = parseCanonCsv(csv);
    expect(rows).toEqual([{ ranking: 1, album: 'OK Computer', artist: undefined, year: NaN, rating: NaN }]);
    expect(isValidRow(rows[0])).toBe(false);
  });
});

describe('isValidRow', () => {
  it('accepts a row with non-empty artist and album', () => {
    expect(isValidRow({ artist: 'Radiohead', album: 'OK Computer' })).toBe(true);
  });
  it('rejects a row missing artist entirely (undefined, e.g. a malformed short row)', () => {
    expect(isValidRow({ artist: undefined, album: 'OK Computer' })).toBe(false);
  });
  it('rejects a row missing album entirely', () => {
    expect(isValidRow({ artist: 'Radiohead', album: undefined })).toBe(false);
  });
  it('rejects a row with a blank/whitespace-only artist', () => {
    expect(isValidRow({ artist: '   ', album: 'OK Computer' })).toBe(false);
  });
  it('rejects a row with a blank/whitespace-only album', () => {
    expect(isValidRow({ artist: 'Radiohead', album: '' })).toBe(false);
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
