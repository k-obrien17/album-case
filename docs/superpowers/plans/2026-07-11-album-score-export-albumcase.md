# Album Score Export (Album Case half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `web/scripts/export-collect-albums.mjs`, a read-only script that derives a 1-10 score from each album's rank position and writes the top N to `keithrobrien.com`'s `content/collect/albums.json`.

**Architecture:** A single Node ESM script (no build step, no TS, matching `media-library/scripts/export-collect-watching.mjs`'s pattern exactly). Queries Turso directly via `@libsql/client` (already a dependency, no new packages). No changes to any existing app file, API route, or schema.

**Tech Stack:** Node.js (24.x locally; `.mjs` + `--env-file` requires 20.6+), `@libsql/client`.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-11-album-score-export-design.md` (see its "Correction" note at the top — the target is `albums.json`, not `music.json`).
- No new dependencies. No changes to `web/src/`, `web/api/`, or the Turso schema.
- Score formula: `score(rank, total) = Math.round((1 + 9 * (total - rank) / (total - 1)) * 100) / 100` — 2 decimal places, not 1.
- Owner session id is the fixed constant from `web/src/owner.ts`: `c0ffee00-0000-4000-8000-000000000001`. The script can't `import` that `.ts` file directly (plain Node ESM, no TS loader), so it's duplicated as a literal with a comment pointing back to the source of truth — this is intentional, not an oversight.
- Default `TOP_N` = 10, overridable via env var. Default output path is the sibling `../../keithrobrien/content/collect/albums.json`, overridable via `COLLECT_OUT`.
- No test file — matches this project's own convention (tests only when asked) and `media-library/scripts`' own precedent (no tests on its equivalent script). Verification in this plan is manual: run the script, inspect real output.
- `web/.env.local`'s `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are currently empty placeholders in this checkout (verified: `TURSO_AUTH_TOKEN=""`). Task 1 includes refreshing them via `vercel env pull` before any real run — `.env.local` is gitignored (`web/.gitignore:29`), so this is safe.

---

### Task 1: Score formula + Turso fetch, verified against real data

**Files:**
- Create: `web/scripts/export-collect-albums.mjs`

**Interfaces:**
- Produces: a `score(rank, total)` function and a working Turso read of the owner's `ranked` array, printed to console for manual inspection (no file write yet — that's Task 2).

- [ ] **Step 1: Refresh real Turso credentials into `.env.local`**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case/web
vercel env pull .env.local --environment=production --yes
```

Expected: command reports environment variables written. Confirm without printing secret values:

```bash
node --env-file=.env.local -e "console.log('TURSO_DATABASE_URL set:', !!process.env.TURSO_DATABASE_URL); console.log('TURSO_AUTH_TOKEN set:', !!process.env.TURSO_AUTH_TOKEN);"
```

Expected: both print `true`.

- [ ] **Step 2: Create the script with the score formula and a raw Turso read**

Create `web/scripts/export-collect-albums.mjs`:

```js
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
```

- [ ] **Step 3: Run it against real data**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
node --env-file=web/.env.local web/scripts/export-collect-albums.mjs
```

Expected: prints "Fetched 244 ranked albums" (or however many currently exist), the first 3 titles, and `Score for rank 1 of N: 10` plus a rank-10 score less than 10 and greater than 1.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/export-collect-albums.mjs
git commit -m "feat(export): add score formula and Turso read for album export script"
```

---

### Task 2: Build the export payload and write the file

**Files:**
- Modify: `web/scripts/export-collect-albums.mjs`

**Interfaces:**
- Consumes: `score(rank, total)` and the `ranked` array from Task 1.
- Produces: a written JSON file at `COLLECT_OUT` (default `../../keithrobrien/content/collect/albums.json`) shaped `{ generated_at, source, note, top_albums }`.

- [ ] **Step 1: Replace the console-only tail with payload assembly and a file write**

Replace everything from `const ranked = JSON.parse(...)` onward in `web/scripts/export-collect-albums.mjs` with:

```js
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ranked = JSON.parse(String(row.ranking_json));

// This script lives at web/scripts/, one level deeper than media-library's
// scripts/ — hence three '..' segments, not two, to reach the Projects/
// sibling (verified: resolve(HERE, '..','..','..', 'keithrobrien', ...)).
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT =
  process.env.COLLECT_OUT ||
  resolve(HERE, '..', '..', '..', 'keithrobrien', 'content', 'collect', 'albums.json');

if (!existsSync(dirname(OUT))) {
  console.error(`Output directory does not exist: ${dirname(OUT)}. Set COLLECT_OUT to a valid path.`);
  process.exit(1);
}

const top = ranked.slice(0, TOP_N).map((album, index) => ({
  title: album.title,
  artist: album.primary_artist_name,
  year: album.release_year,
  score: score(index + 1, ranked.length),
  type: 'album',
  mb_url: `https://musicbrainz.org/release-group/${album.mbid}`,
}));

const payload = {
  generated_at: new Date().toISOString().slice(0, 10),
  source: 'album-case',
  note: 'Generated by album-case/web/scripts/export-collect-albums.mjs. Do not hand-edit.',
  top_albums: top,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${top.length} albums to ${OUT}`);

client.close();
```

Note: `index + 1` is the album's rank (1-based) since `ranked` is already in exact order, index 0 = best.

- [ ] **Step 2: Run it for real and inspect the output file**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
node --env-file=web/.env.local web/scripts/export-collect-albums.mjs
cat ../keithrobrien/content/collect/albums.json
```

Expected: `Wrote 10 albums to .../keithrobrien/content/collect/albums.json`, followed by JSON with `top_albums` containing 10 entries, first entry's `score` is `10`, scores strictly decreasing, each `mb_url` a valid-looking MusicBrainz URL.

- [ ] **Step 3: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/scripts/export-collect-albums.mjs
git commit -m "feat(export): write top-N album payload to keithrobrien's collect JSON"
```

(The generated `albums.json` itself is committed separately, in the `keithrobrien` repo, as the last step of that repo's own plan — this commit is Album Case's script only.)

---

### Task 3: Error handling for the two real failure modes

**Files:**
- Modify: `web/scripts/export-collect-albums.mjs`

**Interfaces:**
- No new exports — this hardens existing behavior already exercised in Tasks 1-2.

- [ ] **Step 1: Verify the missing-env-vars guard (already written in Task 1's `db()`)**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
TURSO_DATABASE_URL= TURSO_AUTH_TOKEN= node web/scripts/export-collect-albums.mjs
```

Expected: stderr prints `Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN...`, exit code non-zero, no file written or overwritten.

- [ ] **Step 2: Verify the missing-output-directory guard (already written in Task 2)**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
COLLECT_OUT=/tmp/nonexistent-dir-xyz/albums.json node --env-file=web/.env.local web/scripts/export-collect-albums.mjs
```

Expected: stderr prints `Output directory does not exist: /tmp/nonexistent-dir-xyz. Set COLLECT_OUT to a valid path.`, exit code non-zero.

- [ ] **Step 3: No code changes needed if both checks pass as written — if either doesn't fail as expected, fix the guard in `export-collect-albums.mjs` and re-run this task's steps 1-2 until both do.**

- [ ] **Step 4: Commit only if a fix was needed**

```bash
git add web/scripts/export-collect-albums.mjs
git commit -m "fix(export): harden error handling for missing env/output-dir"
```

---

### Task 4: Final end-to-end run

**Files:** none (verification only)

- [ ] **Step 1: Run the script one more time from a clean state**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
node --env-file=web/.env.local web/scripts/export-collect-albums.mjs
```

Expected: succeeds, `../keithrobrien/content/collect/albums.json` now holds real data.

- [ ] **Step 2: Spot-check the top 3 entries against the app's own ranking**

```bash
curl -s "https://album-case.vercel.app/api/ranking?session_id=c0ffee00-0000-4000-8000-000000000001" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  console.log(j.snapshot.ranked.slice(0,3).map(a=>a.title));
});
"
```

Expected: these 3 titles match, in the same order, the first 3 entries in `content/collect/albums.json`'s `top_albums`.

- [ ] **Step 3: Leave the `keithrobrien` repo's generated file uncommitted here — that commit belongs to the `keithrobrien` plan's own final task, not this one.**
