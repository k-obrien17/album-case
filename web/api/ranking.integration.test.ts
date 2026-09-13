import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { client } = await vi.hoisted(async () => {
  const { createClient } = await import('@libsql/client');
  return { client: createClient({ url: 'file::memory:' }) };
});
vi.mock('@libsql/client', () => ({ createClient: () => client }));
import handler from './ranking';

const session = '11111111-1111-4111-8111-111111111111';
const album = { mbid: '22222222-2222-4222-8222-222222222222', title: 'Familiar album', primary_artist_name: 'An artist', release_year: 2000, cover_url: '' };
const emptyLists = { wantToListen: [], notHeard: [], dontCare: [] };
const backlog = { readyToRank: [album], needsRefresher: [], reviewedArtistIds: ['artist-1'], currentArtistId: 'artist-1' };
async function request(method: string, body?: unknown) {
  const res = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; }, setHeader() {} };
  await handler({ method, query: { session_id: session }, headers: {}, body } as never, res as never);
  return res;
}
beforeAll(() => {
  vi.stubEnv('TURSO_DATABASE_URL', 'file::memory:');
  vi.stubEnv('TURSO_AUTH_TOKEN', 'test-token');
});
afterAll(() => { client.close(); vi.unstubAllEnvs(); });

describe('backlog snapshot with real SQLite', () => {
  it('round-trips queues and artist progress without a schema migration', async () => {
    const saved = await request('POST', { session_id: session, ranked: [], lists: { ...emptyLists, backlog }, base_updated_at: null });
    expect(saved.statusCode).toBe(200);
    const loaded = await request('GET');
    expect(loaded.body.snapshot.lists.backlog).toEqual(backlog);
  });

  it('protects review decisions from older clients that omit the new field', async () => {
    const loaded = await request('GET');
    for (const version of [loaded.body.snapshot.updated_at, undefined]) {
      const res = await request('POST', { session_id: session, ranked: [], lists: emptyLists, base_updated_at: version });
      expect(res.statusCode).toBe(409);
    }
    expect((await request('GET')).body.snapshot.lists.backlog).toEqual(backlog);
  });

  it('rejects malformed queues and albums duplicated across ranking or saved lists', async () => {
    for (const lists of [
      { ...emptyLists, backlog: { ...backlog, readyToRank: 'bad' } },
      { ...emptyLists, wantToListen: [album], backlog },
      { ...emptyLists, backlog: { ...backlog, needsRefresher: [album] } },
    ]) expect((await request('POST', { session_id: session, ranked: [], lists })).statusCode).toBe(400);
    expect((await request('POST', { session_id: session, ranked: [{ ...album, rating: 8 }], lists: { ...emptyLists, backlog } })).statusCode).toBe(400);
  });

  it('moves a ready album into ranking and rejects stale versions', async () => {
    const loaded = await request('GET');
    const body = { session_id: session, ranked: [{ ...album, rating: 8.25 }], lists: { ...emptyLists, backlog: { ...backlog, readyToRank: [] } }, base_updated_at: loaded.body.snapshot.updated_at };
    expect((await request('POST', { ...body, base_updated_at: 1 })).statusCode).toBe(409);
    expect((await request('POST', body)).statusCode).toBe(200);
    const result = (await request('GET')).body.snapshot;
    expect(result.ranked).toEqual([{ ...album, rating: 8.25 }]);
    expect(result.lists.backlog.readyToRank).toEqual([]);
  });
});
