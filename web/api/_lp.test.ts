import { describe, it, expect } from 'vitest';
import {
  isLpReleaseGroup,
  isAlbumOrEpReleaseGroup,
  mergeDiscovered,
  type ReleaseGroup,
  type DiscoveredAlbum,
} from './_lp';

function group(overrides: Partial<ReleaseGroup> = {}): ReleaseGroup {
  return { id: 'x', title: 'Title', 'primary-type': 'Album', ...overrides };
}

describe('isLpReleaseGroup', () => {
  it('accepts a plain Album release-group with no secondary types', () => {
    expect(isLpReleaseGroup(group())).toBe(true);
  });

  it('rejects a non-Album primary type', () => {
    expect(isLpReleaseGroup(group({ 'primary-type': 'EP' }))).toBe(false);
  });

  it('rejects an Album with a secondary type (e.g. Compilation)', () => {
    expect(isLpReleaseGroup(group({ 'secondary-types': ['Compilation'] }))).toBe(false);
  });

  it('rejects a release-group with a missing primary type', () => {
    expect(isLpReleaseGroup(group({ 'primary-type': undefined }))).toBe(false);
  });
});

describe('isAlbumOrEpReleaseGroup', () => {
  it('accepts a plain Album release-group with no secondary types', () => {
    expect(isAlbumOrEpReleaseGroup(group())).toBe(true);
  });

  it('accepts a plain EP release-group with no secondary types', () => {
    expect(isAlbumOrEpReleaseGroup(group({ 'primary-type': 'EP' }))).toBe(true);
  });

  it('rejects an EP with a secondary type (e.g. Live)', () => {
    expect(
      isAlbumOrEpReleaseGroup(group({ 'primary-type': 'EP', 'secondary-types': ['Live'] }))
    ).toBe(false);
  });

  it('rejects an Album with a secondary type (e.g. Compilation)', () => {
    expect(
      isAlbumOrEpReleaseGroup(group({ 'secondary-types': ['Compilation'] }))
    ).toBe(false);
  });

  it('rejects a non-Album, non-EP primary type (e.g. Single)', () => {
    expect(isAlbumOrEpReleaseGroup(group({ 'primary-type': 'Single' }))).toBe(false);
  });

  it('rejects a release-group with a missing primary type', () => {
    expect(isAlbumOrEpReleaseGroup(group({ 'primary-type': undefined }))).toBe(false);
  });
});

function album(mbid: string): DiscoveredAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: 'Artist',
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('mergeDiscovered', () => {
  it('concatenates previously-unranked and newly-discovered', () => {
    const result = mergeDiscovered([album('a')], [album('b')]);
    expect(result.map((a) => a.mbid)).toEqual(['a', 'b']);
  });

  it('dedupes by mbid, keeping the first occurrence', () => {
    const result = mergeDiscovered([album('a')], [album('a')]);
    expect(result).toEqual([album('a')]);
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeDiscovered([], [])).toEqual([]);
  });
});
