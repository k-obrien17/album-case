import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rollbackLast, runMigrations, validateMigrations, type Migration } from './_migrate';
import { MIGRATIONS } from './_migrations/index';

let db: Client;

beforeEach(() => {
  db = createClient({ url: 'file::memory:' });
});
afterEach(() => {
  db.close();
});

async function tables(): Promise<string[]> {
  const rows = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.rows.map((r) => String(r.name));
}
async function columns(table: string): Promise<string[]> {
  return (await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
}
async function history(): Promise<number[]> {
  return (await db.execute('SELECT id FROM schema_migrations ORDER BY id')).rows.map((r) => Number(r.id));
}

describe('migration list', () => {
  it('has unique, strictly ascending millisecond ids', () => {
    expect(() => validateMigrations(MIGRATIONS)).not.toThrow();
    for (const m of MIGRATIONS) expect(m.id).toBeGreaterThan(1_700_000_000_000);
  });

  it('rejects duplicate or out-of-order ids', () => {
    const noop = { up: () => [], down: () => [] };
    expect(() => validateMigrations([{ id: 2, name: 'a', ...noop }, { id: 2, name: 'b', ...noop }])).toThrow(/migration_order/);
    expect(() => validateMigrations([{ id: 3, name: 'a', ...noop }, { id: 2, name: 'b', ...noop }])).toThrow(/migration_order/);
  });
});

describe('runMigrations', () => {
  it('builds the full schema on an empty database and records every migration', async () => {
    await runMigrations(db, MIGRATIONS);

    expect(await tables()).toEqual(['atoms', 'discovered_albums', 'ranking_snapshots', 'schema_migrations', 'sessions']);
    expect(await columns('ranking_snapshots')).toEqual(expect.arrayContaining(['artist_locks_json', 'blocked_artists_json', 'curated_skips_json', 'skipped_albums_json']));
    expect(await columns('discovered_albums')).toEqual(expect.arrayContaining(['primary_artist_mbid', 'genres_json']));
    expect(await history()).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('adopts a legacy database without touching its rows or failing on columns it lacks', async () => {
    await db.batch([
      'CREATE TABLE sessions (session_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen_at INTEGER)',
      'CREATE TABLE ranking_snapshots (session_id TEXT PRIMARY KEY, ranking_json TEXT NOT NULL, lists_json TEXT NOT NULL, updated_at INTEGER NOT NULL)',
      'CREATE TABLE discovered_albums (session_id TEXT NOT NULL, mbid TEXT NOT NULL, title TEXT NOT NULL, primary_artist_name TEXT NOT NULL, release_year INTEGER, cover_url TEXT NOT NULL, discovered_at INTEGER NOT NULL, PRIMARY KEY (session_id, mbid))',
      { sql: 'INSERT INTO ranking_snapshots VALUES (?, ?, ?, ?)', args: ['s1', '[{"mbid":"a"}]', '{}', 123] },
    ]);

    await runMigrations(db, MIGRATIONS);

    const row = (await db.execute('SELECT ranking_json, updated_at FROM ranking_snapshots WHERE session_id = \'s1\'')).rows[0];
    expect(String(row.ranking_json)).toBe('[{"mbid":"a"}]');
    expect(Number(row.updated_at)).toBe(123);
    expect(await columns('ranking_snapshots')).toEqual(expect.arrayContaining(['artist_locks_json', 'blocked_artists_json', 'curated_skips_json']));
    expect(await columns('discovered_albums')).toEqual(expect.arrayContaining(['primary_artist_mbid', 'genres_json']));
    expect(await history()).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('is idempotent: a second run applies nothing and keeps one history row each', async () => {
    await runMigrations(db, MIGRATIONS);
    const before = (await db.execute('SELECT applied_at FROM schema_migrations ORDER BY id')).rows.map((r) => Number(r.applied_at));

    await runMigrations(db, MIGRATIONS);

    expect((await db.execute('SELECT applied_at FROM schema_migrations ORDER BY id')).rows.map((r) => Number(r.applied_at))).toEqual(before);
  });

  it('treats a migration another instance recorded first as applied instead of failing', async () => {
    let raced = false;
    const racing: Migration = {
      id: 5,
      name: 'racing',
      up: async (d) => {
        if (!raced) {
          raced = true;
          // Simulate a concurrent cold start winning the race between our check and our write.
          await d.execute({ sql: 'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', args: [5, 'racing', 1] });
        }
        return ['CREATE TABLE racing_probe (id INTEGER)'];
      },
      down: () => ['DROP TABLE racing_probe'],
    };

    await expect(runMigrations(db, [racing])).resolves.toBeUndefined();
    expect(await history()).toEqual([5]);
  });

  it('rolls back a failed migration atomically and does not record it', async () => {
    const broken: Migration = {
      id: 9,
      name: 'broken',
      up: () => ['CREATE TABLE half_done (id INTEGER)', 'THIS IS NOT SQL'],
      down: () => [],
    };

    await expect(runMigrations(db, [broken])).rejects.toThrow();
    expect(await tables()).not.toContain('half_done');
    expect(await history()).toEqual([]);
  });
});

describe('rollbackLast', () => {
  it('reverts the newest migration, then up re-applies it', async () => {
    await runMigrations(db, MIGRATIONS);

    const reverted = await rollbackLast(db, MIGRATIONS);

    expect(reverted).toBe(MIGRATIONS[MIGRATIONS.length - 1].name);
    expect(await history()).toEqual(MIGRATIONS.slice(0, -1).map((m) => m.id));
    expect(await columns('ranking_snapshots')).not.toContain('skipped_albums_json');

    await runMigrations(db, MIGRATIONS);
    expect(await history()).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('can unwind every migration and rebuild from nothing', async () => {
    await runMigrations(db, MIGRATIONS);
    for (let i = 0; i < MIGRATIONS.length; i += 1) await rollbackLast(db, MIGRATIONS);

    expect(await history()).toEqual([]);
    expect(await tables()).toEqual(['schema_migrations']);

    await runMigrations(db, MIGRATIONS);
    expect(await columns('ranking_snapshots')).toEqual(expect.arrayContaining(['artist_locks_json']));
  });

  it('returns null when nothing is applied', async () => {
    expect(await rollbackLast(db, MIGRATIONS)).toBeNull();
  });
});
