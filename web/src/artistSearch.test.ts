import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchArtists } from './artistSearch';

function artist(mbid: string) {
  return {
    mbid,
    name: 'Radiohead',
    disambiguation: 'English rock band',
    type: 'Group',
    country: 'GB',
  };
}

describe('searchArtists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('short-circuits on a blank query without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchArtists('   ');

    expect(result).toEqual({ status: 'empty' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the artists from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ artists: [artist('a74b1b7f-71a5-4011-9441-d0b5e4122711')] }),
      } as unknown as Response)
    );

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({
      status: 'found',
      artists: [artist('a74b1b7f-71a5-4011-9441-d0b5e4122711')],
    });
  });

  it('returns an empty status for a successful response with no artists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ artists: [] }),
      } as unknown as Response)
    );

    const result = await searchArtists('zzzzzz');

    expect(result).toEqual({ status: 'empty' });
  });

  it('returns an error status on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({ status: 'error' });
  });

  it('returns an error status on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as unknown as Response));

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({ status: 'error' });
  });

  it('returns an error status on malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      } as unknown as Response)
    );

    const result = await searchArtists('Radiohead');

    expect(result).toEqual({ status: 'error' });
  });
});
