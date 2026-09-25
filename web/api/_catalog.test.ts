import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import {
  CATALOG_SCHEMA_STATEMENTS,
  catalogUpsertStatement,
  mergeAlbums,
  rankCatalogRows,
  searchCatalog,
  toFtsQuery,
  type CatalogAlbum,
} from './_catalog';

const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
const BJORK = '87c5dedd-371d-4a53-9f7f-80522fb7f3cb';

function cat(overrides: Partial<CatalogAlbum> & { mbid: string; title: string }): CatalogAlbum {
  return {
    primary_artist_name: 'Radiohead',
    primary_artist_mbid: RADIOHEAD,
    release_year: 2000,
    primary_type: 'Album',
    listener_count: 100,
    ...overrides,
  };
}

async function freshCatalog(albums: CatalogAlbum[]): Promise<Client> {
  const client = createClient({ url: ':memory:' });
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await client.execute(sql);
  for (const a of albums) await client.execute(catalogUpsertStatement(a, 1, 'full'));
  return client;
}

describe('toFtsQuery', () => {
  it('quotes each word and prefix-matches the last one', () => {
    expect(toFtsQuery('Kid A')).toBe('"kid" "a"*');
  });

  it('treats FTS syntax characters and operators as plain words', () => {
    expect(toFtsQuery(`Jay-Z "Reasonable" (Doubt) AND don't`)).toBe(
      '"jay" "z" "reasonable" "doubt" "and" "don" "t"*',
    );
  });

  it('returns null when there are no letters or digits', () => {
    expect(toFtsQuery('!!! ???')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
  });

  it('caps the query at 10 words', () => {
    const q = 'a b c d e f g h i j k l';
    expect(toFtsQuery(q)?.split(' ')).toHaveLength(10);
  });
});

describe('rankCatalogRows', () => {
  it('breaks a relevance tie with popularity', () => {
    const ranked = rankCatalogRows([
      { id: 'quiet', relevance: -2, listener_count: 10 },
      { id: 'famous', relevance: -2, listener_count: 5000 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['famous', 'quiet']);
  });

  it('lets a much stronger text match beat a more popular weak match', () => {
    const ranked = rankCatalogRows([
      { id: 'popular-weak', relevance: -1, listener_count: 3000 },
      { id: 'exact', relevance: -10, listener_count: 5 },
    ]);
    expect(ranked[0].id).toBe('exact');
  });
});

describe('searchCatalog (real FTS5)', () => {
  let client: Client;

  beforeEach(async () => {
    client = await freshCatalog([
      cat({ mbid: 'ok', title: 'OK Computer', release_year: 1997, listener_count: 3000 }),
      // Wide popularity gap on purpose: bm25 differs slightly by title
      // length, and the ordering assertion must not hinge on that.
      cat({ mbid: 'kid', title: 'Kid A', listener_count: 30 }),
      cat({ mbid: 'homo', title: 'Homogenic', primary_artist_name: 'Björk', primary_artist_mbid: BJORK, listener_count: 800 }),
    ]);
  });

  it('prefix-matches the artist and orders by popularity', async () => {
    const albums = await searchCatalog(client, 'radioh', 10);
    expect(albums.map((a) => a.mbid)).toEqual(['ok', 'kid']);
  });

  it('matches regardless of accents and case', async () => {
    const lower = await searchCatalog(client, 'bjork', 10);
    const upper = await searchCatalog(client, 'BJÖRK', 10);
    expect(lower.map((a) => a.mbid)).toEqual(['homo']);
    expect(upper.map((a) => a.mbid)).toEqual(['homo']);
  });

  it('maps rows to DiscoveredAlbum with a cover URL', async () => {
    const [album] = await searchCatalog(client, 'kid a', 10);
    expect(album).toEqual({
      mbid: 'kid',
      title: 'Kid A',
      primary_artist_name: 'Radiohead',
      primary_artist_mbid: RADIOHEAD,
      release_year: 2000,
      cover_url: 'https://coverartarchive.org/release-group/kid/front-500',
    });
  });

  it('does not throw on FTS syntax characters in the query', async () => {
    await expect(searchCatalog(client, `"OK" (Computer) AND -`, 10)).resolves.toBeInstanceOf(Array);
  });

  it('returns [] without querying when the query has no words', async () => {
    const throwing = { execute: () => { throw new Error('should not query'); } };
    await expect(searchCatalog(throwing as never, '!!!', 10)).resolves.toEqual([]);
  });

  it('respects the limit', async () => {
    expect(await searchCatalog(client, 'radiohead', 1)).toHaveLength(1);
  });
});

describe('catalogUpsertStatement', () => {
  it('keep-popularity mode leaves listener_count alone and keeps FTS in sync', async () => {
    const client = await freshCatalog([cat({ mbid: 'ok', title: 'OK Computer', listener_count: 3000 })]);
    await client.execute(
      catalogUpsertStatement(cat({ mbid: 'ok', title: 'OK Computer OKNOTOK', listener_count: 0 }), 2, 'keep-popularity'),
    );
    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok'")).rows[0];
    expect(Number(row.listener_count)).toBe(3000);
    expect((await searchCatalog(client, 'oknotok', 10)).map((a) => a.mbid)).toEqual(['ok']);
  });

  it('full mode updates listener_count', async () => {
    const client = await freshCatalog([cat({ mbid: 'ok', title: 'OK Computer', listener_count: 3000 })]);
    await client.execute(catalogUpsertStatement(cat({ mbid: 'ok', title: 'OK Computer', listener_count: 4000 }), 2, 'full'));
    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok'")).rows[0];
    expect(Number(row.listener_count)).toBe(4000);
  });
});

describe('mergeAlbums', () => {
  const a = (mbid: string) => ({ mbid, title: mbid, primary_artist_name: 'x', release_year: null, cover_url: '' });

  it('keeps primary first, drops duplicates, caps the total', () => {
    const merged = mergeAlbums([a('1'), a('2')], [a('2'), a('3'), a('4')], 3);
    expect(merged.map((m) => m.mbid)).toEqual(['1', '2', '3']);
  });
});
