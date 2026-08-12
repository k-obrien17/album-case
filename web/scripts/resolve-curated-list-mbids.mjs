/**
 * Pre-resolve MusicBrainz mbids for every entry in curatedLists.ts, offline,
 * once -- instead of the app resolving each entry live via an unscoped text
 * search at rating-time (which already produced one confirmed bad match in
 * production: "MF DOOM & Madlib Madvillainy" top-hit-matched an unrelated
 * 2026 release, "MF Doom" by Pozer). Two resolution passes, same shape as
 * import-album-canon.mjs:
 *
 *   1. Local hit: the owner's own already-ranked list, matched via the same
 *      normalized artist+title key curatedListMatch.ts uses (imported
 *      directly, not reimplemented) -- Keith's own placed data, zero
 *      MusicBrainz calls, zero ambiguity.
 *   2. MusicBrainz field-scoped search (`artist:"X" AND releasegroup:"Y"`,
 *      not a raw bag-of-words query), filtered to real studio albums
 *      (isLpReleaseGroup), confident only when isConfidentMatch says so
 *      (exactly one candidate, relevance score >= 90 -- same rule
 *      import-album-canon.mjs already uses for the same kind of import).
 *
 * Everything else is written to a report for a human look, never guessed.
 *
 * Node 24 supports native `.ts` import (type-stripping, no build step, no
 * new dependency) -- unlike import-album-canon.mjs/export-collect-albums.mjs,
 * which predate that and duplicate small pieces of `.ts` logic instead. This
 * script imports directly from the real source instead.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/resolve-curated-list-mbids.mjs [--write] [--from-report]
 *
 * Without --write: matches everything, writes curated-mbid-report.json for
 * review, does not touch curatedLists.ts. This only ever touches a
 * git-tracked source file (never production data), so `git diff` is the
 * safety net -- no CONFIRM_* env var gate needed, unlike import-album-canon.mjs.
 *
 * --from-report skips matching entirely and reuses the `confident` list
 * already sitting in curated-mbid-report.json from a prior run -- so
 * reviewing a dry run, then applying it, doesn't mean hitting MusicBrainz's
 * shared public API for the same ~300 queries twice in a row. Only useful
 * combined with --write (on its own it just reprints the loaded counts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { CURATED_LISTS } from '../src/data/curatedLists.ts';
import { OWNER_ID } from '../src/owner.ts';
import { key as curatedMatchKey } from '../src/curatedListMatch.ts';
import { isLpReleaseGroup } from '../api/_lp.ts';
import { isConfidentMatch } from './lib/canon-import.mjs';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const DELAY_MS = 1000;
const WRITE = process.argv.includes('--write');
// Re-uses an already-written REPORT_PATH's `confident` list instead of
// re-matching from scratch -- so reviewing a dry run, then applying it,
// doesn't mean hitting MusicBrainz's public rate-limited API for the same
// ~300 queries twice in a row. Matching is idempotent either way, but
// there's no reason to be inconsiderate to a shared public resource.
const FROM_REPORT = process.argv.includes('--from-report');
// Paths are relative to the repo root, matching this script's own run
// convention (`node --env-file=web/.env.local web/scripts/...`, same as
// import-album-canon.mjs) -- not relative to this script's own directory.
const CURATED_LISTS_PATH = 'web/src/data/curatedLists.ts';
const REPORT_PATH = 'web/scripts/curated-mbid-report.json';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function releaseYear(group) {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

// A first run of this script hit 12 transient 503s out of ~305 calls (a
// sustained few-minutes run at 1 req/sec against MusicBrainz's public,
// rate-limited API) -- clearly load-related, not real ambiguity, but
// without a retry they'd land in needsReview next to genuinely uncertain
// matches and dilute the report. Two retries with backoff before giving up.
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

let confident;
let needsReview;

if (FROM_REPORT) {
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf-8'));
  confident = report.confident;
  needsReview = report.needsReview;
  console.log(`Loaded ${REPORT_PATH}: ${confident.length} confident, ${needsReview.length} needs review. No MusicBrainz calls made.`);
} else {
  // --- Step 1: local index from the owner's own current ranked list. ---
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
  const currentRanked = JSON.parse(String(snapshotRow.ranking_json));
  const localIndex = new Map(currentRanked.map((a) => [curatedMatchKey(a.primary_artist_name, a.title), a]));
  console.log(`Loaded ${currentRanked.length} already-ranked albums as the local match index.`);

  // --- Step 2: resolve every curated entry, local index first, MusicBrainz on a miss. ---
  const entries = [];
  for (const [listId, list] of Object.entries(CURATED_LISTS)) {
    for (const album of list.albums) entries.push({ listId, album });
  }
  console.log(`Resolving ${entries.length} curated entries across ${Object.keys(CURATED_LISTS).length} list(s)...`);

  confident = [];
  needsReview = [];
  let localHits = 0;
  let mbCalls = 0;

  for (let i = 0; i < entries.length; i++) {
    const { listId, album: entry } = entries[i];
    process.stdout.write(`\r${i + 1}/${entries.length} (${localHits} local, ${mbCalls} MusicBrainz)...`);

    const localMatch = localIndex.get(curatedMatchKey(entry.artist, entry.title));
    if (localMatch) {
      localHits++;
      confident.push({
        listId,
        rank: entry.rank,
        source: { artist: entry.artist, title: entry.title },
        resolved: {
          mbid: localMatch.mbid,
          title: localMatch.title,
          primary_artist_name: localMatch.primary_artist_name,
          ...(localMatch.primary_artist_mbid ? { primary_artist_mbid: localMatch.primary_artist_mbid } : {}),
          release_year: localMatch.release_year,
          cover_url: localMatch.cover_url,
        },
        via: 'local',
      });
      continue; // no delay needed, no network call made
    }

    mbCalls++;
    try {
      const candidates = await searchReleaseGroup(entry.artist, entry.title);
      if (isConfidentMatch(candidates)) {
        const group = candidates[0];
        const artistCredit = group['artist-credit']?.[0];
        confident.push({
          listId,
          rank: entry.rank,
          source: { artist: entry.artist, title: entry.title },
          resolved: {
            mbid: group.id,
            title: group.title,
            primary_artist_name: artistCredit?.name ?? entry.artist,
            ...(artistCredit?.artist?.id ? { primary_artist_mbid: artistCredit.artist.id } : {}),
            release_year: releaseYear(group),
            cover_url: `https://coverartarchive.org/release-group/${group.id}/front-500`,
          },
          via: 'musicbrainz',
        });
      } else {
        needsReview.push({
          listId,
          rank: entry.rank,
          source: { artist: entry.artist, title: entry.title },
          candidates: candidates.slice(0, 5).map((c) => ({ id: c.id, title: c.title, score: c.score })),
        });
      }
    } catch (err) {
      needsReview.push({ listId, rank: entry.rank, source: { artist: entry.artist, title: entry.title }, error: String(err) });
    }
    await delay(DELAY_MS); // only rate-limit actual MusicBrainz calls, not local hits
  }
  console.log(); // newline after the progress carriage-returns

  console.log(`Local library hits: ${localHits} | MusicBrainz calls: ${mbCalls}`);
  console.log(`Confident matches: ${confident.length}`);
  console.log(`Needs review: ${needsReview.length}`);

  writeFileSync(REPORT_PATH, JSON.stringify({ confident, needsReview }, null, 2));
  console.log(`Wrote ${REPORT_PATH} for inspection.`);
}

if (!WRITE) {
  console.log('\nDry run complete. Nothing written to curatedLists.ts. Re-run with --write to apply.');
  process.exit(0);
}

// --- Step 3 (--write only): regenerate curatedLists.ts from the in-memory
//     CURATED_LISTS object with `resolved` merged into confident matches,
//     preserving the header doc-comment, each list's name/source, and rank
//     order exactly. needsReview entries are left with no `resolved` field,
//     so they keep working via the existing live-search-plus-confirm path. ---
const resolvedByListAndRank = new Map(confident.map((c) => [`${c.listId}:${c.rank}`, c.resolved]));

function quote(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderResolved(r) {
  const fields = [
    `mbid: ${quote(r.mbid)}`,
    `title: ${quote(r.title)}`,
    `primary_artist_name: ${quote(r.primary_artist_name)}`,
    ...(r.primary_artist_mbid ? [`primary_artist_mbid: ${quote(r.primary_artist_mbid)}`] : []),
    `release_year: ${r.release_year === null ? 'null' : r.release_year}`,
    `cover_url: ${quote(r.cover_url)}`,
  ];
  return `{ ${fields.join(', ')} }`;
}

function renderEntry(listId, entry) {
  const resolved = resolvedByListAndRank.get(`${listId}:${entry.rank}`);
  const fields = [`rank: ${entry.rank}`, `artist: ${quote(entry.artist)}`, `title: ${quote(entry.title)}`];
  if (resolved) fields.push(`resolved: ${renderResolved(resolved)}`);
  return `      { ${fields.join(', ')} },`;
}

const header = readFileSync(CURATED_LISTS_PATH, 'utf-8').split('export const CURATED_LISTS')[0];

const body = Object.entries(CURATED_LISTS)
  .map(([listId, list]) => {
    const albumLines = list.albums.map((entry) => renderEntry(listId, entry)).join('\n');
    return `  ${quote(listId)}: {\n    name: ${quote(list.name)},\n    source: ${quote(list.source)},\n    albums: [\n${albumLines}\n    ],\n  },`;
  })
  .join('\n');

const output = `${header}export const CURATED_LISTS: Record<string, CuratedList> = {\n${body}\n};\n`;
writeFileSync(CURATED_LISTS_PATH, output);

const resolvedCount = [...resolvedByListAndRank.values()].length;
console.log(`\nWrote ${resolvedCount} resolved record(s) into ${CURATED_LISTS_PATH}.`);
