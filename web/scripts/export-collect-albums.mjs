/**
 * Export the owner's top-ranked albums to keithrobrien.com's /collect/albums.
 *
 * Read-only over Turso. Produces a static JSON committed to the kro repo,
 * mirroring media-library/scripts/export-collect-watching.mjs. kro renders
 * it at build time; there is no runtime coupling to this database.
 *
 * Score is NOT stored anywhere in Album Case -- it's derived here, once,
 * from rank position. See docs/superpowers/specs/2026-07-11-album-score-export-design.md
 * for why (Album Case's ranking is transitive-by-construction, not scored).
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/export-collect-albums.mjs
 *   TOP_N=20 COLLECT_OUT=/abs/path/albums.json node --env-file=web/.env.local web/scripts/export-collect-albums.mjs
 */
import { createClient } from '@libsql/client';

// Matches web/src/owner.ts's OWNER_ID. Duplicated, not imported: this is a
// plain Node ESM script with no TS loader, so it can't import a .ts file.
const OWNER_ID = 'c0ffee00-0000-4000-8000-000000000001';

const TOP_N = Number(process.env.TOP_N || 10);

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
  sql: 'SELECT ranking_json FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});

const row = rows.rows[0];
if (!row) {
  console.error('No ranking snapshot found for the owner session.');
  process.exit(1);
}

const ranked = JSON.parse(String(row.ranking_json));
console.log(`Fetched ${ranked.length} ranked albums. First 3:`);
console.log(ranked.slice(0, 3).map((a) => `${a.title} — ${a.primary_artist_name}`));
console.log(`Score for rank 1 of ${ranked.length}: ${score(1, ranked.length)}`);
console.log(`Score for rank ${TOP_N} of ${ranked.length}: ${score(TOP_N, ranked.length)}`);

client.close();
