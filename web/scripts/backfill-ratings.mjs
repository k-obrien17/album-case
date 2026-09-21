/**
 * One-time backfill: give every album in the owner's current ranked list a
 * rating computed from its CURRENT position, using the same rank->rating
 * formula already built for the site export
 * (web/scripts/export-collect-albums.mjs's score()). Preserves today's
 * order exactly as the starting point for the new rating-primary model.
 *
 * Run ONCE, after the rating-primary code is deployed.
 *
 * Read-only until the final write: prints the computed rank-1/rank-N
 * ratings first (dry run), and only overwrites production once a backup of
 * the current snapshot is on disk and CONFIRM_RATING_BACKFILL=yes is set.
 * Uses the same optimistic-concurrency guard as the app's own save path
 * (base_updated_at, checked server-side) so a live tab saving mid-run can't
 * get silently clobbered.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-ratings.mjs
 *   CONFIRM_RATING_BACKFILL=yes node --env-file=web/.env.local web/scripts/backfill-ratings.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { OWNER_ID } from '../src/owner.ts';

function score(rank, total) {
  const raw = 1 + (9 * (total - rank)) / (total - 1);
  return Math.round(raw * 100) / 100;
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

const client = db();
const rows = await client.execute({
  sql: 'SELECT ranking_json, lists_json, artist_locks_json, updated_at FROM ranking_snapshots WHERE session_id = ?',
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
const artistLocks = row.artist_locks_json ? JSON.parse(String(row.artist_locks_json)) : [];

const rated = ranked.map((album, index) => ({
  ...album,
  rating: score(index + 1, ranked.length),
}));

console.log(
  `${rated.length} albums. Rank 1 rating: ${rated[0]?.rating}. Rank ${rated.length} rating: ${rated[rated.length - 1]?.rating}.`
);

// --- Back up the current (pre-backfill) snapshot before touching anything. ---
const backupPath = `web/scripts/backups/rating-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
mkdirSync(dirname(backupPath), { recursive: true });
writeFileSync(backupPath, JSON.stringify({ ranked, lists, artist_locks: artistLocks, updated_at: baseUpdatedAt }, null, 2));
console.log(`Backup written to ${backupPath}`);

// --- The actual write. Gated behind an explicit env var so this can never
//     fire by accident: everything above this line is read-only (read,
//     compute, backup). Without the env var set, the script stops here
//     having written nothing to production. ---
if (process.env.CONFIRM_RATING_BACKFILL !== 'yes') {
  console.log('\nDry run complete. Set CONFIRM_RATING_BACKFILL=yes to actually write this to production.');
  client.close();
  process.exit(0);
}

const writeKey = process.env.ALBUM_CASE_WRITE_KEY;
if (!writeKey) {
  console.error('Missing ALBUM_CASE_WRITE_KEY. Set it in web/.env.local first.');
  process.exit(1);
}

const res = await fetch('https://album-case.vercel.app/api/ranking', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-album-case-write-key': writeKey,
  },
  body: JSON.stringify({
    session_id: OWNER_ID,
    ranked: rated,
    lists,
    artist_locks: artistLocks,
    base_updated_at: baseUpdatedAt,
  }),
});

if (!res.ok) {
  console.error(`Backfill write failed: ${res.status} ${await res.text()}`);
  console.error(`The pre-backfill snapshot is still safe at ${backupPath}.`);
  process.exit(1);
}

console.log(`Backfilled ${rated.length} albums.`);
client.close();
