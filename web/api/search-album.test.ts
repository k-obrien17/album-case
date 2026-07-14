import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './search-album';

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

function getReq(query: Record<string, string>) {
  return { method: 'GET', query };
}

describe('/api/search-album GET', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-GET methods', async () => {
    const res = makeRes();

    await handler({ method: 'POST', query: {} } as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('rejects a missing query', async () => {
    const res = makeRes();

    await handler(getReq({}) as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'missing_query' });
  });

  it('filters non-studio-LP release groups and maps the rest to DiscoveredAlbum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            {
              id: 'rg-1',
              title: 'Studio Album',
              'first-release-date': '1975-01-01',
              'primary-type': 'Album',
              'secondary-types': [],
              'artist-credit': [{ name: 'Some Artist', artist: { id: 'artist-1' } }],
            },
            {
              id: 'rg-2',
              title: 'Live at the Forum',
              'first-release-date': '1976-01-01',
              'primary-type': 'Album',
              'secondary-types': ['Live'],
              'artist-credit': [{ name: 'Some Artist', artist: { id: 'artist-1' } }],
            },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ q: 'Some Artist' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      albums: [
        {
          mbid: 'rg-1',
          title: 'Studio Album',
          primary_artist_name: 'Some Artist',
          primary_artist_mbid: 'artist-1',
          release_year: 1975,
          cover_url: 'https://coverartarchive.org/release-group/rg-1/front-500',
        },
      ],
    });
  });

  it('includes a clean EP alongside albums, and still excludes an EP with a secondary type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            {
              id: 'rg-ep-clean',
              title: 'Come On Pilgrim',
              'first-release-date': '1987-01-01',
              'primary-type': 'EP',
              'secondary-types': [],
              'artist-credit': [{ name: 'Pixies', artist: { id: 'artist-pixies' } }],
            },
            {
              id: 'rg-ep-live',
              title: 'Live EP',
              'first-release-date': '1988-01-01',
              'primary-type': 'EP',
              'secondary-types': ['Live'],
              'artist-credit': [{ name: 'Pixies', artist: { id: 'artist-pixies' } }],
            },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ q: 'Pixies' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      albums: [
        {
          mbid: 'rg-ep-clean',
          title: 'Come On Pilgrim',
          primary_artist_name: 'Pixies',
          primary_artist_mbid: 'artist-pixies',
          release_year: 1987,
          cover_url: 'https://coverartarchive.org/release-group/rg-ep-clean/front-500',
        },
      ],
    });
  });
});
