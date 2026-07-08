import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './ranking';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    execute: vi.fn(),
    batch: vi.fn(),
  },
}));

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => dbMock),
}));

function album(mbid: string) {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

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

function postReq(body: unknown) {
  return {
    method: 'POST',
    headers: { 'x-album-case-write-key': 'secret-123' },
    body,
  };
}

function getReq(query: Record<string, string>, headers: Record<string, string> = {}) {
  return { method: 'GET', headers, query };
}

describe('/api/ranking', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('serves a GET without a write key (reads are intentionally public)', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    dbMock.execute.mockResolvedValue({ rows: [] });
    const res = makeRes();

    await handler(
      getReq({ session_id: '11111111-1111-4111-8111-111111111111' }) as never,
      res as never
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ snapshot: null });
  });

  it('returns conflict when a versioned snapshot update affects no row', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    dbMock.execute.mockResolvedValue({ rows: [] });
    dbMock.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 0 }]);
    const res = makeRes();

    await handler(
      postReq({
        session_id: '11111111-1111-4111-8111-111111111111',
        ranked: [album('22222222-2222-4222-8222-222222222222')],
        lists: { wantToListen: [], notHeard: [], dontCare: [] },
        base_updated_at: 123,
      }) as never,
      res as never
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'snapshot_conflict' });
    expect(dbMock.batch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining('WHERE ranking_snapshots.updated_at = ?'),
        }),
      ])
    );
  });

  it('round-trips artist_locks_json through POST then GET', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    dbMock.execute.mockResolvedValue({ rows: [] });
    dbMock.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 1 }]);
    const artistLocks = [
      {
        artistMbid: '33333333-3333-4333-8333-333333333333',
        order: [
          '44444444-4444-4444-8444-444444444444',
          '55555555-5555-4555-8555-555555555555',
        ],
      },
    ];

    const postRes = makeRes();
    await handler(
      postReq({
        session_id: '11111111-1111-4111-8111-111111111111',
        ranked: [album('22222222-2222-4222-8222-222222222222')],
        lists: { wantToListen: [], notHeard: [], dontCare: [] },
        artist_locks: artistLocks,
      }) as never,
      postRes as never
    );
    expect(postRes.statusCode).toBe(200);

    const insertCall = dbMock.batch.mock.calls[0][0][1];
    expect(insertCall.args).toContain(JSON.stringify(artistLocks));
  });

  it('defaults artist_locks to an empty array when the body omits it', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    dbMock.execute.mockResolvedValue({ rows: [] });
    dbMock.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 1 }]);

    const res = makeRes();
    await handler(
      postReq({
        session_id: '11111111-1111-4111-8111-111111111111',
        ranked: [],
        lists: { wantToListen: [], notHeard: [], dontCare: [] },
      }) as never,
      res as never
    );
    expect(res.statusCode).toBe(200);

    const insertCall = dbMock.batch.mock.calls[0][0][1];
    expect(insertCall.args).toContain('[]');
  });

  it('GET defaults a null artist_locks_json (pre-migration row) to an empty array', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://example.test');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'token');
    dbMock.execute.mockResolvedValue({
      rows: [
        {
          ranking_json: '[]',
          lists_json: '{"wantToListen":[],"notHeard":[],"dontCare":[]}',
          artist_locks_json: null,
          updated_at: 123,
        },
      ],
    });
    const res = makeRes();

    await handler(
      getReq({ session_id: '11111111-1111-4111-8111-111111111111' }) as never,
      res as never
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { snapshot: { artist_locks: unknown } }).snapshot.artist_locks).toEqual([]);
  });
});
