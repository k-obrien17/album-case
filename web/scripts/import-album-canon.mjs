/**
 * Import Keith's 396-album ChatGPT-generated canon (existing 244 re-rated,
 * ~152 new) as the new baseline ranked list. See
 * docs/superpowers/specs/2026-07-12-album-canon-import-design.md.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/import-album-canon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { parseCanonCsv, isLpReleaseGroup, isConfidentMatch } from './lib/canon-import.mjs';

const CSV_PATH = process.env.CANON_CSV || `${process.env.HOME}/Desktop/album-canon-8-to-10-rated-and-interspersed.csv`;
const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const DELAY_MS = 1000;

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

async function searchReleaseGroup(artist, title) {
  const escape = (s) => s.replace(/"/g, '\\"');
  const query = `artist:"${escape(artist)}" AND releasegroup:"${escape(title)}"`;
  const params = new URLSearchParams({ query, fmt: 'json' });
  const res = await fetch(`${MB_BASE}/release-group/?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`musicbrainz_${res.status}`);
  const data = await res.json();
  return (data['release-groups'] ?? []).filter(isLpReleaseGroup);
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

// --- Fetch current snapshot and back it up FIRST, before any matching. ---
const client = db();
const snapshotRows = await client.execute({
  sql: 'SELECT ranking_json, lists_json, artist_locks_json, updated_at FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});
const snapshotRow = snapshotRows.rows[0];
if (!snapshotRow) {
  console.error('No ranking snapshot found for the owner session.');
  process.exit(1);
}

const currentRanked = JSON.parse(String(snapshotRow.ranking_json));
const lists = JSON.parse(String(snapshotRow.lists_json));
const artistLocks = snapshotRow.artist_locks_json ? JSON.parse(String(snapshotRow.artist_locks_json)) : [];
const baseUpdatedAt = Number(snapshotRow.updated_at);

const backupPath = `web/scripts/backups/canon-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify({ ranked: currentRanked, lists, artist_locks: artistLocks, updated_at: baseUpdatedAt }, null, 2));
console.log(`Backup written to ${backupPath}`);

// --- Build a local lookup so already-known albums never need a MusicBrainz call. ---
const localIndex = new Map(currentRanked.map((a) => [`${normalize(a.primary_artist_name)}|${normalize(a.title)}`, a]));

// --- Parse the CSV and match every row: local first, MusicBrainz only on a miss. ---
const csvText = readFileSync(CSV_PATH, 'utf-8');
const rows = parseCanonCsv(csvText);
console.log(`Parsed ${rows.length} rows from ${CSV_PATH}`);

const confident = [];
const needsReview = [];
let localHits = 0;
let mbCalls = 0;

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  process.stdout.write(`\rMatching ${i + 1}/${rows.length} (${localHits} local, ${mbCalls} MusicBrainz)...`);

  const localMatch = localIndex.get(`${normalize(row.artist)}|${normalize(row.album)}`);
  if (localMatch) {
    localHits++;
    confident.push({
      row,
      mbid: localMatch.mbid,
      title: localMatch.title,
      primary_artist_name: localMatch.primary_artist_name,
      ...(localMatch.primary_artist_mbid ? { primary_artist_mbid: localMatch.primary_artist_mbid } : {}),
      release_year: localMatch.release_year,
      cover_url: localMatch.cover_url,
    });
    continue; // no delay needed, no network call made
  }

  mbCalls++;
  try {
    const candidates = await searchReleaseGroup(row.artist, row.album);
    if (isConfidentMatch(candidates)) {
      const group = candidates[0];
      const artistCredit = group['artist-credit']?.[0];
      confident.push({
        row,
        mbid: group.id,
        title: group.title,
        primary_artist_name: artistCredit?.name ?? row.artist,
        primary_artist_mbid: artistCredit?.artist?.id,
        release_year: releaseYear(group) ?? row.year,
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
console.log(`Confident matches: ${confident.length}`);
console.log(`Needs review: ${needsReview.length}`);

writeFileSync('web/scripts/canon-import-report.json', JSON.stringify({ confident, needsReview }, null, 2));
console.log('Wrote web/scripts/canon-import-report.json for inspection.');

// --- Build the replace list: confident matches update-or-add; everything else
//     currently in `ranked` that the file doesn't mention is left untouched. ---
const currentByMbid = new Map(currentRanked.map((a) => [a.mbid, a]));
const fileMbids = new Set(confident.map((c) => c.mbid));

const updatedOrNew = confident.map((c) => ({
  mbid: c.mbid,
  title: c.title,
  primary_artist_name: c.primary_artist_name,
  ...(c.primary_artist_mbid ? { primary_artist_mbid: c.primary_artist_mbid } : {}),
  release_year: c.release_year,
  cover_url: c.cover_url,
  rating: c.row.rating,
}));

const untouched = currentRanked.filter((a) => !fileMbids.has(a.mbid));

const newRanked = [...updatedOrNew, ...untouched].sort((a, b) => b.rating - a.rating);

console.log(`Replace list: ${updatedOrNew.length} from the file (updated or new), ${untouched.length} untouched existing, ${newRanked.length} total.`);
