import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { client } = await vi.hoisted(async () => {
  const { createClient } = await import('@libsql/client');
  return { client: createClient({ url: 'file::memory:' }) };
});
vi.mock('@libsql/client', () => ({ createClient: () => client }));

import handler from './search-album';
import { CATALOG_SCHEMA_STATEMENTS, catalogUpsertStatement } from './_catalog';

function makeRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
}

async function search(query: Record<string, string>) {
  const res = makeRes();
  await handler({ method: 'GET', query } as never, res as never);
  return res;
}

function mbResponse(ids: string[]) {
  return {
    ok: true,
    json: async () => ({
      'release-groups': ids.map((id) => ({
        id,
        title: `MB ${id}`,
        'primary-type': 'Album',
        'first-release-date': '2001-01-01',
        'artist-credit': [{ name: 'Radiohead', artist: { id: 'artist-r' } }],
      })),
    }),
  };
}

async function seedCatalog(count: number) {
  await client.execute('DROP TABLE IF EXISTS catalog_albums_fts');
  await client.execute('DROP TABLE IF EXISTS catalog_albums');
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await client.execute(sql);
  for (let i = 1; i <= count; i++) {
    await client.execute(
      catalogUpsertStatement(
        {
          mbid: `cat-${i}`,
          title: `Radiohead Album ${i}`,
          primary_artist_name: 'Radiohead',
          primary_artist_mbid: 'artist-r',
          release_year: 1990 + i,
          primary_type: 'Album',
          listener_count: 100 * i,
        },
        1,
        'full',
      ),
    );
  }
}

describe('/api/search-album catalog-first', () => {
  beforeEach(() => {
    vi.stubEnv('TURSO_DATABASE_URL', 'file::memory:');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns 5+ catalog hits without calling MusicBrainz', async () => {
    await seedCatalog(6);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await search({ q: 'radiohead' });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const albums = (res.body as { albums: { mbid: string }[] }).albums;
    expect(albums).toHaveLength(6);
    expect(albums[0].mbid).toBe('cat-6'); // most popular first
  });

  it('merges MusicBrainz results after fewer than 5 catalog hits, catalog first, no duplicates', async () => {
    await seedCatalog(2);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mbResponse(['cat-1', 'mb-1', 'mb-2'])));

    const res = await search({ q: 'radiohead' });

    const ids = (res.body as { albums: { mbid: string }[] }).albums.map((a) => a.mbid);
    expect(ids).toEqual(['cat-2', 'cat-1', 'mb-1', 'mb-2']);
  });

  it('live=1 skips the catalog and goes to MusicBrainz', async () => {
    await seedCatalog(6);
    const fetchMock = vi.fn().mockResolvedValue(mbResponse(['mb-1']));
    vi.stubGlobal('fetch', fetchMock);

    const res = await search({ q: 'radiohead', live: '1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((res.body as { albums: { mbid: string }[] }).albums.map((a) => a.mbid)).toEqual(['mb-1']);
  });

  it('falls back to MusicBrainz when the catalog table does not exist', async () => {
    await client.execute('DROP TABLE IF EXISTS catalog_albums_fts');
    await client.execute('DROP TABLE IF EXISTS catalog_albums');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mbResponse(['mb-1'])));

    const res = await search({ q: 'radiohead' });

    expect(res.statusCode).toBe(200);
    expect((res.body as { albums: { mbid: string }[] }).albums.map((a) => a.mbid)).toEqual(['mb-1']);
  });

  it('still reaches MusicBrainz for a punctuation-only query', async () => {
    await seedCatalog(6);
    const fetchMock = vi.fn().mockResolvedValue(mbResponse(['mb-1']));
    vi.stubGlobal('fetch', fetchMock);

    const res = await search({ q: '!!!' });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns catalog hits when MusicBrainz fails after a partial catalog match', async () => {
    await seedCatalog(2);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const res = await search({ q: 'radiohead' });

    expect(res.statusCode).toBe(200);
    expect((res.body as { albums: unknown[] }).albums).toHaveLength(2);
  });
});
