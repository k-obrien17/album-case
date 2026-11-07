import { describe, expect, it, vi } from 'vitest';
import { suggestAlbum, suggestionSeeds, loadSuggestionConnections, type SuggestionOptions } from './suggestions';
import type { Album } from './ranking/types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const album = (n: number, artist = 'Favorite', year = 2000): Album => ({
  mbid: id(n), title: `Album ${n}`, primary_artist_name: artist,
  primary_artist_mbid: id(artist === 'Favorite' ? 100 : artist === 'Second' ? 101 : 102),
  release_year: year, cover_url: '',
});
const options = (overrides: Partial<SuggestionOptions> = {}): SuggestionOptions => ({
  pool: [album(2)], ranked: [{ ...album(1), rating: 9 }],
  lists: { wantToListen: [], notHeard: [], dontCare: [] }, preferred: [],
  blocked: [], skipped: new Set(), seen: [], recentArtists: [], related: [], discoveryTurn: false,
  ...overrides,
});

describe('one-at-a-time suggestions', () => {
  it('prefers albums near highly rated releases and explains real evidence', () => {
    const result = suggestAlbum(options({ pool: [album(2, 'Favorite', 2020), album(3, 'Favorite', 2001)] }));
    expect(result?.album.mbid).toBe(id(3));
    expect(result?.reason).toContain('Album 1');
    expect(result?.reason).toContain('9.00');
    expect(result?.reason).toContain('(2000)');
  });

  it('lets consistent ratings outrank play counts for a poorly rated artist', () => {
    const result = suggestAlbum(options({
      pool: [album(2), album(3, 'Second')],
      ranked: [{ ...album(1), rating: 5 }, { ...album(4, 'Second'), rating: 9 }],
      preferred: [{ artist: 'Favorite', plays: 10000, rank: 1, hours: 100 }],
    }));
    expect(result?.album.primary_artist_name).toBe('Second');
  });

  it('uses play history when no ratings exist without inventing a rating', () => {
    const result = suggestAlbum(options({ ranked: [], preferred: [{ artist: 'Favorite', plays: 500, rank: 1, hours: 10 }] }));
    expect(result?.reason).toBe('Favorite has 500 plays in your listening history.');
  });

  it('excludes ranked aliases, saved albums, skipped aliases, and seen albums', () => {
    const result = suggestAlbum(options({
      pool: [{ ...album(2), title: 'Album 1!' }, album(3), album(4), { ...album(5), title: 'Album 4!' }, album(6)],
      lists: { wantToListen: [album(3)], notHeard: [], dontCare: [] }, skipped: new Set([id(4)]), seen: [album(6)],
    }));
    expect(result).toBeNull();
    expect(suggestAlbum(options({ blocked: ['FAVORITE'] }))).toBeNull();
  });

  it('changes artists when possible and falls back when only one remains', () => {
    const opts = options({ pool: [album(2), album(3, 'Second')],
      ranked: [{ ...album(1), rating: 10 }, { ...album(4, 'Second'), rating: 8 }], recentArtists: ['favorite'] });
    expect(suggestAlbum(opts)?.album.primary_artist_name).toBe('Second');
    expect(suggestAlbum({ ...opts, pool: [album(2)] })?.album.mbid).toBe(id(2));
  });

  it('mixes discoveries in only when requested and attributes artist similarity honestly', () => {
    const opts = options({ pool: [album(2), album(3, 'New')], related: [{ mbid: id(102), name: 'New', strength: 2, sources: ['Favorite', 'Second'] }] });
    expect(suggestAlbum(opts)?.kind).toBe('familiar');
    expect(suggestAlbum({ ...opts, recentArtists: ['favorite'] })?.kind).toBe('familiar');
    const discovery = suggestAlbum({ ...opts, discoveryTurn: true });
    expect(discovery?.kind).toBe('discovery');
    expect(discovery?.reason).toContain('Favorite, Second');
    expect(discovery?.reason).toContain('not an album rating prediction');
  });

  it('deprioritizes seasonal albums and avoids likely live variants', () => {
    expect(suggestAlbum(options({ pool: [{ ...album(2), title: 'Christmas' }, album(3)] }))?.album.mbid).toBe(id(3));
    expect(suggestAlbum(options({ pool: [{ ...album(2), title: 'Live at Wembley' }] }))).toBeNull();
  });

  it('boosts curated albums without letting critical acclaim replace personal taste', () => {
    const result = suggestAlbum(options({ pool: [album(2), album(3), album(4, 'Unknown')], curated: [
      { artist: 'Favorite', title: 'Album 3', source: 'Test best albums list' },
      { artist: 'Unknown', title: 'Album 4', source: 'Test best albums list' },
    ] }));
    expect(result?.album.mbid).toBe(id(3));
    expect(result?.reason).toContain('Featured in Test best albums list.');
  });

  it('uses only highly rated, unblocked artists as similarity seeds', () => {
    expect(suggestionSeeds([{ ...album(1), rating: 7 }, { ...album(2, 'Second'), rating: 9 }], ['Second'])).toEqual([]);
  });

  it('combines multiple artist connections, ignores invalid rows, and browses without writing', async () => {
    const request = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('similar-artists')
      ? { artists: [{ mbid: id(102), name: 'New', score: 10 }, { mbid: id(102), name: 'New', score: 10 }, { name: 'Invalid', score: 9 }] }
      : { albums: [album(9, 'New')] } })) as unknown as typeof fetch;
    const result = await loadSuggestionConnections([{ ...album(1), rating: 9 }, { ...album(2, 'Second'), rating: 8 }], [], [], request);
    expect(result.related).toEqual([{ mbid: id(102), name: 'New', strength: 2, sources: ['Favorite', 'Second'] }]);
    expect(result.albums).toEqual([album(9, 'New')]);
    expect(result.unavailable).toBe(false);
    expect(vi.mocked(request).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('degrades to local suggestions when the lookup fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await loadSuggestionConnections([{ ...album(1), rating: 9 }], [], [], request)).toEqual({ related: [], albums: [], unavailable: true });
    expect(suggestAlbum(options())).not.toBeNull();
  });
});

describe('slice filters and gap bonus', () => {
  const withGenres = (a: Album, genres: string[]): Album => ({ ...a, genres });
  /** N ranked 'Favorite' albums rated `rating`, plus one 'Other' album
   *  tagged shoegaze at `sliceRating`. */
  const rankedWithShoegaze = (favoriteCount: number, sliceRating: number) => [
    ...Array.from({ length: favoriteCount }, (_, i) => ({ ...album(200 + i, 'Favorite', 2000), rating: 8 })),
    { ...withGenres(album(300, 'Second', 2000), ['shoegaze']), rating: sliceRating },
  ];

  it('genre sliceFilter excludes untagged candidates', () => {
    const tagged = withGenres(album(2, 'Favorite', 2001), ['shoegaze']);
    const untagged = album(3, 'Favorite', 2001);
    const filter = { dimension: 'genre', genre: 'shoegaze' } as const;
    expect(suggestAlbum(options({ pool: [tagged, untagged], sliceFilter: filter }))?.album.mbid).toBe(id(2));
    expect(suggestAlbum(options({ pool: [untagged], sliceFilter: filter }))).toBeNull();
  });

  it('decade sliceFilter matches by year range', () => {
    const filter = { dimension: 'decade', decade: 1990 } as const;
    expect(
      suggestAlbum(options({ pool: [album(2, 'Favorite', 1994)], sliceFilter: filter }))?.album.mbid
    ).toBe(id(2));
    expect(suggestAlbum(options({ pool: [album(2, 'Favorite', 2001)], sliceFilter: filter }))).toBeNull();
  });

  it('year sliceFilter matches the exact year', () => {
    const filter = { dimension: 'year', year: 1994 } as const;
    expect(
      suggestAlbum(options({ pool: [album(2, 'Favorite', 1994)], sliceFilter: filter }))?.album.mbid
    ).toBe(id(2));
    expect(suggestAlbum(options({ pool: [album(2, 'Favorite', 1995)], sliceFilter: filter }))).toBeNull();
  });

  it('gap bonus fires, names the gap, and outranks an identical candidate without it', () => {
    const gapCandidate = withGenres(album(2, 'Favorite', 2001), ['shoegaze']);
    const twin = album(3, 'Favorite', 2001);
    const result = suggestAlbum(options({ pool: [twin, gapCandidate], ranked: rankedWithShoegaze(24, 8) }));
    expect(result?.album.mbid).toBe(id(2));
    expect(result?.reason).toMatch(
      /You rate shoegaze 8\.0 on average but have only ranked 1 shoegaze album\.$/
    );
  });

  it('stays silent when the slice mean is below the engagement floor', () => {
    const result = suggestAlbum(options({
      pool: [withGenres(album(2, 'Favorite', 2001), ['shoegaze'])],
      ranked: rankedWithShoegaze(24, 6),
    }));
    expect(result?.reason).not.toContain('only ranked');
  });

  it('stays silent on small lists', () => {
    const result = suggestAlbum(options({
      pool: [withGenres(album(2, 'Favorite', 2001), ['shoegaze'])],
      ranked: rankedWithShoegaze(9, 8),
    }));
    expect(result?.reason).not.toContain('only ranked');
  });

  it('adds nothing at the exact share threshold (zero bonus)', () => {
    const result = suggestAlbum(options({
      pool: [withGenres(album(2, 'Favorite', 2001), ['shoegaze'])],
      ranked: rankedWithShoegaze(19, 8),
    }));
    expect(result?.reason).not.toContain('only ranked');
  });
});
