import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { client } = await vi.hoisted(async () => {
  const { createClient } = await import('@libsql/client');
  return { client: createClient({ url: 'file::memory:' }) };
});
vi.mock('@libsql/client', () => ({ createClient: () => client }));
import handler from './ranking';

const session = '33333333-3333-4333-8333-333333333333';
const emptyLists = { wantToListen: [], notHeard: [], dontCare: [] };

async function request(method: string, body?: unknown) {
  const res = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; }, setHeader() {} };
  await handler({ method, query: { session_id: session }, headers: {}, body } as never, res as never);
  return res;
}
const snapshot = async () => (await request('GET')).body.snapshot;

beforeAll(() => {
  vi.stubEnv('TURSO_DATABASE_URL', 'file::memory:');
  vi.stubEnv('TURSO_AUTH_TOKEN', 'test-token');
});
afterAll(() => {
  client.close();
  vi.unstubAllEnvs();
});

describe('skipped albums are saved with the snapshot', () => {
  it('starts empty, then round-trips what the client sends (deduplicated)', async () => {
    const first = await request('POST', { session_id: session, ranked: [], lists: emptyLists, base_updated_at: null, skipped_albums: ['a', 'b', 'a'] });
    expect(first.statusCode).toBe(200);

    expect((await snapshot()).skipped_albums).toEqual(['a', 'b']);
  });

  it('keeps the stored skips when an older client omits the field', async () => {
    const before = await snapshot();
    const res = await request('POST', { session_id: session, ranked: [], lists: emptyLists, base_updated_at: before.updated_at });
    expect(res.statusCode).toBe(200);

    expect((await snapshot()).skipped_albums).toEqual(['a', 'b']);
  });

  it('replaces them when the client sends a new set, including an empty one', async () => {
    let current = await snapshot();
    let res = await request('POST', { session_id: session, ranked: [], lists: emptyLists, base_updated_at: current.updated_at, skipped_albums: ['a', 'b', 'c'] });
    expect(res.statusCode).toBe(200);
    expect((await snapshot()).skipped_albums).toEqual(['a', 'b', 'c']);

    current = await snapshot();
    res = await request('POST', { session_id: session, ranked: [], lists: emptyLists, base_updated_at: current.updated_at, skipped_albums: [] });
    expect(res.statusCode).toBe(200);
    expect((await snapshot()).skipped_albums).toEqual([]);
  });

  it('rejects a malformed field without writing anything', async () => {
    const before = await snapshot();
    for (const bad of ['nope', [1, 2], [''], ['x'.repeat(101)], Array.from({ length: 20001 }, (_, i) => `m${i}`)]) {
      const res = await request('POST', { session_id: session, ranked: [], lists: emptyLists, base_updated_at: before.updated_at, skipped_albums: bad });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_skipped_albums' });
    }
    expect((await snapshot()).updated_at).toBe(before.updated_at);
  });
});
