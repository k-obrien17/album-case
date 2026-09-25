/**
 * Copy the pipeline's album catalog (data/tastetest.db, built by
 * pipeline/build.py) into Turso's catalog_albums table.
 *
 * Usage (from the repo root):
 *   node web/scripts/load-catalog.mjs [--db data/tastetest.db]
 *   node --env-file=web/.env.local web/scripts/load-catalog.mjs --write
 *
 * Without --write: reads the local DB and prints counts, a sample, and the
 * batch plan. Touches nothing remote and needs no credentials.
 * --write: upserts every row (additive; never touches ranking_snapshots,
 * atoms, sessions, or discovered_albums). Safe to re-run for a newer dump.
 */
import { existsSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { loadCatalog } from './lib/catalog-load.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const dbFlag = args.indexOf('--db');
const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : 'data/tastetest.db';

if (!dbPath || !existsSync(dbPath)) {
  console.error(`No pipeline database at ${dbPath}. Run pipeline/build.py first.`);
  process.exit(1);
}

const source = createClient({ url: `file:${dbPath}` });
let target = null;
if (write) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('--write needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (use --env-file=web/.env.local).');
    process.exit(1);
  }
  target = createClient({ url, authToken });
}

const report = await loadCatalog({ source, target, write });
console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', ...report }, null, 2));
