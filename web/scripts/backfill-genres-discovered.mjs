/**
 * One-time backfill: fetch MusicBrainz genre tags for every discovered_albums
 * row that doesn't have them yet (genres_json IS NULL) -- rows written before
 * discover-artist.ts started requesting `inc=genres`, or rows whose upstream
 * genre lookup failed at discovery time.
 *
 * Read-only until the final per-row UPDATE. Prints a dry-run count first;
 * only hits MusicBrainz and writes to Turso with --write.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-genres-discovered.mjs [--write]
 */
import { createClient } from '@libsql/client';
import { OWNER_ID } from '../src/owner.ts';
import { alterTableAddColumnIfMissing } from '../api/_schema.ts';
import { fetchGenresForMbid, delay, MB_DELAY_MS } from './lib/musicbrainz.mjs';

const WRITE = process.argv.includes('--write');

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Run `vercel env pull web/.env.local` first.');
    process.exit(1);
  }
  return createClient({ url, authToken });
}

const client = db();
// The prod DB only picks up this column when a Vercel function runs
// ensureSchema() -- this script may run before that ever happens, so apply
// the same additive migration discover-artist.ts does.
await alterTableAddColumnIfMissing(client, 'ALTER TABLE discovered_albums ADD COLUMN genres_json TEXT');
const rows = await client.execute({
  sql: 'SELECT mbid, title, primary_artist_name FROM discovered_albums WHERE session_id = ? AND genres_json IS NULL',
  args: [OWNER_ID],
});

console.log(`${rows.rows.length} discovered_albums row(s) missing genres.`);

if (!WRITE) {
  console.log('Dry run complete. Nothing fetched or written. Re-run with --write to apply.');
  client.close();
  process.exit(0);
}

let updated = 0;
let empty = 0;
let failed = 0;

for (let i = 0; i < rows.rows.length; i++) {
  const row = rows.rows[i];
  const mbid = String(row.mbid);
  process.stdout.write(`\r${i + 1}/${rows.rows.length} (${updated} updated, ${empty} no genres, ${failed} failed)...`);
  // A visible heartbeat every 250 rows -- this script runs long enough
  // (~1.6s/row) that a log tail with no newline-terminated output for
  // minutes at a time looks indistinguishable from a hang.
  if ((i + 1) % 250 === 0) {
    console.log(`\nHeartbeat: ${i + 1}/${rows.rows.length} processed.`);
  }

  try {
    const genres = await fetchGenresForMbid(mbid);
    if (genres.length) {
      await client.execute({
        sql: 'UPDATE discovered_albums SET genres_json = ? WHERE session_id = ? AND mbid = ?',
        args: [JSON.stringify(genres), OWNER_ID, mbid],
      });
      updated++;
    } else {
      empty++;
    }
  } catch (err) {
    failed++;
    console.error(`\nFailed ${row.primary_artist_name} -- ${row.title} (${mbid}): ${err}`);
  }
  await delay(MB_DELAY_MS);
}

console.log();
console.log(`Done. Updated: ${updated} | No genre tags upstream: ${empty} | Failed: ${failed}`);
client.close();
