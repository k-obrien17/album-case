/**
 * Full export of the owner's Album Case data: every album the app knows
 * about (ranked, want-to-listen, haven't-heard, don't-care-to-rank, and
 * still-undecided discovered albums), plus the paused artist locks.
 *
 * Read-only over Turso. Combines ranking_snapshots (ranked + the three
 * set-aside lists + artist_locks_json) with discovered_albums (the full
 * MusicBrainz-discovered pool) so albums sitting in the pool but not yet
 * placed anywhere are still captured, tagged status "undecided".
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/export-all.mjs
 *   OUT_DIR=/abs/path node --env-file=web/.env.local web/scripts/export-all.mjs
 */
import { createClient } from '@libsql/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_ID } from '../src/owner.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Run `vercel env pull web/.env.local` first.');
    process.exit(1);
  }
  return createClient({ url, authToken });
}

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function albumsToCsv(rows) {
  const header = ['status', 'title', 'primary_artist_name', 'release_year', 'rating', 'mbid', 'primary_artist_mbid'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => csvEscape(row[key])).join(','));
  }
  return lines.join('\n') + '\n';
}

const client = db();

const snapshotRows = await client.execute({
  sql: 'SELECT ranking_json, lists_json, artist_locks_json, updated_at FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});
const snapshot = snapshotRows.rows[0];
if (!snapshot) {
  console.error('No ranking snapshot found for the owner session.');
  process.exit(1);
}

const ranked = JSON.parse(String(snapshot.ranking_json));
const lists = JSON.parse(String(snapshot.lists_json));
const wantToListen = lists.wantToListen ?? [];
const notHeard = lists.notHeard ?? [];
const dontCare = lists.dontCare ?? [];
const artistLocks = snapshot.artist_locks_json ? JSON.parse(String(snapshot.artist_locks_json)) : [];

const discoveredRows = await client.execute({
  sql: 'SELECT mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url, discovered_at FROM discovered_albums WHERE session_id = ?',
  args: [OWNER_ID],
});
const discovered = discoveredRows.rows.map((row) => ({
  mbid: String(row.mbid),
  title: String(row.title),
  primary_artist_name: String(row.primary_artist_name),
  primary_artist_mbid: row.primary_artist_mbid == null ? null : String(row.primary_artist_mbid),
  release_year: row.release_year == null ? null : Number(row.release_year),
  cover_url: String(row.cover_url),
  discovered_at: Number(row.discovered_at),
}));

const placedMbids = new Set([...ranked, ...wantToListen, ...notHeard, ...dontCare].map((a) => a.mbid));
const undecided = discovered.filter((a) => !placedMbids.has(a.mbid));

// Flat, status-tagged view of every album the app has a record of, for the
// CSV and for a quick total count. Ranked keeps its real rating; every
// other bucket has no rating by construction (see web/api/ranking.ts).
const flat = [
  ...ranked.map((a) => ({ status: 'ranked', ...a })),
  ...wantToListen.map((a) => ({ status: 'want_to_listen', ...a, rating: null })),
  ...notHeard.map((a) => ({ status: 'havent_heard', ...a, rating: null })),
  ...dontCare.map((a) => ({ status: 'dont_care_to_rank', ...a, rating: null })),
  ...undecided.map((a) => ({ status: 'undecided_pool', ...a, rating: null })),
];

const payload = {
  generated_at: new Date().toISOString(),
  source: 'album-case',
  owner_session_id: OWNER_ID,
  snapshot_updated_at: Number(snapshot.updated_at),
  counts: {
    ranked: ranked.length,
    want_to_listen: wantToListen.length,
    havent_heard: notHeard.length,
    dont_care_to_rank: dontCare.length,
    undecided_pool: undecided.length,
    total_albums: flat.length,
    paused_artist_locks: artistLocks.length,
  },
  ranked,
  want_to_listen: wantToListen,
  havent_heard: notHeard,
  dont_care_to_rank: dontCare,
  undecided_pool: undecided,
  paused_artist_locks: artistLocks,
};

const OUT_DIR = process.env.OUT_DIR || join(SCRIPT_DIR, 'backups');
mkdirSync(OUT_DIR, { recursive: true });
const stamp = payload.generated_at.replace(/[:.]/g, '-');
const jsonPath = join(OUT_DIR, `export-all-${stamp}.json`);
const csvPath = join(OUT_DIR, `export-all-${stamp}.csv`);

writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
writeFileSync(csvPath, albumsToCsv(flat));

console.log(`Wrote ${payload.counts.total_albums} albums (${jsonPath})`);
console.log(`Wrote flat CSV (${csvPath})`);
console.log(payload.counts);

client.close();
