# Album Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make album search fast and complete by serving it from a self-hosted, full-text-indexed copy of MusicBrainz's album catalog in Turso, with live MusicBrainz as the fallback, a weekly job for new releases, and a "Search everywhere" escape hatch.

**Architecture:** The existing offline `pipeline/` is extended to keep Albums and EPs with no secondary types, then a load script copies its output into a new Turso table `catalog_albums` plus an FTS5 index kept in sync by triggers. `/api/search-album` queries the catalog first and only calls MusicBrainz when the catalog returns fewer than 5 results (or when `live=1`). A Vercel Cron route adds recent releases by already-cataloged artists weekly.

**Tech Stack:** Python 3 stdlib + SQLite (pipeline), TypeScript on Vercel serverless (`@vercel/node`), Turso/libSQL (`@libsql/client`, FTS5), Vite + plain DOM client, vitest, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-09-24-album-catalog-design.md`

## Global Constraints

- Album identity stays the MusicBrainz release-group MBID. Nothing about how albums are keyed changes.
- Album rule everywhere: primary type Album or EP, and no secondary types (excludes Live, Compilation, Soundtrack, Remix, etc.).
- Popularity floor for the bulk catalog: `NOTABILITY_MIN_LISTENERS = 50` (`pipeline/config.py`), unchanged.
- `/api/search-album` response shape stays `{ albums: DiscoveredAlbum[] }`, max 10. New optional `live=1` param only.
- Catalog-first threshold: 5 results. At 5 or more catalog hits, MusicBrainz is not called.
- Never read-modify or write `ranking_snapshots`, `atoms`, `sessions`, or `discovered_albums`.
- `web/scripts/load-catalog.mjs` is dry-run by default; writing needs an explicit `--write` flag.
- `vercel env pull`, any production Turso write, adding `CRON_SECRET`, and `vercel deploy --prod --yes` each wait for Keith's explicit approval at the time. Stop and ask; do not batch these approvals.
- MusicBrainz etiquette: User-Agent `AlbumCase/0.1 (keith@totalemphasis.com)`, no more than 1 request per second.
- No new runtime dependencies. pytest is installed in a venv outside the repo as a dev tool only.
- DOM changes use safe construction (`createElement`/`textContent`), never `innerHTML`.
- The ~7GB dump is streamed through extraction; the tarball is never written to disk.

## Plan decisions beyond the spec

- **FTS sync via triggers, not a post-load rebuild.** The spec says the load script "rebuilds the FTS index". Triggers on `catalog_albums` keep `catalog_albums_fts` in sync for both the bulk load and the weekly job, so no rebuild step exists. Same end state, one mechanism.
- **Catalog query timeout is 1.5s, not the shared 8s.** `withDbTimeout` gains an optional `ms` argument. An 8s wait on a slow catalog would make search worse than today, which the spec rules out.
- **Diacritic-insensitive tokenizer** (`unicode61 remove_diacritics 2`) so "bjork" finds "Björk". Verified locally that libSQL's FTS5 supports it.
- **`release_type` column on the pipeline's `entities` table** carries Album/EP from the pipeline to the load script.

## Review Focus

- Queries containing FTS syntax (double quotes, parentheses, hyphens, apostrophes, the words AND/OR/NOT) must never error; they search as plain words. Pinned in Task 2 (`toFtsQuery` + real FTS query tests).
- Accent and case differences ("bjork" vs "Björk", "RADIOHEAD" vs "Radiohead") find the same album. Pinned in Task 2.
- Catalog missing, empty, or unreachable: search behaves exactly like today (MusicBrainz results). Pinned in Task 3 (dropped-table test).
- Punctuation-only or emoji-only queries (e.g. "!!!"): skip the catalog, still reach MusicBrainz, never a 500. Pinned in Task 3.
- Weekly job hitting a MusicBrainz error mid-run: keeps what it already fetched, reports `partial: true`, and never lowers or rewrites an existing album's popularity. Pinned in Task 5.

---

### Task 1: Pipeline keeps Albums and EPs with no secondary types

**Files:**
- Modify: `pipeline/staging.sql`
- Modify: `pipeline/ingest_musicbrainz.py`
- Modify: `pipeline/materialize.py`
- Modify: `pipeline/schema.sql`
- Modify: `pipeline/db.py`
- Create: `pipeline/fixtures/mb_release_group_secondary_type_join.sample.tsv`
- Test: `pipeline/test_ingest.py`, `pipeline/test_materialize.py`, `pipeline/test_schema.py`

**Interfaces:**
- Produces: `entities` rows (`entity_type = 'album'`) with a new `release_type TEXT` column holding `'Album'` or `'EP'`. Consumed by Task 6's `readPipelineAlbums`.
- Produces: constants `EP_PRIMARY_TYPE_ID` (materialize.py), `RGST_COL_RELEASE_GROUP`, `RGST_EXPECTED_COLS` (ingest_musicbrainz.py).

- [ ] **Step 1: Set up pytest outside the repo and confirm the baseline**

```bash
python3 -m venv ~/.venvs/album-case && ~/.venvs/album-case/bin/pip install -q pytest
~/.venvs/album-case/bin/python -m pytest pipeline -q
```
Expected: all existing pipeline tests pass (40 at last count).

- [ ] **Step 2: Verify the MusicBrainz constants against the live schema**

```bash
curl -s https://raw.githubusercontent.com/metabrainz/musicbrainz-server/master/admin/sql/CreateTables.sql | grep -A6 "CREATE TABLE release_group_secondary_type_join"
curl -s https://raw.githubusercontent.com/metabrainz/musicbrainz-server/master/admin/sql/InsertDefaultRows.sql | grep -i -A10 "release_group_primary_type"
```
Expected: `release_group_secondary_type_join` has 3 columns in the order `release_group, secondary_type, created`, and `release_group_primary_type` has Album = 1, EP = 3. If either differs, use the live values in Steps 4 and 6 and record the difference in the commit message.

- [ ] **Step 3: Write the failing tests**

Create `pipeline/fixtures/mb_release_group_secondary_type_join.sample.tsv` (tab-separated; release group 9999 is deliberately not in the other fixtures, so existing tests are unaffected):

```
9999	1	2020-01-01 00:00:00+00
malformed-too-few-fields
```

In `pipeline/test_ingest.py`, add to the `MB_FIXTURE_FILENAMES` dict:

```python
    "release_group_secondary_type_join": "mb_release_group_secondary_type_join.sample.tsv",
```

and append:

```python
def test_secondary_type_join_loads_release_group_ids_and_skips_malformed(conn):
    stats = _load_mb_fixtures(conn)
    assert stats["release_group_secondary_type_join"] == {"loaded": 1, "skipped": 1}
    rows = conn.execute("SELECT rg_id FROM stg_release_group_secondary_type").fetchall()
    assert [r["rg_id"] for r in rows] == [9999]


def test_secondary_type_join_pinned_column_count_matches_fixture():
    from pipeline.ingest_musicbrainz import RGST_COL_RELEASE_GROUP, RGST_EXPECTED_COLS

    line = (FIXTURES_DIR / "mb_release_group_secondary_type_join.sample.tsv").read_text().splitlines()[0]
    fields = line.split("\t")
    assert len(fields) == RGST_EXPECTED_COLS
    assert fields[RGST_COL_RELEASE_GROUP] == "9999"
```

In `pipeline/test_materialize.py`, add the same `MB_FIXTURE_FILENAMES` entry, change the import line to

```python
from pipeline.materialize import (
    ALBUM_PRIMARY_TYPE_ID,
    EP_PRIMARY_TYPE_ID,
    materialize_albums,
    verify_universe,
)
```

and append:

```python
def _insert_release_group(conn, rg_id, mbid, title, primary_type, listeners=5000):
    conn.execute(
        "INSERT INTO stg_release_group (rg_id, mbid, title, artist_credit, primary_type) "
        "VALUES (?, ?, ?, 100, ?)",
        (rg_id, mbid, title, primary_type),
    )
    conn.execute(
        "INSERT INTO stg_popularity (release_group_mbid, listen_count, listener_count) "
        "VALUES (?, ?, ?)",
        (mbid, listeners * 5, listeners),
    )


def test_ep_with_no_secondary_type_materializes_as_ep(conn):
    ep_mbid = "22222222-2222-2222-2222-222222222222"
    with conn:
        _insert_release_group(conn, 9100, ep_mbid, "An EP", EP_PRIMARY_TYPE_ID)

    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    assert _album_row(conn, ep_mbid)["release_type"] == "EP"
    assert _album_row(conn, OK_COMPUTER_MBID)["release_type"] == "Album"


def test_album_with_a_secondary_type_is_excluded(conn):
    live_mbid = "33333333-3333-3333-3333-333333333333"
    with conn:
        _insert_release_group(conn, 9200, live_mbid, "Live at Somewhere", ALBUM_PRIMARY_TYPE_ID)
        conn.execute("INSERT INTO stg_release_group_secondary_type (rg_id) VALUES (9200)")

    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    assert _album_row(conn, live_mbid) is None
    assert _album_row(conn, OK_COMPUTER_MBID) is not None


def test_candidate_total_ignores_secondary_typed_and_single_release_groups(conn):
    with conn:
        _insert_release_group(conn, 9300, "44444444-4444-4444-4444-444444444444", "A Single", 2)
        _insert_release_group(conn, 9301, "55555555-5555-5555-5555-555555555555", "Live Album", ALBUM_PRIMARY_TYPE_ID)
        conn.execute("INSERT INTO stg_release_group_secondary_type (rg_id) VALUES (9301)")

    with patch("pipeline.materialize.now_ms", return_value=1_000):
        stats = materialize_albums(conn)

    assert stats["total"] == 2  # OK Computer + the VA fixture, unchanged baseline
```

In `pipeline/test_schema.py`, append:

```python
def test_init_db_adds_release_type_to_an_existing_entities_table(tmp_path):
    from pipeline.db import connect, init_db

    conn = connect(tmp_path / "old.db")
    conn.execute(
        "CREATE TABLE entities (entity_type TEXT NOT NULL, mbid TEXT NOT NULL, "
        "title TEXT NOT NULL, primary_artist_name TEXT, primary_artist_mbid TEXT, "
        "release_year INTEGER, cover_url TEXT, notability_score INTEGER, "
        "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, "
        "PRIMARY KEY (entity_type, mbid))"
    )
    init_db(conn)
    init_db(conn)  # second call must not fail on the now-present column
    columns = {row[1] for row in conn.execute("PRAGMA table_info(entities)")}
    assert "release_type" in columns
    conn.close()
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `~/.venvs/album-case/bin/python -m pytest pipeline -q`
Expected: FAIL. `KeyError: 'release_group_secondary_type_join'` / `ImportError` for `EP_PRIMARY_TYPE_ID` and `RGST_*`, and the schema test fails on the missing `release_type` column.

- [ ] **Step 5: Add the staging table**

Append to `pipeline/staging.sql`:

```sql
-- One row per (release group, secondary type) pair. Only rg_id is kept:
-- the pipeline just needs to know a release group has ANY secondary type
-- (Live, Compilation, Soundtrack, ...), which excludes it from the catalog.
CREATE TABLE IF NOT EXISTS stg_release_group_secondary_type (
    rg_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stg_release_group_secondary_type_rg_id
    ON stg_release_group_secondary_type(rg_id);
```

- [ ] **Step 6: Load the secondary-type table in the ingest**

In `pipeline/ingest_musicbrainz.py`, after the `--- artist ---` constants block add:

```python
# --- release_group_secondary_type_join ---
# release_group, secondary_type, created
RGST_COL_RELEASE_GROUP = 0
RGST_EXPECTED_COLS = 3
```

Add to `DEFAULT_TABLE_FILENAMES`:

```python
    "release_group_secondary_type_join": "release_group_secondary_type_join",
```

After `_load_artist`, add:

```python
def _load_release_group_secondary_type_join(conn, path):
    insert_sql = "INSERT INTO stg_release_group_secondary_type (rg_id) VALUES (?)"
    loaded = skipped = 0
    batch = []
    conn.execute("DELETE FROM stg_release_group_secondary_type")
    for line in iter_lines(path):
        fields = line.split("\t")
        if len(fields) != RGST_EXPECTED_COLS:
            skipped += 1
            continue
        try:
            rg_id = _parse_int(fields[RGST_COL_RELEASE_GROUP])
        except ValueError:
            skipped += 1
            continue
        if rg_id is None:
            skipped += 1
            continue
        batch.append((rg_id,))
        loaded += 1
        if len(batch) >= BATCH_SIZE:
            _flush(conn, insert_sql, batch)
    _flush(conn, insert_sql, batch)
    if skipped:
        logger.warning(
            "release_group_secondary_type_join: skipped %d malformed line(s)", skipped
        )
    return loaded, skipped
```

Add to `_LOADERS`:

```python
    "release_group_secondary_type_join": _load_release_group_secondary_type_join,
```

In the module docstring, change the loaded-tables sentence to list five tables (add `release_group_secondary_type_join`), and in `load_musicbrainz_staging`'s docstring change "four" to "five". In `main()`'s `--mbdump-dir` help text, add `release_group_secondary_type_join` to the list.

- [ ] **Step 7: Add `release_type` to `entities` with a migration**

In `pipeline/schema.sql`, inside `CREATE TABLE IF NOT EXISTS entities`, add a line after `notability_score INTEGER,`:

```sql
    release_type TEXT,
```

In `pipeline/db.py`, replace `init_db` with:

```python
def init_db(conn):
    """Apply schema.sql to `conn`, then add columns introduced after a store
    was first created. Idempotent: safe to call more than once."""
    conn.executescript(_SCHEMA_PATH.read_text())
    columns = {row[1] for row in conn.execute("PRAGMA table_info(entities)")}
    if "release_type" not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN release_type TEXT")
    conn.commit()
```

- [ ] **Step 8: Filter Album + EP with no secondary type in materialize**

In `pipeline/materialize.py`, after `ALBUM_PRIMARY_TYPE_ID = 1` add:

```python
# release_group_primary_type id 3 = 'EP' (same source file, verified in
# Task 1 Step 2 of docs/superpowers/plans/2026-09-24-album-catalog.md).
EP_PRIMARY_TYPE_ID = 3

# A release group with ANY secondary type (Live, Compilation, Soundtrack,
# Remix, ...) is excluded, matching web/api/_lp.ts's isAlbumOrEpReleaseGroup.
_NO_SECONDARY_TYPE_SQL = """
    NOT EXISTS (
        SELECT 1 FROM stg_release_group_secondary_type st
        WHERE st.rg_id = rg.rg_id
    )
"""
```

In `_CANDIDATE_COUNT_SQL`, replace

```sql
    WHERE rg.primary_type = ?
      AND pop.listener_count >= ?
```

with

```sql
    WHERE rg.primary_type IN (?, ?)
      AND {_NO_SECONDARY_TYPE_SQL}
      AND pop.listener_count >= ?
```

In `_UPSERT_SQL`:
- Append `release_type` to the end of the INSERT column list, so it reads `entity_type, mbid, title, primary_artist_name, primary_artist_mbid, release_year, notability_score, created_at, updated_at, release_type`.
- In the SELECT list, directly after the `? AS updated_at` line, add:

```sql
        , CASE WHEN rg.primary_type = ? THEN 'EP' ELSE 'Album' END AS release_type
```

- Replace its WHERE clause exactly as in `_CANDIDATE_COUNT_SQL`.
- Add `release_type = excluded.release_type,` to the `DO UPDATE SET` list.

Placeholder order is then: created_at, updated_at, the CASE's EP id, the two `IN` ids, the listener floor.

In `materialize_albums`, change the two executes to:

```python
        conn.execute(
            _UPSERT_SQL,
            (now, now, EP_PRIMARY_TYPE_ID, ALBUM_PRIMARY_TYPE_ID, EP_PRIMARY_TYPE_ID, min_listeners),
        )
```

```python
    candidate_total = conn.execute(
        _CANDIDATE_COUNT_SQL, (ALBUM_PRIMARY_TYPE_ID, EP_PRIMARY_TYPE_ID, min_listeners)
    ).fetchone()[0]
```

Update the module docstring's "Only primary-type Album release-groups" sentence to "Only primary-type Album or EP release-groups with no secondary type".

- [ ] **Step 9: Run the whole pipeline suite**

Run: `~/.venvs/album-case/bin/python -m pytest pipeline -q`
Expected: PASS, all tests including the 6 new ones.

- [ ] **Step 10: Commit**

```bash
git add pipeline/
git commit -m "$(cat <<'EOF'
feat(pipeline): keep albums and EPs with no secondary types

Matches the app's own album rule (web/api/_lp.ts) so the catalog built
from the dump excludes live albums, compilations, and soundtracks, and
includes EPs. Adds a release_type column carrying Album/EP forward.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj
EOF
)"
```

---

### Task 2: `_catalog.ts`: schema, FTS search, ranking, upserts

**Files:**
- Create: `web/api/_catalog.ts`
- Test: `web/api/_catalog.test.ts`

**Interfaces:**
- Produces (all exported from `web/api/_catalog.ts`; the file has only `import type` lines so Node can import it directly from `.mjs` scripts):
  - `CATALOG_SCHEMA_STATEMENTS: string[]`
  - `type CatalogAlbum = { mbid: string; title: string; primary_artist_name: string; primary_artist_mbid: string | null; release_year: number | null; primary_type: string; listener_count: number }`
  - `type SearchReleaseGroup = ReleaseGroup & { 'artist-credit'?: { name?: string; artist?: { id?: string } }[] }`
  - `coverUrlFor(mbid: string): string`
  - `searchGroupToAlbum(group: SearchReleaseGroup): DiscoveredAlbum`
  - `searchGroupToCatalogAlbum(group: SearchReleaseGroup): CatalogAlbum`
  - `toFtsQuery(q: string): string | null`
  - `rankCatalogRows<T extends { relevance: number; listener_count: number }>(rows: T[]): T[]`
  - `searchCatalog(client: Pick<Client, 'execute'>, q: string, limit: number): Promise<DiscoveredAlbum[]>`
  - `mergeAlbums(primary: DiscoveredAlbum[], secondary: DiscoveredAlbum[], limit: number): DiscoveredAlbum[]`
  - `catalogUpsertStatement(album: CatalogAlbum, loadedAt: number, mode: 'full' | 'keep-popularity'): InStatement`
- Consumes: `ReleaseGroup`, `DiscoveredAlbum` types from `web/api/_lp.ts`.

- [ ] **Step 1: Write the failing tests**

Create `web/api/_catalog.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import {
  CATALOG_SCHEMA_STATEMENTS,
  catalogUpsertStatement,
  mergeAlbums,
  rankCatalogRows,
  searchCatalog,
  toFtsQuery,
  type CatalogAlbum,
} from './_catalog';

const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
const BJORK = '87c5dedd-371d-4a53-9f7f-80522fb7f3cb';

function cat(overrides: Partial<CatalogAlbum> & { mbid: string; title: string }): CatalogAlbum {
  return {
    primary_artist_name: 'Radiohead',
    primary_artist_mbid: RADIOHEAD,
    release_year: 2000,
    primary_type: 'Album',
    listener_count: 100,
    ...overrides,
  };
}

async function freshCatalog(albums: CatalogAlbum[]): Promise<Client> {
  const client = createClient({ url: ':memory:' });
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await client.execute(sql);
  for (const a of albums) await client.execute(catalogUpsertStatement(a, 1, 'full'));
  return client;
}

describe('toFtsQuery', () => {
  it('quotes each word and prefix-matches the last one', () => {
    expect(toFtsQuery('Kid A')).toBe('"kid" "a"*');
  });

  it('treats FTS syntax characters and operators as plain words', () => {
    expect(toFtsQuery(`Jay-Z "Reasonable" (Doubt) AND don't`)).toBe(
      '"jay" "z" "reasonable" "doubt" "and" "don" "t"*',
    );
  });

  it('returns null when there are no letters or digits', () => {
    expect(toFtsQuery('!!! ???')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
  });

  it('caps the query at 10 words', () => {
    const q = 'a b c d e f g h i j k l';
    expect(toFtsQuery(q)?.split(' ')).toHaveLength(10);
  });
});

describe('rankCatalogRows', () => {
  it('breaks a relevance tie with popularity', () => {
    const ranked = rankCatalogRows([
      { id: 'quiet', relevance: -2, listener_count: 10 },
      { id: 'famous', relevance: -2, listener_count: 5000 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['famous', 'quiet']);
  });

  it('lets a much stronger text match beat a more popular weak match', () => {
    const ranked = rankCatalogRows([
      { id: 'popular-weak', relevance: -1, listener_count: 3000 },
      { id: 'exact', relevance: -10, listener_count: 5 },
    ]);
    expect(ranked[0].id).toBe('exact');
  });
});

describe('searchCatalog (real FTS5)', () => {
  let client: Client;

  beforeEach(async () => {
    client = await freshCatalog([
      cat({ mbid: 'ok', title: 'OK Computer', release_year: 1997, listener_count: 3000 }),
      // Wide popularity gap on purpose: bm25 differs slightly by title
      // length, and the ordering assertion must not hinge on that.
      cat({ mbid: 'kid', title: 'Kid A', listener_count: 30 }),
      cat({ mbid: 'homo', title: 'Homogenic', primary_artist_name: 'Björk', primary_artist_mbid: BJORK, listener_count: 800 }),
    ]);
  });

  it('prefix-matches the artist and orders by popularity', async () => {
    const albums = await searchCatalog(client, 'radioh', 10);
    expect(albums.map((a) => a.mbid)).toEqual(['ok', 'kid']);
  });

  it('matches regardless of accents and case', async () => {
    const lower = await searchCatalog(client, 'bjork', 10);
    const upper = await searchCatalog(client, 'BJÖRK', 10);
    expect(lower.map((a) => a.mbid)).toEqual(['homo']);
    expect(upper.map((a) => a.mbid)).toEqual(['homo']);
  });

  it('maps rows to DiscoveredAlbum with a cover URL', async () => {
    const [album] = await searchCatalog(client, 'kid a', 10);
    expect(album).toEqual({
      mbid: 'kid',
      title: 'Kid A',
      primary_artist_name: 'Radiohead',
      primary_artist_mbid: RADIOHEAD,
      release_year: 2000,
      cover_url: 'https://coverartarchive.org/release-group/kid/front-500',
    });
  });

  it('does not throw on FTS syntax characters in the query', async () => {
    await expect(searchCatalog(client, `"OK" (Computer) AND -`, 10)).resolves.toBeInstanceOf(Array);
  });

  it('returns [] without querying when the query has no words', async () => {
    const throwing = { execute: () => { throw new Error('should not query'); } };
    await expect(searchCatalog(throwing as never, '!!!', 10)).resolves.toEqual([]);
  });

  it('respects the limit', async () => {
    expect(await searchCatalog(client, 'radiohead', 1)).toHaveLength(1);
  });
});

describe('catalogUpsertStatement', () => {
  it('keep-popularity mode leaves listener_count alone and keeps FTS in sync', async () => {
    const client = await freshCatalog([cat({ mbid: 'ok', title: 'OK Computer', listener_count: 3000 })]);
    await client.execute(
      catalogUpsertStatement(cat({ mbid: 'ok', title: 'OK Computer OKNOTOK', listener_count: 0 }), 2, 'keep-popularity'),
    );
    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok'")).rows[0];
    expect(Number(row.listener_count)).toBe(3000);
    expect((await searchCatalog(client, 'oknotok', 10)).map((a) => a.mbid)).toEqual(['ok']);
  });

  it('full mode updates listener_count', async () => {
    const client = await freshCatalog([cat({ mbid: 'ok', title: 'OK Computer', listener_count: 3000 })]);
    await client.execute(catalogUpsertStatement(cat({ mbid: 'ok', title: 'OK Computer', listener_count: 4000 }), 2, 'full'));
    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok'")).rows[0];
    expect(Number(row.listener_count)).toBe(4000);
  });
});

describe('mergeAlbums', () => {
  const a = (mbid: string) => ({ mbid, title: mbid, primary_artist_name: 'x', release_year: null, cover_url: '' });

  it('keeps primary first, drops duplicates, caps the total', () => {
    const merged = mergeAlbums([a('1'), a('2')], [a('2'), a('3'), a('4')], 3);
    expect(merged.map((m) => m.mbid)).toEqual(['1', '2', '3']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run api/_catalog.test.ts`
Expected: FAIL, `Cannot find module './_catalog'`.

- [ ] **Step 3: Write `_catalog.ts`**

Create `web/api/_catalog.ts`:

```ts
// Only type imports here: web/scripts/*.mjs import this file directly under
// Node's type stripping, which can't resolve this directory's './x.js'
// runtime import convention.
import type { Client, InStatement } from '@libsql/client';
import type { DiscoveredAlbum, ReleaseGroup } from './_lp.js';

// Shared reference catalog of MusicBrainz albums and EPs (no secondary
// types). No session_id: this is reference data, not per-owner data.
// Triggers keep the external-content FTS index in sync on every write, so
// neither the bulk load nor the weekly refresh needs a rebuild step.
export const CATALOG_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS catalog_albums (
    mbid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    primary_artist_name TEXT NOT NULL,
    primary_artist_mbid TEXT,
    release_year INTEGER,
    primary_type TEXT NOT NULL,
    listener_count INTEGER NOT NULL,
    loaded_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_albums_artist
    ON catalog_albums(primary_artist_mbid)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS catalog_albums_fts USING fts5(
    title, primary_artist_name,
    content='catalog_albums', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS catalog_albums_ai AFTER INSERT ON catalog_albums BEGIN
    INSERT INTO catalog_albums_fts(rowid, title, primary_artist_name)
      VALUES (new.rowid, new.title, new.primary_artist_name);
  END`,
  `CREATE TRIGGER IF NOT EXISTS catalog_albums_ad AFTER DELETE ON catalog_albums BEGIN
    INSERT INTO catalog_albums_fts(catalog_albums_fts, rowid, title, primary_artist_name)
      VALUES ('delete', old.rowid, old.title, old.primary_artist_name);
  END`,
  `CREATE TRIGGER IF NOT EXISTS catalog_albums_au AFTER UPDATE ON catalog_albums BEGIN
    INSERT INTO catalog_albums_fts(catalog_albums_fts, rowid, title, primary_artist_name)
      VALUES ('delete', old.rowid, old.title, old.primary_artist_name);
    INSERT INTO catalog_albums_fts(rowid, title, primary_artist_name)
      VALUES (new.rowid, new.title, new.primary_artist_name);
  END`,
];

export type CatalogAlbum = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  primary_artist_mbid: string | null;
  release_year: number | null;
  primary_type: string;
  listener_count: number;
};

export type SearchReleaseGroup = ReleaseGroup & {
  'artist-credit'?: { name?: string; artist?: { id?: string } }[];
};

const MAX_FTS_TOKENS = 10;
const FTS_CANDIDATES = 50;

export function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

function releaseYearOf(group: ReleaseGroup): number | null {
  const yearStr = (group['first-release-date'] ?? '').split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

export function searchGroupToAlbum(group: SearchReleaseGroup): DiscoveredAlbum {
  const credit = group['artist-credit']?.[0];
  return {
    mbid: group.id,
    title: group.title,
    primary_artist_name: credit?.name ?? 'Unknown Artist',
    ...(credit?.artist?.id ? { primary_artist_mbid: credit.artist.id } : {}),
    release_year: releaseYearOf(group),
    cover_url: coverUrlFor(group.id),
  };
}

export function searchGroupToCatalogAlbum(group: SearchReleaseGroup): CatalogAlbum {
  const credit = group['artist-credit']?.[0];
  return {
    mbid: group.id,
    title: group.title,
    primary_artist_name: credit?.name ?? 'Unknown Artist',
    primary_artist_mbid: credit?.artist?.id ?? null,
    release_year: releaseYearOf(group),
    primary_type: group['primary-type'] ?? 'Album',
    listener_count: 0,
  };
}

// Tokens are letters/digits only, so they can't carry FTS syntax (quotes,
// parentheses, operators, column filters). Each is quoted so words like
// AND/OR/NOT stay literal; the last gets a prefix star for type-ahead.
export function toFtsQuery(q: string): string | null {
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_FTS_TOKENS);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}

// bm25 is negative and lower is better; subtracting log10(listeners) lets
// popularity settle close calls without overriding a clearly better match.
export function rankCatalogRows<T extends { relevance: number; listener_count: number }>(rows: T[]): T[] {
  const score = (r: T) => r.relevance - Math.log10(r.listener_count + 1);
  return [...rows].sort((a, b) => score(a) - score(b));
}

export async function searchCatalog(
  client: Pick<Client, 'execute'>,
  q: string,
  limit: number,
): Promise<DiscoveredAlbum[]> {
  const match = toFtsQuery(q);
  if (!match) return [];
  const result = await client.execute({
    sql: `SELECT c.mbid, c.title, c.primary_artist_name, c.primary_artist_mbid,
                 c.release_year, c.listener_count, bm25(catalog_albums_fts) AS relevance
          FROM catalog_albums_fts
          JOIN catalog_albums c ON c.rowid = catalog_albums_fts.rowid
          WHERE catalog_albums_fts MATCH ?
          ORDER BY relevance
          LIMIT ?`,
    args: [match, FTS_CANDIDATES],
  });
  const rows = result.rows.map((r) => ({
    mbid: String(r.mbid),
    title: String(r.title),
    primary_artist_name: String(r.primary_artist_name),
    primary_artist_mbid: r.primary_artist_mbid == null ? null : String(r.primary_artist_mbid),
    release_year: r.release_year == null ? null : Number(r.release_year),
    listener_count: Number(r.listener_count),
    relevance: Number(r.relevance),
  }));
  return rankCatalogRows(rows)
    .slice(0, limit)
    .map((r) => ({
      mbid: r.mbid,
      title: r.title,
      primary_artist_name: r.primary_artist_name,
      ...(r.primary_artist_mbid ? { primary_artist_mbid: r.primary_artist_mbid } : {}),
      release_year: r.release_year,
      cover_url: coverUrlFor(r.mbid),
    }));
}

export function mergeAlbums(
  primary: DiscoveredAlbum[],
  secondary: DiscoveredAlbum[],
  limit: number,
): DiscoveredAlbum[] {
  const seen = new Set(primary.map((a) => a.mbid));
  const merged = [...primary];
  for (const album of secondary) {
    if (seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    merged.push(album);
  }
  return merged.slice(0, limit);
}

const FULL_UPDATE = `title = excluded.title,
  primary_artist_name = excluded.primary_artist_name,
  primary_artist_mbid = excluded.primary_artist_mbid,
  release_year = excluded.release_year,
  primary_type = excluded.primary_type,
  listener_count = excluded.listener_count,
  loaded_at = excluded.loaded_at`;

const KEEP_POPULARITY_UPDATE = `title = excluded.title,
  primary_artist_name = excluded.primary_artist_name,
  primary_artist_mbid = excluded.primary_artist_mbid,
  release_year = excluded.release_year,
  primary_type = excluded.primary_type`;

// 'full' is the bulk dump load (authoritative popularity). 'keep-popularity'
// is the weekly refresh: a new release has no popularity data yet, so it
// must never overwrite a real listener_count from the dump.
export function catalogUpsertStatement(
  album: CatalogAlbum,
  loadedAt: number,
  mode: 'full' | 'keep-popularity',
): InStatement {
  return {
    sql: `INSERT INTO catalog_albums (
            mbid, title, primary_artist_name, primary_artist_mbid,
            release_year, primary_type, listener_count, loaded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(mbid) DO UPDATE SET ${mode === 'full' ? FULL_UPDATE : KEEP_POPULARITY_UPDATE}`,
    args: [
      album.mbid,
      album.title,
      album.primary_artist_name,
      album.primary_artist_mbid,
      album.release_year,
      album.primary_type,
      album.listener_count,
      loadedAt,
    ],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run api/_catalog.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

```bash
git add web/api/_catalog.ts web/api/_catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add album catalog schema and full-text search helpers

catalog_albums plus a trigger-synced FTS5 index, a query builder that
can't be broken by FTS syntax in user input, and relevance-then-
popularity ranking. Not wired to any route yet.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj
EOF
)"
```

---

### Task 3: `/api/search-album` searches the catalog first

**Files:**
- Modify: `web/api/_dbTimeout.ts`
- Modify: `web/api/search-album.ts`
- Modify: `web/api/search-album.test.ts`
- Create: `web/api/search-album.catalog.test.ts`

**Interfaces:**
- Consumes: `searchCatalog`, `mergeAlbums`, `searchGroupToAlbum`, `CATALOG_SCHEMA_STATEMENTS`, `catalogUpsertStatement`, `type SearchReleaseGroup` from Task 2.
- Produces: `withDbTimeout<T>(promise: Promise<T>, ms?: number): Promise<T>`. `GET /api/search-album?q=...&live=1`.

- [ ] **Step 1: Write the failing tests**

In `web/api/search-album.test.ts`, change the vitest import to include `beforeEach`, and add at the top of the `describe` block:

```ts
  beforeEach(() => {
    // Keep these tests on the MusicBrainz path even if the shell exports
    // real Turso credentials.
    vi.stubEnv('TURSO_DATABASE_URL', '');
    vi.stubEnv('TURSO_AUTH_TOKEN', '');
  });
```

and add `vi.unstubAllEnvs();` inside the existing `afterEach`.

Create `web/api/search-album.catalog.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { client } = await vi.hoisted(async () => {
  const { createClient } = await import('@libsql/client');
  return { client: createClient({ url: 'file::memory:' }) };
});
vi.mock('@libsql/client', () => ({ createClient: () => client }));

import handler from './search-album';
import { CATALOG_SCHEMA_STATEMENTS, catalogUpsertStatement } from './_catalog';

function makeRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
}

async function search(query: Record<string, string>) {
  const res = makeRes();
  await handler({ method: 'GET', query } as never, res as never);
  return res;
}

function mbResponse(ids: string[]) {
  return {
    ok: true,
    json: async () => ({
      'release-groups': ids.map((id) => ({
        id,
        title: `MB ${id}`,
        'primary-type': 'Album',
        'first-release-date': '2001-01-01',
        'artist-credit': [{ name: 'Radiohead', artist: { id: 'artist-r' } }],
      })),
    }),
  };
}

async function seedCatalog(count: number) {
  await client.execute('DROP TABLE IF EXISTS catalog_albums_fts');
  await client.execute('DROP TABLE IF EXISTS catalog_albums');
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await client.execute(sql);
  for (let i = 1; i <= count; i++) {
    await client.execute(
      catalogUpsertStatement(
        {
          mbid: `cat-${i}`,
          title: `Radiohead Album ${i}`,
          primary_artist_name: 'Radiohead',
          primary_artist_mbid: 'artist-r',
          release_year: 1990 + i,
          primary_type: 'Album',
          listener_count: 100 * i,
        },
        1,
        'full',
      ),
    );
  }
}

describe('/api/search-album catalog-first', () => {
  beforeEach(() => {
    vi.stubEnv('TURSO_DATABASE_URL', 'file::memory:');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns 5+ catalog hits without calling MusicBrainz', async () => {
    await seedCatalog(6);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await search({ q: 'radiohead' });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const albums = (res.body as { albums: { mbid: string }[] }).albums;
    expect(albums).toHaveLength(6);
    expect(albums[0].mbid).toBe('cat-6'); // most popular first
  });

  it('merges MusicBrainz results after fewer than 5 catalog hits, catalog first, no duplicates', async () => {
    await seedCatalog(2);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mbResponse(['cat-1', 'mb-1', 'mb-2'])));

    const res = await search({ q: 'radiohead' });

    const ids = (res.body as { albums: { mbid: string }[] }).albums.map((a) => a.mbid);
    expect(ids).toEqual(['cat-2', 'cat-1', 'mb-1', 'mb-2']);
  });

  it('live=1 skips the catalog and goes to MusicBrainz', async () => {
    await seedCatalog(6);
    const fetchMock = vi.fn().mockResolvedValue(mbResponse(['mb-1']));
    vi.stubGlobal('fetch', fetchMock);

    const res = await search({ q: 'radiohead', live: '1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((res.body as { albums: { mbid: string }[] }).albums.map((a) => a.mbid)).toEqual(['mb-1']);
  });

  it('falls back to MusicBrainz when the catalog table does not exist', async () => {
    await client.execute('DROP TABLE IF EXISTS catalog_albums_fts');
    await client.execute('DROP TABLE IF EXISTS catalog_albums');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mbResponse(['mb-1'])));

    const res = await search({ q: 'radiohead' });

    expect(res.statusCode).toBe(200);
    expect((res.body as { albums: { mbid: string }[] }).albums.map((a) => a.mbid)).toEqual(['mb-1']);
  });

  it('still reaches MusicBrainz for a punctuation-only query', async () => {
    await seedCatalog(6);
    const fetchMock = vi.fn().mockResolvedValue(mbResponse(['mb-1']));
    vi.stubGlobal('fetch', fetchMock);

    const res = await search({ q: '!!!' });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns catalog hits when MusicBrainz fails after a partial catalog match', async () => {
    await seedCatalog(2);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const res = await search({ q: 'radiohead' });

    expect(res.statusCode).toBe(200);
    expect((res.body as { albums: unknown[] }).albums).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run api/search-album.catalog.test.ts api/search-album.test.ts`
Expected: the new catalog tests FAIL (handler never queries the catalog; `fetch` is called, `live` ignored). The existing `search-album.test.ts` tests still PASS.

- [ ] **Step 3: Give `withDbTimeout` an optional timeout**

Replace the function in `web/api/_dbTimeout.ts` with:

```ts
export function withDbTimeout<T>(promise: Promise<T>, ms: number = DB_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('db_timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: Rewrite `search-album.ts` to search the catalog first**

Replace the whole file `web/api/search-album.ts` with:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import { isAlbumOrEpReleaseGroup, type DiscoveredAlbum } from './_lp.js';
import {
  mergeAlbums,
  searchCatalog,
  searchGroupToAlbum,
  type SearchReleaseGroup,
} from './_catalog.js';
import { withDbTimeout } from './_dbTimeout.js';

const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 200;
const MB_SEARCH_LIMIT = 50;
const MB_TIMEOUT_MS = 8000;
// At this many catalog hits, skip MusicBrainz entirely.
const CATALOG_ENOUGH = 5;
// A slow catalog must never make search slower than going straight to
// MusicBrainz, so this is far below the shared 8s DB timeout.
const CATALOG_TIMEOUT_MS = 1500;

function catalogClient(): ReturnType<typeof createClient> | null {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;
  return createClient({ url, authToken });
}

async function searchCatalogSafely(q: string): Promise<DiscoveredAlbum[]> {
  const client = catalogClient();
  if (!client) return [];
  try {
    return await withDbTimeout(searchCatalog(client, q, MAX_RESULTS), CATALOG_TIMEOUT_MS);
  } catch {
    // Missing table (not loaded yet), timeout, or connection error: behave
    // exactly like the pre-catalog endpoint.
    return [];
  }
}

async function searchMusicBrainz(q: string): Promise<DiscoveredAlbum[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MB_TIMEOUT_MS);
  try {
    // Lucene-escape double quotes so a quoted query can't break the syntax.
    const params = new URLSearchParams({
      query: q.replace(/"/g, '\\"'),
      fmt: 'json',
      limit: String(MB_SEARCH_LIMIT),
    });
    const mb = await fetch(`${MB_BASE}/release-group/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!mb.ok) throw new Error(`musicbrainz_${mb.status}`);
    const data = (await mb.json()) as { 'release-groups'?: SearchReleaseGroup[] };
    return (data['release-groups'] ?? [])
      .filter(isAlbumOrEpReleaseGroup)
      .slice(0, MAX_RESULTS)
      .map(searchGroupToAlbum);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ error: 'missing_query' });
    return;
  }
  if (q.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: 'query_too_long' });
    return;
  }
  const live = req.query.live === '1';

  // This is an unauthenticated public route that can proxy MusicBrainz,
  // which rate-limits per User-Agent (~1 req/s). Let Vercel's edge absorb
  // repeat queries for the same string (live=1 is part of the cache key).
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  const catalogHits = live ? [] : await searchCatalogSafely(q);
  if (catalogHits.length >= CATALOG_ENOUGH) {
    res.status(200).json({ albums: catalogHits });
    return;
  }

  try {
    const mbAlbums = await searchMusicBrainz(q);
    res.status(200).json({ albums: mergeAlbums(catalogHits, mbAlbums, MAX_RESULTS) });
  } catch {
    // Covers a non-ok MusicBrainz response and the abort on a hung upstream.
    if (catalogHits.length > 0) {
      res.status(200).json({ albums: catalogHits });
      return;
    }
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  }
}
```

- [ ] **Step 5: Run the endpoint tests to verify they pass**

Run: `cd web && npx vitest run api/search-album.catalog.test.ts api/search-album.test.ts`
Expected: PASS, all tests in both files.

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/api/_dbTimeout.ts web/api/search-album.ts web/api/search-album.test.ts web/api/search-album.catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(api): search the album catalog before MusicBrainz

Five or more catalog hits skip MusicBrainz entirely; fewer merge with
live results. live=1 forces MusicBrainz. Any catalog failure (not
loaded, slow, unreachable) falls back to today's behavior.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj
EOF
)"
```

---

### Task 4: "Search everywhere" link

**Files:**
- Modify: `web/src/ui/rankListSearch.ts`
- Modify: `web/src/ui/rankList.ts` (the `onSearchMusicBrainz` option type, ~line 112)
- Modify: `web/src/main.ts` (`runMusicBrainzSearch`, ~line 583)
- Create: `web/e2e/search-everywhere.spec.ts`

**Interfaces:**
- Consumes: `GET /api/search-album?q=...&live=1` from Task 3.
- Produces: `onSearchMusicBrainz?: (query: string, options?: { live?: boolean }) => void` on both `RankListSearchDeps` and the `mountRankList` options.

- [ ] **Step 1: Write the failing e2e tests**

Create `web/e2e/search-everywhere.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { installApiMocks } from './support/mockApi';
import { snapshot } from './support/fixtures';

test('"Search everywhere" re-runs the album search live', async ({ page }) => {
  await installApiMocks(page, { snapshot: snapshot([]) });
  const albumSearches: string[] = [];
  await page.route('**/api/search-album*', async (route) => {
    const url = new URL(route.request().url());
    albumSearches.push(url.search);
    const live = url.searchParams.get('live') === '1';
    await route.fulfill({
      json: {
        albums: [{
          mbid: live ? 'live-1' : 'cat-1',
          title: live ? 'Live Result' : 'Catalog Result',
          primary_artist_name: 'Some Artist',
          release_year: 2001,
          cover_url: '',
        }],
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Ranked list/ }).click();
  await page.getByLabel('Search your albums or bands').fill('zzz');
  await page.getByRole('button', { name: 'Search MusicBrainz for "zzz"' }).click();
  await expect(page.getByText('Catalog Result')).toBeVisible();

  await page.getByRole('button', { name: 'Search everywhere' }).click();

  await expect(page.getByText('Live Result')).toBeVisible();
  expect(albumSearches[0]).not.toContain('live=1');
  expect(albumSearches.at(-1)).toContain('live=1');
});

test('"Search everywhere" is offered when nothing is found', async ({ page }) => {
  await installApiMocks(page, { snapshot: snapshot([]), searchAlbumResults: [] });

  await page.goto('/');
  await page.getByRole('button', { name: /^Ranked list/ }).click();
  await page.getByLabel('Search your albums or bands').fill('zzz');
  await page.getByRole('button', { name: 'Search MusicBrainz for "zzz"' }).click();

  await expect(page.getByText('No albums or bands found.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search everywhere' })).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e tests to verify they fail**

Run: `cd web && npx playwright test e2e/search-everywhere.spec.ts`
Expected: FAIL, no button named "Search everywhere".

- [ ] **Step 3: Widen the callback type**

In `web/src/ui/rankListSearch.ts`, in `RankListSearchDeps`, replace

```ts
  onSearchMusicBrainz?: (query: string) => void;
```

with

```ts
  onSearchMusicBrainz?: (query: string, options?: { live?: boolean }) => void;
```

Make the identical replacement in `web/src/ui/rankList.ts` (the `onSearchMusicBrainz?: (query: string) => void;` option, ~line 112).

- [ ] **Step 4: Render the button**

In `web/src/ui/rankListSearch.ts`, inside the fallback builder, directly after the `searchBtn` arrow function (the one ending `btn.addEventListener('click', () => deps.onSearchMusicBrainz?.(query));\n      return btn;\n    };`), add:

```ts
    // Forces a live MusicBrainz search, bypassing the catalog: covers
    // same-day releases and anything below the catalog's popularity floor.
    const searchEverywhereBtn = (): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'candidate-action rank-search-everywhere';
      btn.textContent = 'Search everywhere';
      btn.addEventListener('click', () => deps.onSearchMusicBrainz?.(query, { live: true }));
      return btn;
    };
```

In the `status === 'done'` empty branch, replace `wrap.append(none);` with `wrap.append(none, searchEverywhereBtn());`.

At the end of the same function, directly before its final `return wrap;` (after the `selectMessage` block), add:

```ts
    wrap.append(searchEverywhereBtn());
```

- [ ] **Step 5: Pass `live=1` through**

In `web/src/main.ts`, change

```ts
  function runMusicBrainzSearch(query: string): void {
```

to

```ts
  function runMusicBrainzSearch(query: string, options: { live?: boolean } = {}): void {
```

and inside it replace

```ts
          const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}`);
```

with

```ts
          const liveParam = options.live ? '&live=1' : '';
          const res = await fetch(`/api/search-album?q=${encodeURIComponent(query)}${liveParam}`);
```

(Only this call site; the curated-list lookup at ~line 926 is unchanged.)

- [ ] **Step 6: Run the e2e and unit suites**

Run: `cd web && npx tsc --noEmit && npx vitest run && npx playwright test`
Expected: PASS: typecheck clean, all unit tests, all e2e specs (13: the existing 11 plus these 2).

- [ ] **Step 7: Commit**

```bash
git add web/src/ui/rankListSearch.ts web/src/ui/rankList.ts web/src/main.ts web/e2e/search-everywhere.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): add "Search everywhere" link to album search results

Re-runs the current search against live MusicBrainz, bypassing the
catalog, for brand-new or obscure albums the catalog doesn't have yet.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj
EOF
)"
```

---

### Task 5: Weekly refresh route

**Files:**
- Create: `web/api/cron/refresh-catalog.ts`
- Test: `web/api/cron/refresh-catalog.test.ts`
- Modify: `web/vercel.json`

**Interfaces:**
- Consumes: `CATALOG_SCHEMA_STATEMENTS`, `catalogUpsertStatement`, `searchGroupToCatalogAlbum`, `type SearchReleaseGroup`, `type CatalogAlbum` from Task 2; `isAlbumOrEpReleaseGroup` from `web/api/_lp.ts`.
- Produces: `releaseWindow(now: Date): { from: string; to: string }`, `refreshCatalog(deps: RefreshDeps): Promise<RefreshResult>`, `GET /api/cron/refresh-catalog` (requires `Authorization: Bearer $CRON_SECRET`).

- [ ] **Step 1: Write the failing tests**

Create `web/api/cron/refresh-catalog.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import handler, { refreshCatalog, releaseWindow } from './refresh-catalog';
import { CATALOG_SCHEMA_STATEMENTS, catalogUpsertStatement, searchCatalog } from '../_catalog';

const RADIOHEAD = 'artist-radiohead';

function group(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    'primary-type': 'Album',
    'first-release-date': '2026-09-20',
    'artist-credit': [{ name: 'Radiohead', artist: { id: RADIOHEAD } }],
    ...over,
  };
}

function page(groups: unknown[], count: number) {
  return { ok: true, json: async () => ({ count, 'release-groups': groups }) } as unknown as Response;
}

async function catalogWithRadiohead(): Promise<Client> {
  const client = createClient({ url: ':memory:' });
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await client.execute(sql);
  await client.execute(catalogUpsertStatement({
    mbid: 'ok-computer', title: 'OK Computer', primary_artist_name: 'Radiohead',
    primary_artist_mbid: RADIOHEAD, release_year: 1997, primary_type: 'Album', listener_count: 3000,
  }, 1, 'full'));
  return client;
}

const now = () => new Date('2026-09-24T10:00:00Z');
const noSleep = async () => {};

describe('releaseWindow', () => {
  it('covers the last 21 days, inclusive of today', () => {
    expect(releaseWindow(now())).toEqual({ from: '2026-09-03', to: '2026-09-24' });
  });
});

describe('refreshCatalog', () => {
  let client: Client;
  beforeEach(async () => { client = await catalogWithRadiohead(); });

  it('adds new albums by known artists and skips unknown artists, live albums, and singles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([
      group('new-radiohead'),
      group('unknown-artist', { 'artist-credit': [{ name: 'Nobody', artist: { id: 'artist-nobody' } }] }),
      group('radiohead-live', { 'secondary-types': ['Live'] }),
      group('radiohead-single', { 'primary-type': 'Single' }),
    ], 4));

    const result = await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    expect(result).toMatchObject({ scanned: 4, kept: 1, added: 1, pages: 1, partial: false });
    expect((await searchCatalog(client, 'title new', 10)).map((a) => a.mbid)).toEqual(['new-radiohead']);
    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'new-radiohead'")).rows[0];
    expect(Number(row.listener_count)).toBe(0);
  });

  it('adds nothing on a re-run of the same window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([group('new-radiohead')], 1));
    await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    const second = await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    expect(second.added).toBe(0);
  });

  it('never overwrites the popularity of an album already in the catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([group('ok-computer', { title: 'OK Computer' })], 1));

    await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok-computer'")).rows[0];
    expect(Number(row.listener_count)).toBe(3000);
  });

  it('keeps earlier pages and reports partial when a later page fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([group('new-radiohead')], 150))
      .mockRejectedValueOnce(new Error('503'));
    const sleep = vi.fn(async () => {});

    const result = await refreshCatalog({ client, fetchImpl, sleep, now });

    expect(result).toMatchObject({ pages: 1, added: 1, partial: true });
    expect(sleep).toHaveBeenCalledTimes(1); // between pages, never before the first
  });
});

describe('GET /api/cron/refresh-catalog auth', () => {
  afterEach(() => vi.unstubAllEnvs());

  function res() {
    return {
      statusCode: 200, body: null as unknown,
      status(c: number) { this.statusCode = c; return this; },
      json(p: unknown) { this.body = p; return this; },
      setHeader() { return this; },
    };
  }

  it('rejects a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'right');
    const r = res();
    await handler({ method: 'GET', headers: {} } as never, r as never);
    expect(r.statusCode).toBe(401);
  });

  it('rejects a wrong secret, and everything when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', 'right');
    const wrong = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } } as never, wrong as never);
    expect(wrong.statusCode).toBe(401);

    vi.stubEnv('CRON_SECRET', '');
    const unset = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer ' } } as never, unset as never);
    expect(unset.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run api/cron/refresh-catalog.test.ts`
Expected: FAIL, `Cannot find module './refresh-catalog'`.

- [ ] **Step 3: Write the route**

Create `web/api/cron/refresh-catalog.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type Client } from '@libsql/client';
import { isAlbumOrEpReleaseGroup } from '../_lp.js';
import {
  CATALOG_SCHEMA_STATEMENTS,
  catalogUpsertStatement,
  searchGroupToCatalogAlbum,
  type CatalogAlbum,
  type SearchReleaseGroup,
} from '../_catalog.js';

const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const WINDOW_DAYS = 21;
const PAGE_SIZE = 100;
// Bounds a run to roughly 45s at MusicBrainz's 1 request/second limit, inside
// the 60s maxDuration set in vercel.json.
const MAX_PAGES = 40;
const PAGE_DELAY_MS = 1100;
const MB_TIMEOUT_MS = 8000;
const IN_CHUNK = 100;

export type RefreshDeps = {
  client: Pick<Client, 'execute' | 'batch'>;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

export type RefreshResult = {
  scanned: number;
  kept: number;
  added: number;
  pages: number;
  partial: boolean;
};

export function releaseWindow(now: Date): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

// `column` is always one of the two literals below, never user input.
async function presentValues(
  client: RefreshDeps['client'],
  column: 'mbid' | 'primary_artist_mbid',
  values: string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK);
    const result = await client.execute({
      sql: `SELECT DISTINCT ${column} AS v FROM catalog_albums WHERE ${column} IN (${chunk.map(() => '?').join(', ')})`,
      args: chunk,
    });
    for (const row of result.rows) present.add(String(row.v));
  }
  return present;
}

async function fetchPage(
  deps: RefreshDeps,
  query: string,
  offset: number,
): Promise<{ count: number; groups: SearchReleaseGroup[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MB_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ query, fmt: 'json', limit: String(PAGE_SIZE), offset: String(offset) });
    const res = await deps.fetchImpl(`${MB_BASE}/release-group/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`musicbrainz_${res.status}`);
    const body = (await res.json()) as { count?: number; 'release-groups'?: SearchReleaseGroup[] };
    return { count: body.count ?? 0, groups: body['release-groups'] ?? [] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshCatalog(deps: RefreshDeps): Promise<RefreshResult> {
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await deps.client.execute(sql);

  const { from, to } = releaseWindow(deps.now());
  const query = `firstreleasedate:[${from} TO ${to}] AND (primarytype:album OR primarytype:ep)`;

  const groups: SearchReleaseGroup[] = [];
  let pages = 0;
  let total = Infinity;
  let partial = false;
  for (let offset = 0; offset < total && pages < MAX_PAGES; offset += PAGE_SIZE) {
    if (pages > 0) await deps.sleep(PAGE_DELAY_MS);
    try {
      const pageResult = await fetchPage(deps, query, offset);
      total = pageResult.count;
      groups.push(...pageResult.groups);
      pages += 1;
    } catch {
      partial = true;
      break;
    }
  }
  if (!partial && pages * PAGE_SIZE < total) partial = true; // hit MAX_PAGES

  const byMbid = new Map<string, CatalogAlbum>();
  for (const group of groups) {
    if (!isAlbumOrEpReleaseGroup(group)) continue;
    const album = searchGroupToCatalogAlbum(group);
    if (album.primary_artist_mbid) byMbid.set(album.mbid, album);
  }
  const candidates = [...byMbid.values()];

  const known = await presentValues(
    deps.client,
    'primary_artist_mbid',
    [...new Set(candidates.map((a) => a.primary_artist_mbid as string))],
  );
  const kept = candidates.filter((a) => known.has(a.primary_artist_mbid as string));
  const existing = await presentValues(deps.client, 'mbid', kept.map((a) => a.mbid));

  if (kept.length > 0) {
    const loadedAt = deps.now().getTime();
    await deps.client.batch(kept.map((a) => catalogUpsertStatement(a, loadedAt, 'keep-popularity')), 'write');
  }

  return {
    scanned: groups.length,
    kept: kept.length,
    added: kept.filter((a) => !existing.has(a.mbid)).length,
    pages,
    partial,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    res.status(500).json({ error: 'missing_turso_env' });
    return;
  }

  try {
    const result = await refreshCatalog({
      client: createClient({ url, authToken }),
      fetchImpl: fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    });
    console.log('refresh-catalog', JSON.stringify(result));
    res.status(200).json(result);
  } catch (err) {
    console.error('refresh-catalog failed', err);
    res.status(500).json({ error: 'refresh_failed' });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run api/cron/refresh-catalog.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Schedule it**

Replace `web/vercel.json` with:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "functions": {
    "api/cron/refresh-catalog.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/cron/refresh-catalog", "schedule": "0 9 * * 1" }
  ]
}
```

(Mondays 09:00 UTC.)

- [ ] **Step 6: Full suite, typecheck, build**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean, clean.

- [ ] **Step 7: Commit**

```bash
git add web/api/cron/ web/vercel.json
git commit -m "$(cat <<'EOF'
feat(api): weekly job adds new releases to the album catalog

Pulls albums and EPs first released in the last 21 days by artists
already in the catalog. Never touches existing popularity; a failed
page keeps what was fetched and reports partial.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj
EOF
)"
```

---

### Task 6: Load script (dry-run by default)

**Files:**
- Create: `web/scripts/lib/catalog-load.mjs`
- Test: `web/scripts/lib/catalog-load.test.mjs`
- Create: `web/scripts/load-catalog.mjs`

**Interfaces:**
- Consumes: `entities` rows with `release_type` from Task 1; `CATALOG_SCHEMA_STATEMENTS`, `catalogUpsertStatement` from Task 2.
- Produces: `readPipelineAlbums(source)`, `loadCatalog({ source, target, write, now, log })` returning `{ albums, byType, batches, sample, written }`.

- [ ] **Step 1: Write the failing tests**

Create `web/scripts/lib/catalog-load.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { loadCatalog } from './catalog-load.mjs';
import { searchCatalog } from '../../api/_catalog.ts';

async function pipelineDb() {
  const source = createClient({ url: ':memory:' });
  await source.execute(`CREATE TABLE entities (
    entity_type TEXT NOT NULL, mbid TEXT NOT NULL, title TEXT NOT NULL,
    primary_artist_name TEXT, primary_artist_mbid TEXT, release_year INTEGER,
    cover_url TEXT, notability_score INTEGER, release_type TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (entity_type, mbid))`);
  const rows = [
    ['album', 'ok', 'OK Computer', 'Radiohead', 'r', 1997, 3000, 'Album'],
    ['album', 'ep', 'Come On Pilgrim', 'Pixies', 'p', 1987, 900, 'EP'],
    ['album', 'old', 'Pre-Migration Row', 'Someone', 's', 1990, 100, null],
  ];
  for (const r of rows) {
    await source.execute({
      sql: `INSERT INTO entities (entity_type, mbid, title, primary_artist_name, primary_artist_mbid,
            release_year, notability_score, release_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      args: r,
    });
  }
  return source;
}

async function tableExists(client, name) {
  const r = await client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE name = ?", args: [name] });
  return r.rows.length > 0;
}

describe('loadCatalog', () => {
  it('dry run reports counts and writes nothing', async () => {
    const source = await pipelineDb();
    const target = createClient({ url: ':memory:' });

    const report = await loadCatalog({ source, target, write: false, log: () => {} });

    expect(report.albums).toBe(2);
    expect(report.byType).toEqual({ Album: 1, EP: 1 });
    expect(report.written).toBe(0);
    expect(await tableExists(target, 'catalog_albums')).toBe(false);
  });

  it('write loads rows that are immediately searchable', async () => {
    const source = await pipelineDb();
    const target = createClient({ url: ':memory:' });

    const report = await loadCatalog({ source, target, write: true, now: 5, log: () => {} });

    expect(report.written).toBe(2);
    expect((await searchCatalog(target, 'pilgrim', 10)).map((a) => a.mbid)).toEqual(['ep']);
  });

  it('re-running is idempotent and refreshes popularity', async () => {
    const source = await pipelineDb();
    const target = createClient({ url: ':memory:' });
    await loadCatalog({ source, target, write: true, log: () => {} });
    await source.execute("UPDATE entities SET notability_score = 4000 WHERE mbid = 'ok'");

    await loadCatalog({ source, target, write: true, log: () => {} });

    const count = (await target.execute('SELECT COUNT(*) AS n FROM catalog_albums')).rows[0].n;
    const ok = (await target.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok'")).rows[0];
    expect(Number(count)).toBe(2);
    expect(Number(ok.listener_count)).toBe(4000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run scripts/lib/catalog-load.test.mjs`
Expected: FAIL, `Cannot find module './catalog-load.mjs'`.

- [ ] **Step 3: Write the library**

Create `web/scripts/lib/catalog-load.mjs`:

```js
import { CATALOG_SCHEMA_STATEMENTS, catalogUpsertStatement } from '../../api/_catalog.ts';

export const LOAD_BATCH_SIZE = 500;

/** Albums/EPs the pipeline materialized. Rows from a pre-migration build
 *  (release_type NULL) are skipped rather than guessed. */
export async function readPipelineAlbums(source) {
  const result = await source.execute(`
    SELECT mbid, title, primary_artist_name, primary_artist_mbid,
           release_year, release_type, notability_score
    FROM entities
    WHERE entity_type = 'album'
      AND release_type IN ('Album', 'EP')
      AND primary_artist_name IS NOT NULL
    ORDER BY mbid`);
  return result.rows.map((r) => ({
    mbid: String(r.mbid),
    title: String(r.title),
    primary_artist_name: String(r.primary_artist_name),
    primary_artist_mbid: r.primary_artist_mbid == null ? null : String(r.primary_artist_mbid),
    release_year: r.release_year == null ? null : Number(r.release_year),
    primary_type: String(r.release_type),
    listener_count: Number(r.notability_score ?? 0),
  }));
}

export async function loadCatalog({ source, target, write, now = Date.now(), log = console.log }) {
  const albums = await readPipelineAlbums(source);
  const byType = {};
  for (const a of albums) byType[a.primary_type] = (byType[a.primary_type] ?? 0) + 1;
  const report = {
    albums: albums.length,
    byType,
    batches: Math.ceil(albums.length / LOAD_BATCH_SIZE),
    sample: albums.slice(0, 5),
    written: 0,
  };
  if (!write) return report;

  for (const sql of CATALOG_SCHEMA_STATEMENTS) await target.execute(sql);
  for (let i = 0; i < albums.length; i += LOAD_BATCH_SIZE) {
    const chunk = albums.slice(i, i + LOAD_BATCH_SIZE);
    await target.batch(chunk.map((a) => catalogUpsertStatement(a, now, 'full')), 'write');
    report.written += chunk.length;
    if ((i / LOAD_BATCH_SIZE) % 20 === 0) log(`loaded ${report.written}/${albums.length}`);
  }
  return report;
}
```

- [ ] **Step 4: Write the CLI**

Create `web/scripts/load-catalog.mjs`:

```js
/**
 * Copy the pipeline's album catalog (data/tastetest.db, built by
 * pipeline/build.py) into Turso's catalog_albums table.
 *
 * Usage (from the repo root):
 *   node web/scripts/load-catalog.mjs [--db data/tastetest.db]
 *   node --env-file=web/.env.local web/scripts/load-catalog.mjs --write
 *
 * Without --write: reads the local DB and prints counts, a sample, and the
 * batch plan. Touches nothing remote and needs no credentials.
 * --write: upserts every row (additive; never touches ranking_snapshots,
 * atoms, sessions, or discovered_albums). Safe to re-run for a newer dump.
 */
import { existsSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { loadCatalog } from './lib/catalog-load.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const dbFlag = args.indexOf('--db');
const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : 'data/tastetest.db';

if (!dbPath || !existsSync(dbPath)) {
  console.error(`No pipeline database at ${dbPath}. Run pipeline/build.py first.`);
  process.exit(1);
}

const source = createClient({ url: `file:${dbPath}` });
let target = null;
if (write) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('--write needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (use --env-file=web/.env.local).');
    process.exit(1);
  }
  target = createClient({ url, authToken });
}

const report = await loadCatalog({ source, target, write });
console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', ...report }, null, 2));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run scripts/lib/catalog-load.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Smoke the CLI's missing-DB path**

Run: `node web/scripts/load-catalog.mjs --db /nonexistent.db; echo "exit $?"`
Expected: `No pipeline database at /nonexistent.db...` and `exit 1`.

- [ ] **Step 7: Full suite and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS, clean.

```bash
git add web/scripts/lib/catalog-load.mjs web/scripts/lib/catalog-load.test.mjs web/scripts/load-catalog.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): add dry-run-by-default album catalog loader

Copies the pipeline's Album/EP rows into Turso's catalog_albums in
batches of 500. Dry run is local-only and needs no credentials; --write
is additive and idempotent.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011Ai4rR8226DEBqRWeQ4Enj
EOF
)"
```

---

### Task 7: Build the catalog locally (operator run, no production access)

**Files:** none in the repo. Working directory `~/album-case-dump` (outside the repo, never committed). Output: `data/tastetest.db` (gitignored).

- [ ] **Step 1: Confirm disk space**

Run: `df -h ~ | tail -1`
Expected: at least 8GB free. If less, stop and tell Keith.

- [ ] **Step 2: Stream-extract the five MusicBrainz tables (long, run in background)**

```bash
mkdir -p ~/album-case-dump && cd ~/album-case-dump
MB_DUMP_DIR=$(curl -s https://data.metabrainz.org/pub/musicbrainz/data/fullexport/LATEST)
echo "dump: $MB_DUMP_DIR"
curl -s "https://data.metabrainz.org/pub/musicbrainz/data/fullexport/${MB_DUMP_DIR}/mbdump.tar.bz2" \
  | tar -xjf - mbdump/release_group mbdump/release_group_meta mbdump/artist_credit_name \
      mbdump/artist mbdump/release_group_secondary_type_join mbdump/release_group_primary_type
ls -la mbdump/
grep -P '\tEP\t' mbdump/release_group_primary_type
```
Expected: six table files (the sixth only confirms EP's id; the grep line's first column must be 3, matching `EP_PRIMARY_TYPE_ID`, or stop and fix it before Step 4) in `~/album-case-dump/mbdump/`, no `.tar.bz2` on disk. Expect this to take a long time (download plus single-threaded bzip2).

- [ ] **Step 3: Fetch and convert the ListenBrainz popularity data**

```bash
cd ~/album-case-dump
curl -o popularity.json "https://datasets.listenbrainz.org/popular-releases-by-listeners/json"
head -c 300 popularity.json; echo
```
If it's a JSON array, convert:
```bash
python3 -c "
import json
with open('popularity.json') as f:
    records = json.load(f)
with open('popularity.jsonl', 'w') as out:
    for r in records:
        out.write(json.dumps(r) + '\n')
"
head -1 popularity.jsonl
```
Expected: the first record has a release-group MBID key and a listener-count key matching one of the pinned names in `pipeline/ingest_listenbrainz.py`. If not, stop: every record would be skipped.

- [ ] **Step 4: Run and verify the pipeline**

From the repo root:
```bash
~/.venvs/album-case/bin/python pipeline/build.py --mbdump-dir ~/album-case-dump/mbdump --popularity ~/album-case-dump/popularity.jsonl --db data/tastetest.db
~/.venvs/album-case/bin/python pipeline/build.py --verify --mbdump-dir ~/album-case-dump/mbdump --popularity ~/album-case-dump/popularity.jsonl --db data/tastetest.db
```
Expected: per-step counts with few skipped lines relative to loaded, and a verify report with a total in the tens to hundreds of thousands.

- [ ] **Step 5: Dry-run the load and report to Keith**

```bash
node web/scripts/load-catalog.mjs --db data/tastetest.db
du -sh data/tastetest.db
```
Expected: JSON with `mode: dry-run`, total albums, Album/EP split, 5 sample rows. Give Keith these numbers, and spot-check that 3 albums he'd expect (e.g. OK Computer, a well-known EP) are present:
```bash
sqlite3 data/tastetest.db "SELECT title, primary_artist_name, release_type, notability_score FROM entities WHERE title IN ('OK Computer', 'Come On Pilgrim') LIMIT 5"
```
STOP here until Keith has seen the numbers.

---

### Task 8: Go live (every step needs Keith's approval at the time)

- [ ] **Step 1: [Keith approves] Pull Turso credentials**

```bash
cd web && git check-ignore .env.local && vercel env pull .env.local --environment=production
```
Expected: `git check-ignore` prints `.env.local` (so it can't be committed), then the pull succeeds. Never print the file's contents.

- [ ] **Step 2: [Keith approves] Probe FTS5 on production Turso**

Create a scratch script outside the repo (e.g. in the session scratchpad) and run it with `node --env-file=<repo>/web/.env.local`:

```js
import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const t = `fts5_probe_${Date.now()}`;
try {
  await c.execute(`CREATE VIRTUAL TABLE ${t} USING fts5(title, tokenize='unicode61 remove_diacritics 2')`);
  await c.execute({ sql: `INSERT INTO ${t}(title) VALUES (?)`, args: ['Homogénic'] });
  const r = await c.execute({ sql: `SELECT title FROM ${t} WHERE ${t} MATCH ?`, args: ['"homog"*'] });
  console.log('FTS5 OK', r.rows.length === 1);
} finally {
  await c.execute(`DROP TABLE IF EXISTS ${t}`);
}
```
Expected: `FTS5 OK true`. If it throws or prints false: STOP. The spec's fallback (a `search_key` column with prefix `LIKE`) is a design change to Tasks 2 and 3; bring it back to Keith before doing anything else.

- [ ] **Step 3: [Keith approves, after seeing Task 7's numbers] Load the catalog**

```bash
node --env-file=web/.env.local web/scripts/load-catalog.mjs --db data/tastetest.db --write
```
Expected: progress lines, then `mode: write` with `written` equal to `albums`.

- [ ] **Step 4: [Keith approves] Add the cron secret**

```bash
cd web && openssl rand -hex 32 | vercel env add CRON_SECRET production
```
Expected: Vercel confirms the variable was added. Don't echo the value.

- [ ] **Step 5: [Keith approves] Deploy and confirm it's live**

```bash
cd web && npm run build && vercel deploy --prod --yes
curl -s https://album-case.vercel.app/ | grep -o 'assets/index-[^"]*\.js'
ls dist/assets/ | grep '^index-.*\.js$'
```
Expected: the live bundle name matches the local build. If Vercel rejects `maxDuration: 60` or the cron on this plan, stop and bring the error to Keith (the spec's fallback is running the refresh weekly from the Mac via `cron-hardened`).

- [ ] **Step 6: Measure search latency**

```bash
for q in "kid a" "blue lines" "homogenic" "loveless" "illmatic"; do
  curl -s -o /dev/null -w "%{time_total}s  $q\n" "https://album-case.vercel.app/api/search-album?q=$(printf %s "$q" | sed 's/ /%20/g')&cb=$RANDOM"
done
```
Expected: median under 300ms (was 400-800ms). The `cb` parameter defeats the edge cache without touching `q` (a junk word in `q` would miss the catalog and time the MusicBrainz path instead). If the timings look like MusicBrainz, confirm the edge cache key includes `cb`. Report the numbers to Keith.

- [ ] **Step 7: [Keith approves] Run the weekly job once by hand**

```bash
cd web && vercel env pull .env.cron --environment=production >/dev/null && \
  SECRET=$(grep '^CRON_SECRET=' .env.cron | cut -d= -f2- | tr -d '"') && \
  curl -s -H "Authorization: Bearer $SECRET" https://album-case.vercel.app/api/cron/refresh-catalog; \
  rm -f .env.cron
```
Expected: JSON like `{"scanned":…,"kept":…,"added":…,"pages":…,"partial":false}` within 60s. If `partial` is true because `MAX_PAGES` was hit, report it to Keith (the fix is a longer window split or the Mac fallback).

- [ ] **Step 8: Wrap up**

Update `HANDOFF.md` (catalog live, row count, measured latency, cron status, anything deferred) and commit it with the attribution lines. Delete `~/album-case-dump` only if Keith agrees (it's a few GB and only needed for the next full refresh).
