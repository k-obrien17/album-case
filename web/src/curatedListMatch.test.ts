import { describe, expect, it } from 'vitest';
import type { RankedAlbum } from './ranking/types';
import type { CuratedAlbumEntry } from './data/curatedLists';
import { unrankedFromCuratedList } from './curatedListMatch';

function ranked(overrides: Partial<RankedAlbum> & { mbid: string }): RankedAlbum {
  return {
    title: `Title ${overrides.mbid}`,
    primary_artist_name: 'Unknown Artist',
    release_year: 2000,
    cover_url: `https://example.test/${overrides.mbid}.jpg`,
    rating: 5,
    ...overrides,
  };
}

const curated: CuratedAlbumEntry[] = [
  { rank: 1, artist: 'Radiohead', title: 'Kid A' },
  { rank: 2, artist: 'The Beatles', title: 'Revolver' },
  { rank: 3, artist: 'Portishead', title: 'Dummy' },
];

describe('unrankedFromCuratedList', () => {
  it('returns every entry when nothing is ranked', () => {
    expect(unrankedFromCuratedList(curated, [])).toEqual(curated);
  });

  it('drops an entry that exact-matches a ranked album', () => {
    const result = unrankedFromCuratedList(curated, [
      ranked({ mbid: 'a', title: 'Kid A', primary_artist_name: 'Radiohead' }),
    ]);
    expect(result.map((a) => a.rank)).toEqual([2, 3]);
  });

  it('matches case-insensitively', () => {
    const result = unrankedFromCuratedList(curated, [
      ranked({ mbid: 'a', title: 'KID A', primary_artist_name: 'radiohead' }),
    ]);
    expect(result.map((a) => a.rank)).toEqual([2, 3]);
  });

  it('matches regardless of a leading "The" on the artist', () => {
    const result = unrankedFromCuratedList(curated, [
      ranked({ mbid: 'a', title: 'Revolver', primary_artist_name: 'Beatles' }),
    ]);
    expect(result.map((a) => a.rank)).toEqual([1, 3]);
  });

  it('does not match a different album by the same artist', () => {
    const result = unrankedFromCuratedList(curated, [
      ranked({ mbid: 'a', title: 'OK Computer', primary_artist_name: 'Radiohead' }),
    ]);
    expect(result.map((a) => a.rank)).toEqual([1, 2, 3]);
  });

  it('preserves original rank order', () => {
    const result = unrankedFromCuratedList(curated, []);
    expect(result.map((a) => a.rank)).toEqual([1, 2, 3]);
  });

  it('matches a title using an ae ligature against a curated entry spelled out as two letters', () => {
    // Real bug: MusicBrainz's canonical title uses the "æ" ligature
    // (as in "Ágætis Byrjun"), while the curated-list source text
    // spelled it "Agaetis" -- both must normalize to the same key.
    const sigurRos: CuratedAlbumEntry[] = [{ rank: 1, artist: 'Sigur Rós', title: 'Ágaetis Byrjun' }];
    const result = unrankedFromCuratedList(sigurRos, [
      ranked({ mbid: 'a', title: 'Ágætis byrjun', primary_artist_name: 'Sigur Rós' }),
    ]);
    expect(result).toEqual([]);
  });
});
