/**
 * Import Keith's 396-album ChatGPT-generated canon (existing 244 re-rated,
 * ~152 new) as the new baseline ranked list. See
 * docs/superpowers/specs/2026-07-12-album-canon-import-design.md.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/import-album-canon.mjs
 *
 * Env vars:
 *   CANON_CSV      Path to the source CSV (default: ~/Desktop/album-canon-8-to-10-rated-and-interspersed.csv)
 *   RATING_FLOOR   Optional minimum rating enforced on top of the unconditional 0-10 range check (default: 0)
 *   CONFIRM_CANON_IMPORT=yes  Required to actually write to production; otherwise this is a dry run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { parseCanonCsv, isLpReleaseGroup, isConfidentMatch } from './lib/canon-import.mjs';

const CSV_PATH = process.env.CANON_CSV || `${process.env.HOME}/Desktop/album-canon-8-to-10-rated-and-interspersed.csv`;
const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const DELAY_MS = 1000;

// The canon import was 8-to-10 by construction, so it ran with a hard 8.0
// floor. Ratings now run 0-10 app-wide, so the floor is opt-in: default 0.
// The type/NaN/range check below is NOT optional -- that's the real invariant.
const RATING_FLOOR = Number(process.env.RATING_FLOOR ?? 0);
if (!Number.isFinite(RATING_FLOOR) || RATING_FLOOR < 0 || RATING_FLOOR > 10) {
  console.error(`Invalid RATING_FLOOR: ${process.env.RATING_FLOOR}. Must be a number in 0-10.`);
  process.exit(1);
}

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
mkdirSync(dirname(backupPath), { recursive: true });
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
const fileMbids = new Set(confident.map((c) => c.mbid));

const updatedOrNew = confident.map((c) => ({
  mbid: c.mbid,
  title: c.title,
  primary_artist_name: c.primary_artist_name,
  ...(c.primary_artist_mbid ? { primary_artist_mbid: c.primary_artist_mbid } : {}),
  release_year: c.release_year,
  cover_url: c.cover_url,
  rating: c.row.rating,
  ranking: c.row.ranking,
}));

const untouched = currentRanked.filter((a) => !fileMbids.has(a.mbid));

// Tiebreak on the CSV's own Ranking column so tied ratings don't silently
// depend on stable-sort plus input order (175 of 375 adjacent pairs in the
// real data are rating ties). `untouched` albums carry no CSV ranking, so
// they sort after tied CSV-sourced albums via the `?? Infinity` fallback.
// This CSV-Ranking tiebreak only holds for non-lock albums: for any pair
// tied on rating that also belongs to the same artist lock, the
// repairLockTies pass below overrides this order to match the lock's
// specified relative order instead.
const ratingSorted = [...updatedOrNew, ...untouched]
  .sort((a, b) => b.rating - a.rating || (a.ranking ?? Infinity) - (b.ranking ?? Infinity))
  // `ranking` is a sort-only field, not part of the Album schema -- strip it
  // before this is ever written so it can't leak into the stored snapshot.
  .map(({ mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url, rating }) => ({
    mbid,
    title,
    primary_artist_name,
    ...(primary_artist_mbid ? { primary_artist_mbid } : {}),
    release_year,
    cover_url,
    rating,
  }));

console.log(`Replace list: ${updatedOrNew.length} from the file (updated or new), ${untouched.length} untouched existing, ${ratingSorted.length} total.`);

// Unconditional invariant: every rating in the resulting library must be a
// real number in 0-10. RATING_FLOOR (default 0) can additionally raise the
// minimum -- e.g. RATING_FLOOR=8 restores the old canon-import behavior for a
// source file that's 8-to-10 by construction -- but the type/NaN/range check
// itself is never optional. This check runs on `ratingSorted`, BEFORE the
// lock tie-repair pass below: the repair pass must only ever operate on data
// already proven valid, never on unvalidated rows (repairLockTies only
// reorders albums within tied-rating groups -- it never adds, drops, or
// changes an album's rating -- so checking before or after the repair pass
// inspects the exact same set of albums either way).
const invalid = ratingSorted.filter(
  (a) =>
    typeof a.rating !== 'number' ||
    !Number.isFinite(a.rating) ||
    a.rating < 0 ||
    a.rating > 10 ||
    a.rating < RATING_FLOOR
);
if (invalid.length > 0) {
  console.error(
    `\nABORT: ${invalid.length} album(s) have an invalid rating (must be a number in 0-10${
      RATING_FLOOR > 0 ? `, and >= the RATING_FLOOR of ${RATING_FLOOR}` : ''
    }):`
  );
  for (const a of invalid.slice(0, 10)) {
    console.error(`  - ${a.title} (${a.primary_artist_name}) = ${a.rating}`);
  }
  if (invalid.length > 10) console.error(`  ...and ${invalid.length - 10} more.`);
  console.error('Nothing was written. Fix the source data first.');
  process.exit(1);
}
console.log(
  `Rating check passed: all ${ratingSorted.length} albums are valid 0-10 ratings${
    RATING_FLOOR > 0 ? ` and >= ${RATING_FLOOR}` : ''
  }.`
);

// --- Lock-order tiebreak repair pass. Ratings alone fully determine order
//     whenever two albums differ; when the CSV rates two albums IDENTICALLY,
//     the rating data expresses no preference between them, so if both belong
//     to the same artist lock, the lock's relative order should win instead
//     of an arbitrary CSV-Ranking tiebreak. This is honoring a lock, not
//     modifying one -- locks are never edited or dropped.
//
//     A naive "sort by lock position" comparator is unsound here: a
//     comparator must be transitive, and lock membership is per-artist and
//     partial (unrelated albums have no lock relationship), so splicing a
//     partial order into the global comparator can produce inconsistent
//     results. Instead this is a separate post-pass that ONLY exchanges
//     albums holding the EXACT SAME rating, so the rating-descending order
//     established above is preserved exactly -- no album ever moves past one
//     with a different rating.
//
//     For each lock, collect the ascending indices its member albums occupy
//     in `ranked`, group those indices by the rating at that index (equal
//     ratings sort adjacently, but a third same-rating album not in this
//     lock could sit between two lock members -- grouping by rating rather
//     than assuming contiguous indices handles that correctly), and within
//     any group of 2+ indices, reassign the albums at those index slots so
//     they appear in the lock's specified relative order (order[0] = most
//     preferred = lowest/earliest index). Indices outside a tie group, and
//     all non-lock albums, are never touched.
//
//     This pass never runs silently: every album whose index actually moved
//     is reported below, naming the album, its rating, and the lock that
//     caused the move, so a clean run (no repairs needed) is visibly distinct
//     from a run that quietly absorbed a lock/rating conflict.
function repairLockTies(ranked, locks) {
  const result = [...ranked];
  const changes = [];
  for (const lock of locks) {
    const lockIndices = [];
    for (let i = 0; i < result.length; i++) {
      if (lock.order.includes(result[i].mbid)) lockIndices.push(i);
    }
    const indicesByRating = new Map();
    for (const i of lockIndices) {
      const rating = result[i].rating;
      if (!indicesByRating.has(rating)) indicesByRating.set(rating, []);
      indicesByRating.get(rating).push(i);
    }
    for (const indices of indicesByRating.values()) {
      if (indices.length < 2) continue;
      const albumsInLockOrder = indices
        .map((i) => result[i])
        .sort((a, b) => lock.order.indexOf(a.mbid) - lock.order.indexOf(b.mbid));
      indices.forEach((i, j) => {
        if (result[i].mbid !== albumsInLockOrder[j].mbid) {
          changes.push({ album: albumsInLockOrder[j], lockArtistMbid: lock.artistMbid });
        }
        result[i] = albumsInLockOrder[j];
      });
    }
  }

  if (changes.length > 0) {
    console.log(`\nLock tie repair: reordered ${changes.length} album(s) within tied ratings to honor artist locks:`);
    for (const { album, lockArtistMbid } of changes) {
      console.log(`  - ${album.title} (${album.rating}) [lock ${lockArtistMbid}]`);
    }
  } else {
    console.log('\nNo lock tie repairs needed.');
  }

  return result;
}

const newRanked = repairLockTies(ratingSorted, artistLocks);

// --- Artist-lock conflict detection. Runs AFTER the tie-repair pass above,
//     so any tie-only lock violations are already resolved by the time this
//     runs; what it reports now is a genuine rating-level disagreement (the
//     CSV rates the lock's albums DIFFERENTLY in a way that contradicts the
//     locked order), which is real signal and must NOT be auto-fixed. Locks
//     are NEVER modified or dropped by this script -- only reported. Mirrors
//     the relative-order semantics of web/src/ranking/locks.ts's
//     isValidOrder (locked albums no longer present in the new list are
//     simply skipped, not treated as violations), reimplemented standalone
//     since this script can't import a .ts file (same duplication
//     convention as isLpReleaseGroup).
function isValidOrder(ranked, locks) {
  const indexByMbid = new Map(ranked.map((a, i) => [a.mbid, i]));
  return locks.every((lock) => {
    const present = lock.order.filter((mbid) => indexByMbid.has(mbid));
    const sorted = [...present].sort((a, b) => indexByMbid.get(a) - indexByMbid.get(b));
    return JSON.stringify(present) === JSON.stringify(sorted);
  });
}

const currentByMbid = new Map(currentRanked.map((a) => [a.mbid, a]));
const conflictingLocks = artistLocks.filter((lock) => !isValidOrder(newRanked, [lock]));
if (conflictingLocks.length > 0) {
  console.log(`\n${conflictingLocks.length} of ${artistLocks.length} artist lock(s) would be contradicted by this import:`);
  for (const lock of conflictingLocks) {
    const titles = lock.order
      .map((mbid) => newRanked.find((a) => a.mbid === mbid)?.title ?? currentByMbid.get(mbid)?.title ?? mbid)
      .join(' -> ');
    console.log(`  - artist ${lock.artistMbid}: locked order: ${titles}`);
  }
  console.log('These locks are NOT being modified. Review after the import completes.');
} else {
  console.log(`\nNo artist lock conflicts detected across ${artistLocks.length} lock(s).`);
}

// --- Saved-list pruning. The API enforces that an album cannot be BOTH in
//     `ranked` AND in a saved list (web/api/ranking.ts's
//     `ranked_album_in_saved_list` check). The canon file can promote an
//     album that's currently sitting in wantToListen/notHeard/dontCare
//     straight into `ranked`, which would otherwise violate that invariant
//     and fail the write after this script's ~2.5 minutes of matching.
//     Keith's decision: the canon wins -- any saved-list album that now
//     appears in `newRanked` is removed from its saved list. This runs on
//     the FINAL `newRanked` (after sort, floor check, and lock-tie repair)
//     so the dry run reports exactly what the real run would do, and it
//     runs on `lists` -- the original snapshot's lists -- not on any
//     already-mutated copy, so the backup above (already written) stays the
//     true pre-import state while `prunedLists` below is what gets posted.
const newRankedIds = new Set(newRanked.map((a) => a.mbid));
const prunedLists = {
  wantToListen: lists.wantToListen.filter((a) => !newRankedIds.has(a.mbid)),
  notHeard: lists.notHeard.filter((a) => !newRankedIds.has(a.mbid)),
  dontCare: lists.dontCare.filter((a) => !newRankedIds.has(a.mbid)),
};

const newRankedByMbid = new Map(newRanked.map((a) => [a.mbid, a]));
const pruned = [];
for (const [listName, original] of Object.entries(lists)) {
  for (const album of original) {
    if (newRankedIds.has(album.mbid)) {
      pruned.push({ listName, album, rating: newRankedByMbid.get(album.mbid)?.rating });
    }
  }
}

if (pruned.length > 0) {
  console.log(`\nPruning ${pruned.length} album(s) from saved lists (they are now ranked by the canon):`);
  for (const { listName, album, rating } of pruned) {
    console.log(`  - ${album.title} (${album.primary_artist_name}) -- was in "${listName}", now ranked at ${rating}`);
  }
} else {
  console.log('\nNo saved-list albums collide with the ranked list.');
}

// Defensive re-check of the exact invariant the API enforces (validate() in
// web/api/ranking.ts): abort locally with a clear message rather than
// discovering a collision via a 400 after the write attempt.
const prunedSaved = [...prunedLists.wantToListen, ...prunedLists.notHeard, ...prunedLists.dontCare];
const stillColliding = prunedSaved.filter((a) => newRankedIds.has(a.mbid));
if (stillColliding.length > 0) {
  console.error(`\nABORT: ${stillColliding.length} pruned saved-list album(s) still collide with newRanked:`);
  for (const a of stillColliding.slice(0, 10)) {
    console.error(`  - ${a.title} (${a.primary_artist_name})`);
  }
  console.error('This should be impossible after pruning -- fix the pruning logic before writing.');
  process.exit(1);
}
console.log('Collision check passed: no saved-list album shares an mbid with the ranked list.');

// --- The actual write. Gated behind an explicit env var so this can never
//     fire by accident: everything above this line is read-only (matching,
//     backup, floor check, lock repair/conflict report, saved-list prune
//     report). Without the env var set, the script stops here having
//     written nothing to production. ---
if (process.env.CONFIRM_CANON_IMPORT !== 'yes') {
  console.log('\nDry run complete. Set CONFIRM_CANON_IMPORT=yes to actually write this to production.');
  client.close();
  process.exit(0);
}

const writeKey = process.env.ALBUM_CASE_WRITE_KEY;
if (!writeKey) {
  console.error('Missing ALBUM_CASE_WRITE_KEY.');
  process.exit(1);
}

const res = await fetch('https://album-case.vercel.app/api/ranking', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-album-case-write-key': writeKey },
  body: JSON.stringify({
    session_id: OWNER_ID,
    ranked: newRanked,
    lists: prunedLists,
    artist_locks: artistLocks,
    base_updated_at: baseUpdatedAt,
  }),
});

if (!res.ok) {
  // base_updated_at pins this write to the snapshot read at the START of the
  // script, before ~2.5 minutes of MusicBrainz matching, on purpose: if
  // Keith edited his ranking in the app during that window, the API's
  // optimistic-concurrency check (web/api/ranking.ts) rejects the write with
  // 409 { error: 'snapshot_conflict' } rather than silently clobbering his
  // change. That's the correct outcome, not a bug -- so give a specific,
  // actionable message for that case instead of a generic failure dump.
  if (res.status === 409) {
    console.error(
      '\nImport write rejected: the ranking changed in production since this script started ' +
        '(optimistic-concurrency conflict on base_updated_at). Nothing was overwritten. ' +
        'Re-run the script from scratch to pick up the latest snapshot and try again.',
    );
  } else {
    console.error(`\nImport write failed: ${res.status} ${await res.text()}`);
  }
  process.exit(1);
}

console.log(`\nImport complete. ${newRanked.length} albums now in the ranked list.`);
client.close();
