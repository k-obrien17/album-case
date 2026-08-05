import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLpReleaseGroup,
  isAlbumOrEpReleaseGroup,
  mergeDiscovered,
  browseArtistLps,
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

describe('browseArtistLps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches, filters to studio LPs, and maps to DiscoveredAlbum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            { id: 'rg-1', title: 'Studio Album', 'first-release-date': '1975-01-01', 'primary-type': 'Album', 'secondary-types': [] },
            { id: 'rg-2', title: 'Live Album', 'first-release-date': '1976-01-01', 'primary-type': 'Album', 'secondary-types': ['Live'] },
          ],
        }),
      })
    );

    const result = await browseArtistLps('artist-1', 'Some Artist');

    expect(result).toEqual([
      {
        mbid: 'rg-1',
        title: 'Studio Album',
        primary_artist_name: 'Some Artist',
        primary_artist_mbid: 'artist-1',
        release_year: 1975,
        cover_url: 'https://coverartarchive.org/release-group/rg-1/front-500',
      },
    ]);
  });

  it('throws on a non-ok MusicBrainz response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(browseArtistLps('artist-1', 'Some Artist')).rejects.toThrow('musicbrainz_browse_503');
  });
});
