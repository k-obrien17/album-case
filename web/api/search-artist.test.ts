import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './search-artist';

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

describe('/api/search-artist GET', () => {
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

  it('rejects a query over the length cap', async () => {
    const res = makeRes();

    await handler(getReq({ q: 'x'.repeat(201) }) as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'query_too_long' });
  });

  it('maps a MusicBrainz artist search response to ArtistResult[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          artists: [
            {
              id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
              name: 'Radiohead',
              type: 'Group',
              country: 'GB',
              disambiguation: 'English rock band',
            },
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Genesis',
              type: 'Group',
              country: 'GB',
            },
          ],
        }),
      })
    );
    const res = makeRes();

    await handler(getReq({ q: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      artists: [
        {
          mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          name: 'Radiohead',
          disambiguation: 'English rock band',
          type: 'Group',
          country: 'GB',
        },
        {
          mbid: '11111111-1111-4111-8111-111111111111',
          name: 'Genesis',
          disambiguation: null,
          type: 'Group',
          country: 'GB',
        },
      ],
    });
  });

  it('returns 502 when MusicBrainz is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as unknown as Response));
    const res = makeRes();

    await handler(getReq({ q: 'Radiohead' }) as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'musicbrainz_unavailable' });
  });
});
