/**
 * One-time backfill: fetch MusicBrainz genre tags for every album already
 * embedded in the owner's single ranking_snapshots row (the ranked list plus
 * all three lists -- wantToListen, notHeard, dontCare). These are full Album
 * JSON blobs copied in at placement time, so adding a `genres` column
 * elsewhere doesn't touch them -- this rewrites the embedded records
 * directly.
 *
 * Read-only until the final UPDATE. Prints a dry-run count first (unique
 * mbids missing genres, deduped -- the same album can appear in more than
 * one list); only hits MusicBrainz and writes to Turso with --write.
 *
 * Uses the same optimistic-concurrency guard as the app's own save path
 * (WHERE updated_at = <value read at start>) so a live tab saving mid-run
 * can't get silently clobbered -- if that happens the script aborts and
 * asks you to re-run. Close the app before running with --write.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-genres-snapshot.mjs [--write]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { OWNER_ID } from '../src/owner.ts';
import { fetchGenresForMbid, delay, MB_DELAY_MS } from './lib/musicbrainz.mjs';

const WRITE = process.argv.includes('--write');
const LIST_NAMES = ['wantToListen', 'notHeard', 'dontCare'];

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
const rows = await client.execute({
  sql: 'SELECT ranking_json, lists_json, updated_at FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});
const row = rows.rows[0];
if (!row) {
  console.error('No ranking snapshot found for the owner session.');
  process.exit(1);
}

const baseUpdatedAt = Number(row.updated_at);
const ranked = JSON.parse(String(row.ranking_json));
const lists = JSON.parse(String(row.lists_json));

// --- Back up the current (pre-backfill) snapshot before touching anything,
//     same convention as import-album-canon.mjs / backfill-ratings.mjs:
//     written unconditionally, even on a dry run, so a backup always exists
//     on disk before this script does anything further. ---
const backupPath = `web/scripts/backups/genres-snapshot-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
mkdirSync(dirname(backupPath), { recursive: true });
writeFileSync(backupPath, JSON.stringify({ ranked, lists, updated_at: baseUpdatedAt }, null, 2));
console.log(`Backup written to ${backupPath}`);

// One entry per album object across ranking_json + all three lists_json
// arrays -- an album can legitimately appear more than once (e.g. ranked and
// also referenced elsewhere), each occurrence gets the same fetched genres.
const albumRefs = [
  ...ranked,
  ...LIST_NAMES.flatMap((name) => lists[name] ?? []),
];

const missingByMbid = new Map();
for (const album of albumRefs) {
  if (!album.genres?.length && !missingByMbid.has(album.mbid)) {
    missingByMbid.set(album.mbid, album);
  }
}

console.log(`${albumRefs.length} album reference(s) across ranked + lists, ${missingByMbid.size} unique mbid(s) missing genres.`);

if (!WRITE) {
  console.log('Dry run complete. Nothing fetched or written. Re-run with --write to apply.');
  client.close();
  process.exit(0);
}

const genresByMbid = new Map();
const mbids = [...missingByMbid.keys()];
let fetched = 0;
let empty = 0;
let failed = 0;

for (let i = 0; i < mbids.length; i++) {
  const mbid = mbids[i];
  const album = missingByMbid.get(mbid);
  process.stdout.write(`\r${i + 1}/${mbids.length} (${fetched} fetched, ${empty} no genres, ${failed} failed)...`);

  try {
    const genres = await fetchGenresForMbid(mbid);
    if (genres.length) {
      genresByMbid.set(mbid, genres);
      fetched++;
    } else {
      empty++;
    }
  } catch (err) {
    failed++;
    console.error(`\nFailed ${album.primary_artist_name} -- ${album.title} (${mbid}): ${err}`);
  }
  await delay(MB_DELAY_MS);
}
console.log();

function withGenres(album) {
  const genres = genresByMbid.get(album.mbid);
  return genres ? { ...album, genres } : album;
}

const newRanked = ranked.map(withGenres);
const newLists = Object.fromEntries(
  LIST_NAMES.map((name) => [name, (lists[name] ?? []).map(withGenres)])
);

const now = Date.now();
const result = await client.execute({
  sql: `
UPDATE ranking_snapshots
SET ranking_json = ?, lists_json = ?, updated_at = ?
WHERE session_id = ? AND updated_at = ?
`,
  args: [JSON.stringify(newRanked), JSON.stringify(newLists), now, OWNER_ID, baseUpdatedAt],
});

if (Number(result.rowsAffected ?? 0) === 0) {
  console.error(
    'Snapshot changed since this script read it (a tab saved mid-run). Nothing written -- close the app and re-run with --write.'
  );
  client.close();
  process.exit(1);
}

console.log(`Done. Genres fetched: ${fetched} | No genre tags upstream: ${empty} | Failed: ${failed}`);
client.close();
