import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './discover-artist';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    execute: vi.fn(),
    batch: vi.fn(),
  },
}));

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => dbMock),
}));

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

function getReq(query: Record<string, string>, headers: Record<string, string> = {}) {
  return { method: 'GET', headers, query };
}

describe('/api/discover-artist GET', () => {
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
    expect(res.body).toEqual({ albums: [] });
  });
});
