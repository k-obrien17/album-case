# Album Canon Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a 396-album CSV (Keith's existing 244 albums re-rated by ChatGPT, plus ~152 new ones) as the new baseline ranked list, with a mandatory backup and artist-lock conflict report.

**Architecture:** A single local Node script, `web/scripts/import-album-canon.mjs`, matching this project's established script conventions (env-loading, write-key gating, `OWNER_ID` duplication). No new API endpoint — the originally-planned `/api/match-album` (from the never-built `2026-07-11-bulk-album-list-import-design.md`) is skipped entirely; MusicBrainz matching happens inline in the script, the same way `web/api/discover-artist.ts` already does it, just via search instead of browse-by-artist.

**Tech Stack:** Node.js, `@libsql/client` (already a dependency) — no new dependencies.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-12-album-canon-import-design.md`.
- **Correction from the spec**, discovered during planning: the spec says "reuses `/api/match-album`... from the earlier bulk-list-import spec." That endpoint was never built (the earlier spec was approved but never implemented, and this rating-primary pivot superseded the need for it). This plan builds the MusicBrainz matching logic directly in the script instead — simpler, no new deployed surface, consistent with every other script this session.
- Input file: `~/Desktop/album-canon-8-to-10-rated-and-interspersed.csv` — already converted from the source `.xlsx` (confirmed columns: `Ranking,Album,Artist,Year,Rating`; 396 data rows; verified the top rows match the live production ranking exactly).
- Rating comes directly from the CSV's `Rating` column — no interpolation, no comparison walk. This is explicitly different from every other album-entry path in the app (drag-to-place, direct-rate) because a real, externally-sourced number already exists per row.
- MusicBrainz release-group search: `query=artist:"<artist>" AND releasegroup:"<title>"` (Lucene-escape embedded quotes in either value), filtered through a duplicated copy of `isLpReleaseGroup` (from `web/api/_lp.ts` — 2-line function, duplicated per this project's established script-boundary convention, not imported since scripts are plain `.mjs`).
- Confidence threshold, reused from the (unbuilt but still-valid) bulk-list-import spec's design: exactly one candidate with MusicBrainz `score` ≥ 90 auto-accepts; anything else (zero candidates, multiple candidates, low score) goes to a report file, not an interactive queue — this is a script, not the in-app UI.
- Rate limit: 1000ms between MusicBrainz calls, but only for rows that don't already match the owner's existing library by normalized artist+title — roughly 244 of the 396 rows should resolve locally with zero network cost, leaving ~152 real MusicBrainz calls (~2.5 minutes), not 396 (~7 minutes).
- **Mandatory backup before any write** — full current ranking snapshot to a timestamped local file. Non-negotiable per the spec; no task in this plan skips it.
- **Artist-lock conflicts are reported, never auto-resolved** — 14 locks currently live in production (per this session's own verification). The script must not modify or drop any lock.
- Albums currently in `ranked` that don't appear anywhere in the 396-row file are left completely untouched — same rating, same relative position (their exact index may shift as other ratings around them change, but their own rating is never touched by this script).
- The actual production write (Task 5) is a distinct, explicitly-gated step — do not fold it into an earlier task's verification. Given the scale (a full-list replace of Keith's real personal ranking), this plan is written so the write is the very last thing that happens, only after every prior task's output has been inspected.

---

### Task 1: CSV parsing + pure decision logic

**Files:**
- Create: `web/scripts/lib/canon-import.mjs` (pure logic, no network/DB — kept separate from the orchestration script so it's easily testable)
- Create: `web/scripts/lib/canon-import.test.mjs`

**Interfaces:**
- Produces: `parseCanonCsv(csvText: string): CanonRow[]` where `CanonRow = { ranking: number, album: string, artist: string, year: number, rating: number }`; `isLpReleaseGroup(group): boolean` (duplicated from `_lp.ts`); `isConfidentMatch(candidates: {score: number}[]): boolean` (exactly one candidate, score ≥ 90).

This project's existing test convention (Vitest, colocated `.test.ts`) doesn't cover plain `.mjs` scripts — check whether `vitest` can run a `.test.mjs` file as-is (it should, Vitest handles `.mjs` natively) before assuming; if not, name these files `.test.js` instead and confirm `package.json`'s `type: "module"` still makes them ESM. Verify this concretely in Step 1 rather than assuming.

- [ ] **Step 1: Confirm Vitest can run a `.test.mjs` file in this project**

```bash
cd web
mkdir -p scripts/lib
cat > scripts/lib/canon-import.test.mjs << 'EOF'
import { describe, it, expect } from 'vitest';
describe('smoke', () => {
  it('runs', () => { expect(1).toBe(1); });
});
EOF
npx vitest run scripts/lib/canon-import.test.mjs
```

Expected: PASS. If Vitest doesn't pick up `.mjs` test files, rename to `.test.js` and re-run before continuing — do not proceed with a test file format that doesn't actually execute.

- [ ] **Step 2: Write the failing tests**

Replace the smoke test in `web/scripts/lib/canon-import.test.mjs` (or `.test.js`, per Step 1's finding) with:

```js
import { describe, it, expect } from 'vitest';
import { parseCanonCsv, isLpReleaseGroup, isConfidentMatch } from './canon-import.mjs';

describe('parseCanonCsv', () => {
  it('parses the header and rows into typed objects', () => {
    const csv = 'Ranking,Album,Artist,Year,Rating\n1,OK Computer,Radiohead,1997,10\n2,154,Wire,1979,9.99\n';
    const rows = parseCanonCsv(csv);
    expect(rows).toEqual([
      { ranking: 1, album: 'OK Computer', artist: 'Radiohead', year: 1997, rating: 10 },
      { ranking: 2, album: '154', artist: 'Wire', year: 1979, rating: 9.99 },
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    const csv = 'Ranking,Album,Artist,Year,Rating\n1,"Track, Track","Artist, Inc.",2000,8\n';
    const rows = parseCanonCsv(csv);
    expect(rows).toEqual([{ ranking: 1, album: 'Track, Track', artist: 'Artist, Inc.', year: 2000, rating: 8 }]);
  });

  it('returns an empty array for a header-only CSV', () => {
    expect(parseCanonCsv('Ranking,Album,Artist,Year,Rating\n')).toEqual([]);
  });
});

describe('isLpReleaseGroup', () => {
  it('accepts primary-type Album with no secondary types', () => {
    expect(isLpReleaseGroup({ 'primary-type': 'Album' })).toBe(true);
  });
  it('rejects a Compilation', () => {
    expect(isLpReleaseGroup({ 'primary-type': 'Album', 'secondary-types': ['Compilation'] })).toBe(false);
  });
  it('rejects a non-Album primary type', () => {
    expect(isLpReleaseGroup({ 'primary-type': 'EP' })).toBe(false);
  });
});

describe('isConfidentMatch', () => {
  it('accepts exactly one candidate scoring 90 or above', () => {
    expect(isConfidentMatch([{ score: 100 }])).toBe(true);
    expect(isConfidentMatch([{ score: 90 }])).toBe(true);
  });
  it('rejects a single low-scoring candidate', () => {
    expect(isConfidentMatch([{ score: 89 }])).toBe(false);
  });
  it('rejects zero candidates', () => {
    expect(isConfidentMatch([])).toBe(false);
  });
  it('rejects multiple candidates even if one scores high', () => {
    expect(isConfidentMatch([{ score: 100 }, { score: 50 }])).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run scripts/lib/canon-import.test.mjs
```

Expected: FAIL — `canon-import.mjs` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `web/scripts/lib/canon-import.mjs`:

```js
/**
 * Pure logic for the album-canon import script (web/scripts/import-album-canon.mjs).
 * No network, no filesystem, no Turso -- kept separate so it's directly testable.
 */

/** Minimal CSV parser for this file's fixed shape: Ranking,Album,Artist,Year,Rating.
 *  Handles double-quoted fields containing commas (RFC 4180 subset -- no escaped
 *  quotes inside quoted fields, since this specific source file doesn't have any). */
export function parseCanonCsv(csvText) {
  const lines = csvText.split('\n').filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines; // skip header
  return dataLines.map((line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    const [ranking, album, artist, year, rating] = fields;
    return {
      ranking: Number(ranking),
      album,
      artist,
      year: Number(year),
      rating: Number(rating),
    };
  });
}

// Matches web/api/_lp.ts's isLpReleaseGroup. Duplicated, not imported: this is
// a plain Node ESM script with no TS loader, so it can't import a .ts file.
export function isLpReleaseGroup(group) {
  return group['primary-type'] === 'Album' && (group['secondary-types']?.length ?? 0) === 0;
}

/** Confident match = exactly one candidate at MusicBrainz score >= 90.
 *  Matches the confidence rule from the (unbuilt) bulk-list-import spec. */
export function isConfidentMatch(candidates) {
  return candidates.length === 1 && candidates[0].score >= 90;
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npx vitest run scripts/lib/canon-import.test.mjs
```

Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add web/scripts/lib/canon-import.mjs web/scripts/lib/canon-import.test.mjs
git commit -m "feat(scripts): add CSV parsing and matching logic for the canon import"
```

---

### Task 2: Local-library matching + backup, then MusicBrainz only for genuine misses

**Files:**
- Create: `web/scripts/import-album-canon.mjs` (orchestration script)

**Interfaces:**
- Consumes: `parseCanonCsv`, `isLpReleaseGroup`, `isConfidentMatch` (Task 1).
- Produces: a working script that fetches the current ranking snapshot, backs it up, matches every CSV row against the owner's OWN existing library first (zero network cost), and only hits MusicBrainz for rows that don't match anything already known — writing a report for inspection. Still no write to production (that's Task 5).

**Corrected from the original plan draft during execution**: matching every row against MusicBrainz regardless of whether it's already in the owner's library would waste ~244 unnecessary network calls (out of 396 rows, roughly 244 are albums Album Case already has a real, verified `mbid` for) and — worse — risks a fresh search resolving to a *different* release-group edition than the one already in the owner's actual data. Fetching the current snapshot first and matching locally by normalized artist+title avoids both problems: existing albums get their already-correct `mbid` reused directly, and only the ~152 genuinely new albums need a live MusicBrainz lookup. This cuts expected runtime from ~7 minutes to roughly ~2.5 minutes and improves match fidelity for the majority of rows.

- [ ] **Step 1: Write the script**

Create `web/scripts/import-album-canon.mjs`:

```js
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
```

Note: this task's file already includes what was originally planned as Task 3's content (the backup fetch and replace-list construction) — moving the snapshot fetch earlier was required to build the local-match index before the matching loop runs, so it made sense to fold backup + replace-list construction into this same task rather than artificially split them. Task 3 (next) is now just verification of this combined script's output, not new code.

- [ ] **Step 2: Run it for real against the actual 396-row file**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
node --env-file=web/.env.local web/scripts/import-album-canon.mjs
```

Expected: local hits should account for roughly 244 of the 396 rows (however many of the CSV's artist/title pairs match the current library's normalized artist+title exactly — some may not match due to minor formatting differences and will correctly fall through to a live MusicBrainz search instead, which is fine, just slower for those specific rows). Total runtime should be well under the original ~7 minute estimate. Prints the backup path, the local/MusicBrainz split, confident/needs-review counts, and the final replace-list summary.

- [ ] **Step 3: Inspect the report**

```bash
node -e "
const r = JSON.parse(require('fs').readFileSync('web/scripts/canon-import-report.json'));
console.log('confident:', r.confident.length, '| needs review:', r.needsReview.length);
console.log('first 3 confident:', r.confident.slice(0,3).map(c => c.title + ' - ' + c.primary_artist_name));
console.log('first 5 needing review:', r.needsReview.slice(0,5).map(n => n.row.album + ' / ' + n.row.artist));
"
```

Expected: the vast majority of the 244 already-known albums should confidently match (mostly via the local index); the ~152 new ones will mostly match too via live MusicBrainz search, with some genuinely ambiguous or hard-to-find titles landing in `needsReview`. There is no fixed pass/fail threshold here — this step is about eyeballing the report for anything systematically wrong (e.g., if the local-hit count is near zero when it should be near 244, something is broken in the normalization/matching, not just normal ambiguity).

- [ ] **Step 4: Verify the backup file is real and complete**

```bash
node -e "
const b = JSON.parse(require('fs').readFileSync(require('fs').readdirSync('web/scripts/backups').map(f => 'web/scripts/backups/'+f).sort().pop()));
console.log('backed-up album count:', b.ranked.length);
console.log('first album:', b.ranked[0].title, b.ranked[0].rating);
"
```

Expected: 244 (the current real count), first album matching what you already know is rank #1 in production.

- [ ] **Step 5: Add the scratch artifacts to `.gitignore`**

```bash
cat >> web/.gitignore << 'EOF'

# canon import scratch artifacts (personal ranking data — never commit)
scripts/canon-import-report.json
scripts/backups/
EOF
```

- [ ] **Step 6: Commit**

```bash
git add web/scripts/import-album-canon.mjs web/.gitignore
git commit -m "feat(scripts): add canon import matching (local-library-first) with mandatory backup"
```

---

### Task 3: Sanity-check the replace-list arithmetic (verification only, no new code expected)

**Files:** none expected — this task is a check, not new functionality. If it finds a real problem, fix it in `web/scripts/import-album-canon.mjs` and note the fix; otherwise there's nothing to commit.

**Interfaces:** none new.

- [ ] **Step 1: Confirm the replace-list totals are internally consistent**

Using Task 2's own printed output (no need to re-run the ~2-3 minute script again just for this — reuse the numbers already printed, or re-run only if you have a specific reason to distrust them):

- `updatedOrNew.length` should equal `confident.length` from the same run.
- `untouched.length` should equal `244 - (number of confident matches whose mbid was already in the current 244-album library)` — i.e., roughly `244 - localHits` if every local hit's mbid made it into `confident` (it should have, by construction).
- `newRanked.length` should equal `updatedOrNew.length + untouched.length`, and should be in the range `[244, 396]` — it can never be less than the original 244 (nothing is deleted) and can never exceed 396 (the file's own row count) plus whatever was already untouched beyond the file's scope (there shouldn't be any, since the file's ~244 known albums should cover the full existing library — if `untouched.length` is unexpectedly large, that's a sign some existing albums aren't being recognized as "already in the file" and would be worth investigating before proceeding).

If any of these don't hold, do not proceed to Task 4 — fix `import-album-canon.mjs`'s replace-list logic first, re-verify, and only then continue.

- [ ] **Step 2: Spot-check a handful of specific albums by hand**

Pick 3 albums you know are in both the current library and the CSV file (e.g. the top 3 by rank), and confirm each one's entry in `confident` has the correct, familiar `mbid` (matching what you already know from earlier session verification) — not a fresh, possibly-different MusicBrainz release-group id for the same album.

- [ ] **Step 3: If everything checks out, no commit needed for this task. If a fix was required, commit it:**

```bash
git add web/scripts/import-album-canon.mjs
git commit -m "fix(scripts): correct replace-list construction in the canon import"
```

---

### Task 4: Artist-lock conflict detection (still no write)

**Files:**
- Modify: `web/scripts/import-album-canon.mjs`

**Interfaces:** none new.

- [ ] **Step 1: Add the lock-conflict check**

Append (this needs `newRanked` and `artistLocks`, both already in scope from Task 2's snapshot fetch and replace-list construction):

```js
function isValidOrder(ranked, locks) {
  const indexByMbid = new Map(ranked.map((a, i) => [a.mbid, i]));
  return locks.every((lock) => {
    const present = lock.order.filter((mbid) => indexByMbid.has(mbid));
    const sorted = [...present].sort((a, b) => indexByMbid.get(a) - indexByMbid.get(b));
    return JSON.stringify(present) === JSON.stringify(sorted);
  });
}

const conflictingLocks = artistLocks.filter((lock) => !isValidOrder(newRanked, [lock]));
if (conflictingLocks.length > 0) {
  console.log(`\n${conflictingLocks.length} artist lock(s) would be contradicted by this import:`);
  for (const lock of conflictingLocks) {
    const titles = lock.order
      .map((mbid) => newRanked.find((a) => a.mbid === mbid)?.title ?? currentByMbid.get(mbid)?.title ?? mbid)
      .join(' -> ');
    console.log(`  - locked order: ${titles}`);
  }
  console.log('These locks are NOT being modified. Review after the import completes.');
} else {
  console.log('\nNo artist lock conflicts detected.');
}
```

This mirrors the logic in `web/src/ranking/locks.ts`'s `isValidOrder` (relative-order check against whatever albums from the lock are actually present in the new arrangement) but reimplemented standalone since this script can't import a `.ts` file — same duplication convention as `isLpReleaseGroup`.

- [ ] **Step 2: Run and inspect**

```bash
node web/scripts/import-album-canon.mjs
```

Expected: prints either "No artist lock conflicts detected" or a list of specific conflicting locks with the albums involved. Given this session's own earlier finding that 14 real locks exist and a wholesale AI re-rating has "zero awareness" of them, expect to see at least some conflicts reported — that's expected, not a bug, per the spec's explicit design (report, don't touch).

- [ ] **Step 3: Commit**

```bash
git add web/scripts/import-album-canon.mjs
git commit -m "feat(scripts): report artist-lock conflicts without modifying them"
```

---

### Task 5: The actual write — explicitly gated, last step

**Files:**
- Modify: `web/scripts/import-album-canon.mjs`

**Interfaces:** none new.

**This step is not to be run automatically as part of implementing this task.** Build and commit the write logic, verify it compiles/runs its non-destructive parts, but the actual execution against production requires a fresh, explicit go-ahead in the moment — this is the single most consequential write this project has made (a full-list replace of Keith's real personal ranking, ~396 albums).

- [ ] **Step 1: Add the write, gated behind an explicit env var so it can't fire by accident**

Append:

```js
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
    lists,
    artist_locks: artistLocks,
    base_updated_at: baseUpdatedAt,
  }),
});

if (!res.ok) {
  console.error(`Import write failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`\nImport complete. ${newRanked.length} albums now in the ranked list.`);
client.close();
```

- [ ] **Step 2: Verify the dry-run path (default behavior, no env var set)**

```bash
node --env-file=web/.env.local web/scripts/import-album-canon.mjs
```

Expected: runs the full matching/backup/conflict-check pipeline, ends with "Dry run complete. Set CONFIRM_CANON_IMPORT=yes to actually write this to production." — confirms no write happens by default.

- [ ] **Step 3: Commit**

```bash
git add web/scripts/import-album-canon.mjs
git commit -m "feat(scripts): add the gated production write for the canon import"
```

- [ ] **Step 4: STOP. Do not run the real import as part of this task.**

Report the dry-run results (confident/needs-review counts, lock conflicts, backup path) back to Keith. The actual command to run when he explicitly confirms:

```bash
CONFIRM_CANON_IMPORT=yes node --env-file=web/.env.local web/scripts/import-album-canon.mjs
```

This is a controller-level decision, not something any task in this plan executes on its own.
