import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { loadCatalog } from './catalog-load.mjs';
import { searchCatalog } from '../../api/_catalog.ts';

async function pipelineDb() {
  const source = createClient({ url: ':memory:' });
  await source.execute(`CREATE TABLE entities (
    entity_type TEXT NOT NULL, mbid TEXT NOT NULL, title TEXT NOT NULL,
    primary_artist_name TEXT, primary_artist_mbid TEXT, release_year INTEGER,
    cover_url TEXT, notability_score INTEGER, release_type TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (entity_type, mbid))`);
  const rows = [
    ['album', 'ok', 'OK Computer', 'Radiohead', 'r', 1997, 3000, 'Album'],
    ['album', 'ep', 'Come On Pilgrim', 'Pixies', 'p', 1987, 900, 'EP'],
    ['album', 'old', 'Pre-Migration Row', 'Someone', 's', 1990, 100, null],
  ];
  for (const r of rows) {
    await source.execute({
      sql: `INSERT INTO entities (entity_type, mbid, title, primary_artist_name, primary_artist_mbid,
            release_year, notability_score, release_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      args: r,
    });
  }
  return source;
}

async function tableExists(client, name) {
  const r = await client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE name = ?", args: [name] });
  return r.rows.length > 0;
}

describe('loadCatalog', () => {
  it('dry run reports counts and writes nothing', async () => {
    const source = await pipelineDb();
    const target = createClient({ url: ':memory:' });

    const report = await loadCatalog({ source, target, write: false, log: () => {} });

    expect(report.albums).toBe(2);
    expect(report.byType).toEqual({ Album: 1, EP: 1 });
    expect(report.written).toBe(0);
    expect(await tableExists(target, 'catalog_albums')).toBe(false);
  });

  it('write loads rows that are immediately searchable', async () => {
    const source = await pipelineDb();
    const target = createClient({ url: ':memory:' });

    const report = await loadCatalog({ source, target, write: true, now: 5, log: () => {} });

    expect(report.written).toBe(2);
    expect((await searchCatalog(target, 'pilgrim', 10)).map((a) => a.mbid)).toEqual(['ep']);
  });

  it('re-running is idempotent and refreshes popularity', async () => {
    const source = await pipelineDb();
    const target = createClient({ url: ':memory:' });
    await loadCatalog({ source, target, write: true, log: () => {} });
    await source.execute("UPDATE entities SET notability_score = 4000 WHERE mbid = 'ok'");

    await loadCatalog({ source, target, write: true, log: () => {} });

    const count = (await target.execute('SELECT COUNT(*) AS n FROM catalog_albums')).rows[0].n;
    const ok = (await target.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok'")).rows[0];
    expect(Number(count)).toBe(2);
    expect(Number(ok.listener_count)).toBe(4000);
  });
});
