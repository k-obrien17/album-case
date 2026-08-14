/**
 * Proactive cross-check for title-transcription mismatches in curatedLists.ts,
 * per HANDOFF.md's standing note: past sessions found real mismatches (e.g.
 * "The Beatles (White Album)" -> "The Beatles", "Bows and Arrows" -> "Bows +
 * Arrows") only reactively, after Keith reported a specific album. This
 * re-runs that check proactively across every existing list.
 *
 * unrankedFromCuratedList already catches an EXACT normalized-text mismatch
 * (or a resolved.mbid match). What it can't catch: a curated entry whose
 * title is transcribed slightly wrong, so it neither exact-matches nor
 * mbid-matches an album Keith has actually already ranked under the same
 * artist -- that album just silently never shows as "ranked" for this
 * curated entry. This script flags exactly that: same normalized artist,
 * different but SIMILAR title, read-only, no writes.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/cross-check-curated-titles.mjs [--threshold=0.5]
 */
import { createClient } from '@libsql/client';
import { CURATED_LISTS } from '../src/data/curatedLists.ts';
import { OWNER_ID } from '../src/owner.ts';
import { normalize, unrankedFromCuratedList } from '../src/curatedListMatch.ts';

const thresholdArg = process.argv.find((a) => a.startsWith('--threshold='));
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : 0.5;

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Run `vercel env pull web/.env.local` first.');
    process.exit(1);
  }
  return createClient({ url, authToken });
}

// Dice coefficient over character bigrams -- simple, dependency-free, and
// robust to the kind of small transcription drift this is hunting for
// (missing/extra word, punctuation swap, subtitle appended or dropped).
function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function titleSimilarity(a, b) {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let overlap = 0;
  for (const bg of A) if (B.has(bg)) overlap++;
  return (2 * overlap) / (A.size + B.size);
}

const client = db();
const snapshotRows = await client.execute({
  sql: 'SELECT ranking_json FROM ranking_snapshots WHERE session_id = ?',
  args: [OWNER_ID],
});
client.close();
const snapshotRow = snapshotRows.rows[0];
if (!snapshotRow) {
  console.error('No ranking snapshot found for the owner session.');
  process.exit(1);
}
const ranked = JSON.parse(String(snapshotRow.ranking_json));

const rankedByArtist = new Map();
for (const album of ranked) {
  const artistKey = normalize(album.primary_artist_name);
  if (!rankedByArtist.has(artistKey)) rankedByArtist.set(artistKey, []);
  rankedByArtist.get(artistKey).push(album);
}

let totalFlags = 0;
for (const [listId, list] of Object.entries(CURATED_LISTS)) {
  const stillUnranked = new Set(
    unrankedFromCuratedList(list.albums, ranked).map((e) => `${e.rank}`)
  );
  const flags = [];
  for (const entry of list.albums) {
    if (!stillUnranked.has(`${entry.rank}`)) continue; // already matches -- nothing to flag
    const candidates = rankedByArtist.get(normalize(entry.artist)) ?? [];
    for (const candidate of candidates) {
      const sim = titleSimilarity(normalize(entry.title), normalize(candidate.title));
      if (sim >= THRESHOLD) {
        flags.push({ entry, candidate, sim });
      }
    }
  }
  if (flags.length === 0) {
    console.log(`${listId}: no near-miss title mismatches found (${list.albums.length} entries checked).`);
    continue;
  }
  totalFlags += flags.length;
  console.log(`\n${listId}: ${flags.length} possible mismatch(es):`);
  flags
    .sort((a, b) => b.sim - a.sim)
    .forEach(({ entry, candidate, sim }) => {
      console.log(
        `  [${sim.toFixed(2)}] #${entry.rank} "${entry.title}" (${entry.artist}) <-> ranked "${candidate.title}" (${candidate.primary_artist_name}, rated ${candidate.rating}, mbid ${candidate.mbid})`
      );
    });
}

console.log(`\nTotal flags across all lists: ${totalFlags}`);
if (totalFlags === 0) console.log('Nothing to fix.');
