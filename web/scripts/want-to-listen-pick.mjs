/**
 * Print N random picks from the owner's "Want to listen" list, for /today
 * to surface as a reminder -- see
 * docs/superpowers/specs/2026-08-26-want-to-listen-nudge-design.md.
 *
 * Read-only over Turso. Prints exactly one line of JSON (an array) to
 * stdout, always -- an empty array `[]`, never an error/non-zero exit, on
 * any failure (missing credentials, no snapshot row, empty pile, thrown
 * error), so a caller like /today can render nothing rather than break.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs
 *   COUNT=5 node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs
 */
import { createClient } from '@libsql/client';
import { OWNER_ID } from '../src/owner.ts';

const COUNT = Number(process.env.COUNT || 3);

function randomSample(items, count) {
  const pool = [...items];
  const picked = [];
  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.log('[]');
    return;
  }

  const client = createClient({ url, authToken });
  const rows = await client.execute({
    sql: 'SELECT lists_json FROM ranking_snapshots WHERE session_id = ?',
    args: [OWNER_ID],
  });

  const row = rows.rows[0];
  if (!row) {
    console.log('[]');
    return;
  }

  const lists = JSON.parse(String(row.lists_json));
  const wantToListen = Array.isArray(lists.wantToListen) ? lists.wantToListen : [];

  const picks = randomSample(wantToListen, COUNT).map((album) => ({
    title: album.title,
    primary_artist_name: album.primary_artist_name,
    release_year: album.release_year ?? null,
  }));

  console.log(JSON.stringify(picks));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  console.log('[]');
});
