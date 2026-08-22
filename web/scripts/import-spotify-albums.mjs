/**
 * Bulk-import Keith's "most listened on Spotify" album list as ranking
 * candidates -- not a pre-rated placement (that's import-album-canon.mjs).
 * Every confident match is inserted into `discovered_albums`, the same
 * table /api/discover-artist.ts writes to, which main.ts's loadDiscoveredAlbums
 * merges into the candidate pool on load (see web/src/main.ts:311). Nothing is
 * placed into the ranked list; Keith still drags each one into position
 * through the normal candidate flow.
 *
 * Same two-pass resolution as import-album-canon.mjs / resolve-curated-list-mbids.mjs:
 *   1. Local hit: match against the owner's own ranked list OR existing
 *      discovered_albums first, zero MusicBrainz calls.
 *   2. MusicBrainz field-scoped search (artist:"X" AND releasegroup:"Y"),
 *      filtered to real studio albums (isLpReleaseGroup), confident only when
 *      isConfidentMatch says so (exactly one candidate, score >= 90).
 *
 * Everything else -- soundtracks, classical works, compilations, kids'
 * content, ambiguous matches -- lands in needsReview for a human look, never
 * guessed.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/import-spotify-albums.mjs [--write]
 *
 * Env vars:
 *   SPOTIFY_TSV  Path to the source TSV (default: web/scripts/data/spotify-top-albums.tsv)
 *
 * Without --write: matches everything, writes spotify-import-report.json for
 * review, touches no production data. --write inserts confident matches into
 * discovered_albums directly (ON CONFLICT DO NOTHING, same idempotent shape
 * discover-artist.ts already uses for this table) -- no CONFIRM_* env var
 * gate, unlike import-album-canon.mjs, since this table has no optimistic-
 * concurrency invariant to violate and every insert is additive/idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { isLpReleaseGroup, isConfidentMatch } from './lib/canon-import.mjs';

const TSV_PATH = process.env.SPOTIFY_TSV || 'web/scripts/data/spotify-top-albums.tsv';
const REPORT_PATH = 'web/scripts/spotify-import-report.json';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const DELAY_MS = 1000;
const WRITE = process.argv.includes('--write');

// Matches web/src/owner.ts's OWNER_ID.
const OWNER_ID = 'c0ffee00-0000-4000-8000-000000000001';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(s) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function releaseYear(group) {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

// Same retry-on-transient-503 behavior as resolve-curated-list-mbids.mjs --
// a sustained few-minutes run at 1 req/sec against MusicBrainz's public,
// rate-limited API sees occasional load-related failures unrelated to real
// ambiguity.
async function searchReleaseGroup(artist, title) {
  const escape = (s) => s.replace(/"/g, '\\"');
  const query = `artist:"${escape(artist)}" AND releasegroup:"${escape(title)}"`;
  const params = new URLSearchParams({ query, fmt: 'json' });
  let lastStatus;
  for (const backoffMs of [0, 2000, 4000]) {
    if (backoffMs > 0) await delay(backoffMs);
    const res = await fetch(`${MB_BASE}/release-group/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.ok) {
      const data = await res.json();
      return (data['release-groups'] ?? []).filter(isLpReleaseGroup);
    }
    lastStatus = res.status;
  }
  throw new Error(`musicbrainz_${lastStatus}`);
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

function parseTsv(text) {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines; // skip header
  return dataLines.map((line) => {
    const [rank, album, artist] = line.split('\t');
    return { rank: Number(rank), album: album.trim(), artist: artist.trim() };
  });
}

const client = db();

// --- Local index #1: the owner's current ranked list. ---
const snapshotRows = await client.execute({
  sql: 'SELECT ranking_json FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});
const snapshotRow = snapshotRows.rows[0];
const currentRanked = snapshotRow ? JSON.parse(String(snapshotRow.ranking_json)) : [];
const rankedIndex = new Map(currentRanked.map((a) => [`${normalize(a.primary_artist_name)}|${normalize(a.title)}`, a]));
console.log(`Loaded ${currentRanked.length} already-ranked albums as a local match index.`);

// --- Local index #2: albums already sitting in discovered_albums for this owner. ---
const discoveredRows = await client.execute({
  sql: 'SELECT mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url FROM discovered_albums WHERE session_id = ?',
  args: [OWNER_ID],
});
const currentDiscovered = discoveredRows.rows.map((row) => ({
  mbid: String(row.mbid),
  title: String(row.title),
  primary_artist_name: String(row.primary_artist_name),
  primary_artist_mbid: row.primary_artist_mbid == null ? undefined : String(row.primary_artist_mbid),
  release_year: row.release_year == null ? null : Number(row.release_year),
  cover_url: String(row.cover_url),
}));
const discoveredIndex = new Map(
  currentDiscovered.map((a) => [`${normalize(a.primary_artist_name)}|${normalize(a.title)}`, a])
);
console.log(`Loaded ${currentDiscovered.length} already-discovered candidates as a local match index.`);

// --- Parse the TSV and match every row. ---
const rows = parseTsv(readFileSync(TSV_PATH, 'utf-8'));
console.log(`Parsed ${rows.length} rows from ${TSV_PATH}`);

const toInsert = []; // confident matches, not yet ranked or discovered -> new candidates
const alreadyRanked = []; // confident matches already in the ranked list -> nothing to do
const alreadyDiscovered = []; // confident matches already a candidate -> nothing to do
const needsReview = [];
let localHits = 0;
let mbCalls = 0;

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  process.stdout.write(`\rMatching ${i + 1}/${rows.length} (${localHits} local, ${mbCalls} MusicBrainz)...`);
  const key = `${normalize(row.artist)}|${normalize(row.album)}`;

  const rankedMatch = rankedIndex.get(key);
  if (rankedMatch) {
    localHits++;
    alreadyRanked.push({ row, mbid: rankedMatch.mbid, title: rankedMatch.title });
    continue;
  }
  const discoveredMatch = discoveredIndex.get(key);
  if (discoveredMatch) {
    localHits++;
    alreadyDiscovered.push({ row, mbid: discoveredMatch.mbid, title: discoveredMatch.title });
    continue;
  }

  mbCalls++;
  try {
    const candidates = await searchReleaseGroup(row.artist, row.album);
    if (isConfidentMatch(candidates)) {
      const group = candidates[0];
      const artistCredit = group['artist-credit']?.[0];
      toInsert.push({
        row,
        mbid: group.id,
        title: group.title,
        primary_artist_name: artistCredit?.name ?? row.artist,
        primary_artist_mbid: artistCredit?.artist?.id,
        release_year: releaseYear(group),
        cover_url: `https://coverartarchive.org/release-group/${group.id}/front-500`,
      });
    } else {
      needsReview.push({ row, candidates: candidates.slice(0, 5).map((c) => ({ id: c.id, title: c.title, score: c.score })) });
    }
  } catch (err) {
    needsReview.push({ row, error: String(err) });
  }
  await delay(DELAY_MS); // only rate-limit actual MusicBrainz calls, not local hits
}
console.log(); // newline after the progress carriage-returns

console.log(`Local library hits: ${localHits} | MusicBrainz calls: ${mbCalls}`);
console.log(`New candidates to insert: ${toInsert.length}`);
console.log(`Already ranked (skipped): ${alreadyRanked.length}`);
console.log(`Already discovered (skipped): ${alreadyDiscovered.length}`);
console.log(`Needs review: ${needsReview.length}`);

writeFileSync(
  REPORT_PATH,
  JSON.stringify({ toInsert, alreadyRanked, alreadyDiscovered, needsReview }, null, 2)
);
console.log(`Wrote ${REPORT_PATH} for inspection.`);

if (!WRITE) {
  console.log('\nDry run complete. Nothing written to discovered_albums. Re-run with --write to apply.');
  client.close();
  process.exit(0);
}

const now = Date.now();
await client.batch(
  toInsert.map((c) => ({
    sql: `
INSERT INTO discovered_albums
  (session_id, mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url, discovered_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, mbid) DO NOTHING
`,
    args: [
      OWNER_ID,
      c.mbid,
      c.title,
      c.primary_artist_name,
      c.primary_artist_mbid ?? null,
      c.release_year,
      c.cover_url,
      now,
    ],
  }))
);

console.log(`\nInsert complete. ${toInsert.length} candidate(s) written to discovered_albums.`);
client.close();
