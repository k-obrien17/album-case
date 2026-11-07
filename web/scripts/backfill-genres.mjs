/**
 * Backfill `discovered_albums.genres_json` from MusicBrainz release-group
 * genres (same `topGenres` selection rule the live discovery path uses).
 * Resumable: only rows whose genres_json IS NULL are fetched, and a
 * release-group MusicBrainz has no genres for is written as `[]` ("checked,
 * none found") so reruns never re-fetch it. The client already drops empty
 * genre arrays (parseAlbum), so `[]` renders as "No genre yet".
 *
 * Also inserts a discovered_albums row (genres_json NULL, then fetched) for
 * ranked-snapshot albums that have none, and -- with --pool -- for seed-pool
 * albums (web/public/seed/albums.json) that have none, so genre-sliced
 * candidates get coverage too. The bootstrap genre overlay (bootstrap.ts)
 * carries these genres onto pool/ranked records client-side.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-genres.mjs [--write] [--session <id>] [--pool] [--limit <n>]
 *
 * Without --write: prints the target counts per source and exits; no
 * MusicBrainz calls, no DB writes. --limit caps fetches per run (testing /
 * partial runs). MusicBrainz is throttled to ~1 request/second.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { OWNER_ID } from '../src/owner.ts';
import { topGenres } from '../api/_lp.ts';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const DELAY_MS = 1100;
const SEED_PATH = 'web/public/seed/albums.json';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const POOL = argv.includes('--pool');
const sessionFlag = argv.indexOf('--session');
const SESSION_ID = sessionFlag !== -1 ? argv[sessionFlag + 1] : OWNER_ID;
const limitFlag = argv.indexOf('--limit');
const LIMIT = limitFlag !== -1 ? Number(argv[limitFlag + 1]) : Infinity;
if (!SESSION_ID || (limitFlag !== -1 && !Number.isInteger(LIMIT))) {
  console.error('Usage: backfill-genres.mjs [--write] [--session <id>] [--pool] [--limit <n>]');
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Run `vercel env pull web/.env.local` first.');
    process.exit(1);
  }
  return createClient({ url, authToken });
}

/** GET a release-group with its genres; retries transient 503s like the
 *  other MusicBrainz scripts. Returns null for a 404 (gone/merged mbid). */
async function fetchReleaseGroup(mbid) {
  let lastStatus;
  for (const backoffMs of [0, 2000, 4000]) {
    if (backoffMs > 0) await delay(backoffMs);
    const res = await fetch(`${MB_BASE}/release-group/${mbid}?inc=genres&fmt=json`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.ok) return await res.json();
    if (res.status === 404) return null;
    lastStatus = res.status;
  }
  throw new Error(`musicbrainz_${lastStatus}`);
}

const client = db();

// The genres_json column migrates on demand (same statement discover-artist.ts
// runs); an already-migrated DB throws "duplicate column", which is fine.
try {
  await client.execute('ALTER TABLE discovered_albums ADD COLUMN genres_json TEXT');
} catch {
  /* column already exists */
}

// --- Targets ---
const discoveredRows = await client.execute({
  sql: 'SELECT mbid FROM discovered_albums WHERE session_id = ? AND genres_json IS NULL',
  args: [SESSION_ID],
});
const nullGenreMbids = discoveredRows.rows.map((row) => String(row.mbid));

const allDiscoveredRows = await client.execute({
  sql: 'SELECT mbid FROM discovered_albums WHERE session_id = ?',
  args: [SESSION_ID],
});
const discoveredMbids = new Set(allDiscoveredRows.rows.map((row) => String(row.mbid)));

const snapshotRows = await client.execute({
  sql: 'SELECT ranking_json FROM ranking_snapshots WHERE session_id = ?',
  args: [SESSION_ID],
});
const ranked = snapshotRows.rows[0] ? JSON.parse(String(snapshotRows.rows[0].ranking_json)) : [];
const rankedMissing = ranked.filter((a) => a?.mbid && !discoveredMbids.has(a.mbid));

let poolMissing = [];
if (POOL) {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
  poolMissing = seed.filter((a) => a?.mbid && !discoveredMbids.has(a.mbid));
}

console.log(`Session ${SESSION_ID}`);
console.log(`  discovered rows missing genres: ${nullGenreMbids.length}`);
console.log(`  ranked albums with no discovered row: ${rankedMissing.length}`);
console.log(`  seed-pool albums with no discovered row: ${POOL ? poolMissing.length : '(skipped; pass --pool)'}`);

if (!WRITE) {
  console.log('Dry run: nothing fetched, nothing written. Re-run with --write.');
  process.exit(0);
}

// --- Insert rows for ranked/pool albums that have none (genres fetched below). ---
const now = Date.now();
for (const album of [...rankedMissing, ...poolMissing]) {
  await client.execute({
    sql: `
INSERT INTO discovered_albums
  (session_id, mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url, discovered_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, mbid) DO NOTHING
`,
    args: [
      SESSION_ID,
      album.mbid,
      album.title ?? '',
      album.primary_artist_name ?? '',
      album.primary_artist_mbid ?? null,
      album.release_year ?? null,
      album.cover_url ?? '',
      now,
    ],
  });
  nullGenreMbids.push(album.mbid);
}

// --- Fetch + write, 1 req/s, resumable. ---
const targets = [...new Set(nullGenreMbids)].slice(0, LIMIT);
console.log(`Fetching genres for ${targets.length} release-groups (~${Math.ceil((targets.length * DELAY_MS) / 60000)} min)...`);
let written = 0;
let skipped = 0;
for (const mbid of targets) {
  try {
    const group = await fetchReleaseGroup(mbid);
    if (group === null) {
      console.log(`  ${mbid}: 404, leaving NULL`);
      skipped += 1;
    } else {
      const genres = topGenres(group);
      await client.execute({
        sql: 'UPDATE discovered_albums SET genres_json = ? WHERE session_id = ? AND mbid = ?',
        args: [JSON.stringify(genres), SESSION_ID, mbid],
      });
      written += 1;
      console.log(`  ${mbid}: ${genres.length ? genres.join(', ') : '[] (none on MusicBrainz)'} [${written}/${targets.length}]`);
    }
  } catch (err) {
    console.log(`  ${mbid}: ${err instanceof Error ? err.message : err}, leaving NULL for a rerun`);
    skipped += 1;
  }
  await delay(DELAY_MS);
}
console.log(`Done. Wrote ${written}, left ${skipped} NULL for a rerun.`);
