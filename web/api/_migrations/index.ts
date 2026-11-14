import { SCHEMA_STATEMENTS } from '../_schema.js';
import type { Db, Migration } from '../_migrate.js';

// Lives in an underscore-prefixed folder so Vercel does not publish it as a
// function route. See README.md in this folder before adding a migration.

async function missingColumns(db: Db, table: string, columns: string[]): Promise<string[]> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  const present = new Set(info.rows.map((row) => String(row.name)));
  return columns.filter((column) => !present.has(column));
}

const SNAPSHOT_COLUMNS = ['artist_locks_json', 'blocked_artists_json', 'curated_skips_json'];
const DISCOVERED_COLUMNS = ['primary_artist_mbid', 'genres_json'];
const SKIPPED_COLUMNS = ['skipped_albums_json'];

export const MIGRATIONS: Migration[] = [
  {
    id: 1794657600000,
    name: 'baseline_schema',
    // Idempotent on purpose: databases that predate migrations already have
    // these tables, so adopting the baseline changes nothing.
    up: () => SCHEMA_STATEMENTS.map((sql) => sql.trim()),
    down: () => [
      'DROP INDEX IF EXISTS idx_atoms_mechanism',
      'DROP INDEX IF EXISTS idx_atoms_session',
      'DROP TABLE IF EXISTS discovered_albums',
      'DROP TABLE IF EXISTS ranking_snapshots',
      'DROP TABLE IF EXISTS sessions',
      'DROP TABLE IF EXISTS atoms',
    ],
  },
  {
    id: 1794657660000,
    name: 'add_late_snapshot_and_discovery_columns',
    // Columns added after the first deployments. Fresh databases get them from
    // the baseline CREATE TABLE, so only add what a legacy database is missing.
    up: async (db) => [
      ...(await missingColumns(db, 'ranking_snapshots', SNAPSHOT_COLUMNS)).map((c) => `ALTER TABLE ranking_snapshots ADD COLUMN ${c} TEXT`),
      ...(await missingColumns(db, 'discovered_albums', DISCOVERED_COLUMNS)).map((c) => `ALTER TABLE discovered_albums ADD COLUMN ${c} TEXT`),
    ],
    down: () => [
      ...SNAPSHOT_COLUMNS.map((c) => `ALTER TABLE ranking_snapshots DROP COLUMN ${c}`),
      ...DISCOVERED_COLUMNS.map((c) => `ALTER TABLE discovered_albums DROP COLUMN ${c}`),
    ],
  },
  {
    id: 1794657720000,
    name: 'index_discovered_albums_by_artist',
    // discover-artist filters discovered_albums on (session_id, primary_artist_mbid).
    up: () => ['CREATE INDEX IF NOT EXISTS idx_discovered_albums_artist ON discovered_albums(session_id, primary_artist_mbid)'],
    down: () => ['DROP INDEX IF EXISTS idx_discovered_albums_artist'],
  },
  {
    id: 1794657780000,
    name: 'add_skipped_albums_json',
    // Albums the owner hid or permanently removed. Previously browser-only, so a
    // new device or a discarded conflict brought them all back.
    up: async (db) => (await missingColumns(db, 'ranking_snapshots', SKIPPED_COLUMNS)).map((c) => `ALTER TABLE ranking_snapshots ADD COLUMN ${c} TEXT`),
    down: () => SKIPPED_COLUMNS.map((c) => `ALTER TABLE ranking_snapshots DROP COLUMN ${c}`),
  },
];
