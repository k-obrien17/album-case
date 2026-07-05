import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import { discoverArtist, loadDiscoveredAlbums } from './discovery';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: 'Radiohead',
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('loadDiscoveredAlbums', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the albums from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ albums: [album('a')] }),
      } as unknown as Response)
    );

    const result = await loadDiscoveredAlbums('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([album('a')]);
  });

  it('returns an empty array on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await loadDiscoveredAlbums('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([]);
  });

  it('returns an empty array on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as unknown as Response));

    const result = await loadDiscoveredAlbums('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([]);
  });
});

describe('discoverArtist', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the artist name and known mbids, returns the albums', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ albums: [album('b')] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverArtist('11111111-1111-4111-8111-111111111111', 'Radiohead', ['a']);

    expect(result).toEqual([album('b')]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/discover-artist',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          session_id: '11111111-1111-4111-8111-111111111111',
          artist_name: 'Radiohead',
          known_mbids: ['a'],
        }),
      })
    );
  });

  it('returns an empty array on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await discoverArtist('11111111-1111-4111-8111-111111111111', 'Radiohead', []);

    expect(result).toEqual([]);
  });
});
