import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './similar-artists';

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

describe('/api/similar-artists GET', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-GET methods', async () => {
    const res = makeRes();

    await handler({ method: 'POST', query: {} } as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('rejects a non-UUID artist_mbid', async () => {
    const res = makeRes();

    await handler(getReq({ artist_mbid: 'not-a-uuid' }) as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_artist_mbid' });
  });

  it('filters invalid rows and maps valid ones to similar artists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            artist_mbid: '00000000-0000-0000-0000-000000000001',
            name: 'Valid Artist 1',
            score: 0.95,
          },
          {
            artist_mbid: '00000000-0000-0000-0000-000000000002',
            name: 'Valid Artist 2',
            score: 0.87,
          },
          {
            // Missing score
            artist_mbid: '00000000-0000-0000-0000-000000000003',
            name: 'Invalid Artist 1',
          },
          {
            // Missing artist_mbid
            name: 'Invalid Artist 2',
            score: 0.75,
          },
          {
            artist_mbid: '00000000-0000-0000-0000-000000000004',
            // Missing name
            score: 0.65,
          },
        ],
      })
    );
    const res = makeRes();

    await handler(getReq({ artist_mbid: '00000000-0000-0000-0000-000000000000' }) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      artists: [
        {
          mbid: '00000000-0000-0000-0000-000000000001',
          name: 'Valid Artist 1',
          score: 0.95,
        },
        {
          mbid: '00000000-0000-0000-0000-000000000002',
          name: 'Valid Artist 2',
          score: 0.87,
        },
      ],
    });
  });
});
