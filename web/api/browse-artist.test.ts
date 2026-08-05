import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './browse-artist';

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

const VALID_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';

describe('/api/browse-artist GET', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-GET methods', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('rejects an invalid artist_mbid', async () => {
    const res = makeRes();
    await handler(getReq({ artist_mbid: 'not-a-uuid', artist_name: 'Radiohead' }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_artist_mbid' });
  });

  it('rejects a missing artist_name', async () => {
    const res = makeRes();
    await handler(getReq({ artist_mbid: VALID_MBID, artist_name: '' }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'missing_artist_name' });
  });

  it('returns the filtered, mapped albums on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          'release-groups': [
            { id: 'rg-1', title: 'OK Computer', 'first-release-date': '1997-01-01', 'primary-type': 'Album', 'secondary-types': [] },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ artist_mbid: VALID_MBID, artist_name: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      albums: [
        {
          mbid: 'rg-1',
          title: 'OK Computer',
          primary_artist_name: 'Radiohead',
          primary_artist_mbid: VALID_MBID,
          release_year: 1997,
          cover_url: 'https://coverartarchive.org/release-group/rg-1/front-500',
        },
      ],
    });
  });

  it('returns 502 when the MusicBrainz fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = makeRes();

    await handler(getReq({ artist_mbid: VALID_MBID, artist_name: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'musicbrainz_unavailable' });
  });
});
