/**
 * One-time backfill: give every album in the owner's current ranked list a
 * rating computed from its CURRENT position, using the same rank->rating
 * formula already built for the site export
 * (web/scripts/export-collect-albums.mjs's score()). Preserves today's
 * order exactly as the starting point for the new rating-primary model.
 *
 * Run ONCE, after the rating-primary code is deployed.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-ratings.mjs
 */
import { createClient } from '@libsql/client';

// Matches web/src/owner.ts's OWNER_ID.
const OWNER_ID = 'c0ffee00-0000-4000-8000-000000000001';

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

const writeKey = process.env.ALBUM_CASE_WRITE_KEY;
if (!writeKey) {
  console.error('Missing ALBUM_CASE_WRITE_KEY. Set it in web/.env.local first.');
  process.exit(1);
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

const ranked = JSON.parse(String(row.ranking_json));
const rated = ranked.map((album, index) => ({
  ...album,
  rating: score(index + 1, ranked.length),
}));

const res = await fetch('https://album-case.vercel.app/api/ranking', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-album-case-write-key': writeKey,
  },
  body: JSON.stringify({
    session_id: OWNER_ID,
    ranked: rated,
    lists: JSON.parse(String(row.lists_json)),
    artist_locks: row.artist_locks_json ? JSON.parse(String(row.artist_locks_json)) : [],
    base_updated_at: Number(row.updated_at),
  }),
});

if (!res.ok) {
  console.error(`Backfill write failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`Backfilled ${rated.length} albums. Rank 1 rating: ${rated[0]?.rating}. Rank ${rated.length} rating: ${rated[rated.length - 1]?.rating}.`);

client.close();
