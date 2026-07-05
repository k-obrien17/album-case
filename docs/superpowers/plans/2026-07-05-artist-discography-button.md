# Artist Discography Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button on every ranked row that discovers, persists, and queues an artist's other studio albums (LPs) so the player can rank the rest of that artist's catalog beyond the curated 115-album seed.

**Architecture:** One new Turso table (`discovered_albums`) stores full album records per artist, mirroring how `ranking_snapshots` already stores full records for seed-independence. One endpoint (`web/api/discover-artist.ts`) does both a cheap "what have I already found" read (GET) and the live MusicBrainz-backed discovery + persistence (POST). The client merges discovered albums into the in-memory candidate pool at startup and again after every successful discovery, so from the app's point of view a discovered album is indistinguishable from a seed album.

**Tech Stack:** TypeScript, Vercel serverless functions (`@vercel/node`), `@libsql/client` (Turso), Vitest. No new dependencies — MusicBrainz is called with the platform `fetch`, same as the rest of this codebase.

## Global Constraints

- File size cap: 300 lines per file.
- No comments except where they explain non-obvious WHY, not WHAT.
- Colocate tests as `<name>.test.ts` next to the source file.
- Timestamps in milliseconds (`Date.now()`), not seconds.
- `web/api/*.ts` files are self-contained (not part of `tsconfig.json`'s `include: ["src"]`, bundled independently by Vercel) and by existing convention duplicate small local types rather than importing from `web/src/` (see `ranking.ts`'s local `Album` type) — new API code follows this, it does not start importing across the `api`/`src` boundary.
- `web/api/*.ts` handlers are I/O glue and are not unit-tested, matching this project's existing pattern (no test file exists for `atom.ts` or `ranking.ts` today); only the pure logic extracted into a dedicated module gets a colocated test.
- This feature makes one live MusicBrainz call from the running app — a deliberate, documented exception to `DATA-SOURCES.md`'s "don't query a live vendor catalog" rule. See the design spec for the reasoning; no task here should "fix" this by trying to route it through an offline pipeline instead.
- MusicBrainz politeness: identify with a `User-Agent` header on every call (same string `build-seed.py` uses).
- Spec: `docs/superpowers/specs/2026-07-05-artist-discography-button-design.md`.

---

### Task 1: `discovered_albums` schema

**Files:**
- Modify: `web/api/_schema.ts`

**Interfaces:**
- Produces: `CREATE_DISCOVERED_ALBUMS_TABLE` added to the exported `SCHEMA_STATEMENTS` array, consumed by Task 3's `ensureSchema()` and Task 4's `atom.ts`.

No test for this step — it is a static SQL string, matching the fact that no other table definition in this file has a test either.

- [ ] **Step 1: Add the table definition**

In `web/api/_schema.ts`, the file currently ends with:

```ts
export const CREATE_RANKING_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS ranking_snapshots (
    session_id TEXT PRIMARY KEY,
    ranking_json TEXT NOT NULL,
    lists_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

export const SCHEMA_STATEMENTS = [
  CREATE_ATOMS_TABLE,
  CREATE_SESSIONS_TABLE,
  CREATE_ATOMS_SESSION_INDEX,
  CREATE_ATOMS_MECHANISM_INDEX,
  CREATE_RANKING_SNAPSHOTS_TABLE,
];
```

Replace with:

```ts
export const CREATE_RANKING_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS ranking_snapshots (
    session_id TEXT PRIMARY KEY,
    ranking_json TEXT NOT NULL,
    lists_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

// Full album records discovered via live MusicBrainz lookup (see
// web/api/discover-artist.ts), keyed like the rest of this schema by
// session_id (in practice always the single OWNER_ID). Stored in full --
// not just mbids -- for the same reason as ranking_snapshots: the app must
// be able to render/rank these without depending on the static seed file.
export const CREATE_DISCOVERED_ALBUMS_TABLE = `
CREATE TABLE IF NOT EXISTS discovered_albums (
    session_id TEXT NOT NULL,
    mbid TEXT NOT NULL,
    title TEXT NOT NULL,
    primary_artist_name TEXT NOT NULL,
    release_year INTEGER,
    cover_url TEXT NOT NULL,
    discovered_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, mbid)
);
`;

export const SCHEMA_STATEMENTS = [
  CREATE_ATOMS_TABLE,
  CREATE_SESSIONS_TABLE,
  CREATE_ATOMS_SESSION_INDEX,
  CREATE_ATOMS_MECHANISM_INDEX,
  CREATE_RANKING_SNAPSHOTS_TABLE,
  CREATE_DISCOVERED_ALBUMS_TABLE,
];
```

- [ ] **Step 2: Run the build to verify no syntax errors**

Run: `cd web && npm run build`
Expected: succeeds (this file has no logic to break, just confirms valid TS/template-literal syntax).

- [ ] **Step 3: Commit**

```bash
git add web/api/_schema.ts
git commit -m "feat: add discovered_albums table schema"
```

---

### Task 2: Pure LP-filter and merge helpers

**Files:**
- Create: `web/api/_lp.ts`
- Test: `web/api/_lp.test.ts`

**Interfaces:**
- Produces: `export type ReleaseGroup`, `export function isLpReleaseGroup(group: ReleaseGroup): boolean`, `export type DiscoveredAlbum = { mbid: string; title: string; primary_artist_name: string; release_year: number | null; cover_url: string }`, `export function mergeDiscovered(previouslyUnranked: DiscoveredAlbum[], newlyDiscovered: DiscoveredAlbum[]): DiscoveredAlbum[]`. Consumed by Task 3 (`web/api/discover-artist.ts`).

- [ ] **Step 1: Write the failing tests**

Create `web/api/_lp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isLpReleaseGroup, mergeDiscovered, type ReleaseGroup, type DiscoveredAlbum } from './_lp';

function group(overrides: Partial<ReleaseGroup> = {}): ReleaseGroup {
  return { id: 'x', title: 'Title', 'primary-type': 'Album', ...overrides };
}

describe('isLpReleaseGroup', () => {
  it('accepts a plain Album release-group with no secondary types', () => {
    expect(isLpReleaseGroup(group())).toBe(true);
  });

  it('rejects a non-Album primary type', () => {
    expect(isLpReleaseGroup(group({ 'primary-type': 'EP' }))).toBe(false);
  });

  it('rejects an Album with a secondary type (e.g. Compilation)', () => {
    expect(isLpReleaseGroup(group({ 'secondary-types': ['Compilation'] }))).toBe(false);
  });

  it('rejects a release-group with a missing primary type', () => {
    expect(isLpReleaseGroup(group({ 'primary-type': undefined }))).toBe(false);
  });
});

function album(mbid: string): DiscoveredAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: 'Artist',
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('mergeDiscovered', () => {
  it('concatenates previously-unranked and newly-discovered', () => {
    const result = mergeDiscovered([album('a')], [album('b')]);
    expect(result.map((a) => a.mbid)).toEqual(['a', 'b']);
  });

  it('dedupes by mbid, keeping the first occurrence', () => {
    const result = mergeDiscovered([album('a')], [album('a')]);
    expect(result).toEqual([album('a')]);
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeDiscovered([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run api/_lp.test.ts`
Expected: FAIL — `Cannot find module './_lp'`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/api/_lp.ts`:

```ts
export type ReleaseGroup = {
  id: string;
  title: string;
  'first-release-date'?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
};

/** An "LP": MusicBrainz primary-type Album with no secondary types (excludes
 * Compilation/Live/Remix/Soundtrack/etc.) -- the same rule build-seed.py
 * already applies when resolving the curated seed. */
export function isLpReleaseGroup(group: ReleaseGroup): boolean {
  return group['primary-type'] === 'Album' && (group['secondary-types']?.length ?? 0) === 0;
}

export type DiscoveredAlbum = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  release_year: number | null;
  cover_url: string;
};

/** Previously-discovered-but-unranked union newly-discovered-this-click,
 * deduped by mbid (first occurrence wins). */
export function mergeDiscovered(
  previouslyUnranked: DiscoveredAlbum[],
  newlyDiscovered: DiscoveredAlbum[]
): DiscoveredAlbum[] {
  const seen = new Set<string>();
  const merged: DiscoveredAlbum[] = [];
  for (const album of [...previouslyUnranked, ...newlyDiscovered]) {
    if (seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    merged.push(album);
  }
  return merged;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run api/_lp.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add web/api/_lp.ts web/api/_lp.test.ts
git commit -m "feat: add LP-qualifying filter and discovered-album merge helpers"
```

---

### Task 3: `discover-artist` endpoint

**Files:**
- Create: `web/api/discover-artist.ts`

**Interfaces:**
- Consumes: `SCHEMA_STATEMENTS` from `./_schema.js` (Task 1); `isLpReleaseGroup`, `mergeDiscovered`, `ReleaseGroup`, `DiscoveredAlbum` from `./_lp.js` (Task 2).
- Produces: `GET /api/discover-artist?session_id=<uuid>` → `{ albums: DiscoveredAlbum[] }` (everything previously discovered for that session, any artist). `POST /api/discover-artist` with body `{ session_id, artist_name, known_mbids }` → `{ albums: DiscoveredAlbum[] }` (previously-discovered-unranked ∪ newly-discovered, for that one artist). Consumed by Task 5 (`web/src/discovery.ts`).

No unit test for this file (I/O glue — MusicBrainz + Turso — matching `atom.ts`/`ranking.ts`, neither of which has one). Verified via the manual step below against a local `vercel dev` with Turso env vars set.

- [ ] **Step 1: Write the endpoint**

Create `web/api/discover-artist.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import { SCHEMA_STATEMENTS } from './_schema.js';
import { isLpReleaseGroup, mergeDiscovered, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';

function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

type DiscoverBody = {
  session_id?: unknown;
  artist_name?: unknown;
  known_mbids?: unknown;
};

let schemaReady: Promise<void> | null = null;

function db(): ReturnType<typeof createClient> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('missing_turso_env');
  return createClient({ url, authToken });
}

function ensureSchema(): Promise<void> {
  const client = db();
  schemaReady ??= (async () => {
    for (const sql of SCHEMA_STATEMENTS) {
      await client.execute(sql);
    }
  })();
  return schemaReady;
}

function parseBody(req: VercelRequest): DiscoverBody | null {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as DiscoverBody;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === 'object') return req.body as DiscoverBody;
  return null;
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isKnownMbids(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && UUID_RE.test(v));
}

function validatePost(body: DiscoverBody | null):
  | { ok: true; sessionId: string; artistName: string; knownMbids: string[] }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };
  if (!isSessionId(body.session_id)) return { ok: false, message: 'invalid_session' };
  if (typeof body.artist_name !== 'string' || !body.artist_name.trim()) {
    return { ok: false, message: 'invalid_artist_name' };
  }
  if (!isKnownMbids(body.known_mbids)) return { ok: false, message: 'invalid_known_mbids' };
  return {
    ok: true,
    sessionId: body.session_id,
    artistName: body.artist_name,
    knownMbids: body.known_mbids,
  };
}

function releaseYear(group: ReleaseGroup): number | null {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

async function fetchArtistId(artistName: string): Promise<string | null> {
  const params = new URLSearchParams({ query: `artist:"${artistName}"`, fmt: 'json', limit: '1' });
  const res = await fetch(`${MB_BASE}/artist/?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`musicbrainz_artist_search_${res.status}`);
  const data = (await res.json()) as { artists?: Array<{ id: string }> };
  return data.artists?.[0]?.id ?? null;
}

async function fetchArtistLps(artistId: string, artistName: string): Promise<DiscoveredAlbum[]> {
  const params = new URLSearchParams({ artist: artistId, type: 'album', limit: '100', fmt: 'json' });
  const res = await fetch(`${MB_BASE}/release-group?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`musicbrainz_browse_${res.status}`);
  const data = (await res.json()) as { 'release-groups'?: ReleaseGroup[] };
  const groups = data['release-groups'] ?? [];
  return groups.filter(isLpReleaseGroup).map((group) => ({
    mbid: group.id,
    title: group.title,
    primary_artist_name: artistName,
    release_year: releaseYear(group),
    cover_url: coverUrlFor(group.id),
  }));
}

function rowToAlbum(row: Record<string, unknown>): DiscoveredAlbum {
  return {
    mbid: String(row.mbid),
    title: String(row.title),
    primary_artist_name: String(row.primary_artist_name),
    release_year: row.release_year == null ? null : Number(row.release_year),
    cover_url: String(row.cover_url),
  };
}

async function discoveredForSession(
  client: ReturnType<typeof createClient>,
  sessionId: string
): Promise<DiscoveredAlbum[]> {
  const rows = await client.execute({
    sql: `
SELECT mbid, title, primary_artist_name, release_year, cover_url
FROM discovered_albums
WHERE session_id = ?
`,
    args: [sessionId],
  });
  return rows.rows.map((row) => rowToAlbum(row as unknown as Record<string, unknown>));
}

async function discoveredForArtist(
  client: ReturnType<typeof createClient>,
  sessionId: string,
  artistName: string
): Promise<DiscoveredAlbum[]> {
  const rows = await client.execute({
    sql: `
SELECT mbid, title, primary_artist_name, release_year, cover_url
FROM discovered_albums
WHERE session_id = ? AND primary_artist_name = ?
`,
    args: [sessionId, artistName],
  });
  return rows.rows.map((row) => rowToAlbum(row as unknown as Record<string, unknown>));
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!isSessionId(sessionId)) {
    res.status(400).json({ error: 'invalid_session' });
    return;
  }

  await ensureSchema();
  const albums = await discoveredForSession(db(), sessionId);
  res.status(200).json({ albums });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const validated = validatePost(parseBody(req));
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  await ensureSchema();
  const client = db();
  const known = new Set(validated.knownMbids);

  const previouslyUnranked = await discoveredForArtist(client, validated.sessionId, validated.artistName);

  const artistId = await fetchArtistId(validated.artistName);
  let newlyDiscovered: DiscoveredAlbum[] = [];
  if (artistId) {
    const lps = await fetchArtistLps(artistId, validated.artistName);
    newlyDiscovered = lps.filter((album) => !known.has(album.mbid));
  }

  if (newlyDiscovered.length > 0) {
    const now = Date.now();
    await client.batch(
      newlyDiscovered.map((album) => ({
        sql: `
INSERT INTO discovered_albums
  (session_id, mbid, title, primary_artist_name, release_year, cover_url, discovered_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, mbid) DO NOTHING
`,
        args: [
          validated.sessionId,
          album.mbid,
          album.title,
          album.primary_artist_name,
          album.release_year,
          album.cover_url,
          now,
        ],
      }))
    );
  }

  res.status(200).json({ albums: mergeDiscovered(previouslyUnranked, newlyDiscovered) });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      await handleGet(req, res);
      return;
    }
    if (req.method === 'POST') {
      await handlePost(req, res);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch {
    schemaReady = null;
    res.status(500).json({ error: 'discover_error' });
  }
}
```

- [ ] **Step 2: Run the build to verify type-correctness**

Run: `cd web && npm run build`
Expected: succeeds. (Note: `npm run build` runs `tsc` over `src` only per `tsconfig.json`'s `include`; this step mainly guards against breaking the overall build. Full type-checking of `api/*.ts` happens implicitly at Vercel deploy time, matching how `atom.ts`/`ranking.ts` are checked today.)

- [ ] **Step 3: Manual verification**

This needs live MusicBrainz + a real Turso database, so it's a manual check, not an automated test:

Run: `cd web && vercel dev` (requires `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` in `.env.local`, same as the existing `ranking`/`atom` endpoints).

Then, in another terminal:
```bash
curl -s -X POST http://localhost:3000/api/discover-artist \
  -H 'content-type: application/json' \
  -d '{"session_id":"c0ffee00-0000-4000-8000-000000000001","artist_name":"Radiohead","known_mbids":[]}' | head -c 2000
```
Expected: a 200 response with `{"albums": [...]}` listing Radiohead LPs (e.g. "The Bends", "Hail to the Thief") with real MBIDs, titles, years, and cover_url pointers.

Then:
```bash
curl -s "http://localhost:3000/api/discover-artist?session_id=c0ffee00-0000-4000-8000-000000000001"
```
Expected: `{"albums": [...]}` containing the same Radiohead albums just persisted (proves the GET path reads back what POST wrote).

- [ ] **Step 4: Commit**

```bash
git add web/api/discover-artist.ts
git commit -m "feat: add discover-artist endpoint (list + live MusicBrainz discovery)"
```

---

### Task 4: Extend the atom allowlist to cover discovered albums

**Files:**
- Modify: `web/api/atom.ts`

**Interfaces:**
- Consumes: the `discovered_albums` table from Task 1 (queried directly by SQL, no shared helper needed).
- No exported interface changes; `handler`'s external behavior gains one more source of "known mbid," everything else about the endpoint (request/response shape) is unchanged.

No unit test for this file (matches the project's existing convention — `atom.ts` has no test file today). Verified by the manual step below.

- [ ] **Step 1: Make the mbid check DB-aware**

`web/api/atom.ts` currently validates synchronously against only the static allowlist:

```ts
function isAllowedMbid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value) && allowedMbids.has(value);
}
```

and `validate()` calls `isAllowedMbid` directly. Split the UUID-shape check from the "is it a known album" check, and make the latter async so it can also query `discovered_albums`:

Replace:

```ts
function isAllowedMbid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value) && allowedMbids.has(value);
}
```

with:

```ts
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

async function isKnownMbid(mbid: string, client: ReturnType<typeof createClient>): Promise<boolean> {
  if (allowedMbids.has(mbid)) return true;
  const rows = await client.execute({
    sql: 'SELECT 1 FROM discovered_albums WHERE mbid = ? LIMIT 1',
    args: [mbid],
  });
  return rows.rows.length > 0;
}
```

- [ ] **Step 2: Split structural validation from the DB-backed check**

`validate()` currently does both format and allowlist checking in one synchronous pass:

```ts
function validate(body: AtomBody | null):
  | { ok: true; entityA: string; entityB: string; winner: string; sessionId: string }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };

  const { entity_a: entityA, entity_b: entityB, winner, session_id: sessionId } = body;
  if (!isAllowedMbid(entityA) || !isAllowedMbid(entityB) || !isAllowedMbid(winner)) {
    return { ok: false, message: 'invalid_entity' };
  }
  if (entityA === entityB) return { ok: false, message: 'same_entity' };
  if (winner !== entityA && winner !== entityB) return { ok: false, message: 'invalid_winner' };
  if (!isSessionId(sessionId)) return { ok: false, message: 'invalid_session' };

  return { ok: true, entityA, entityB, winner, sessionId };
}
```

Replace with a structural-only check (format, distinctness, winner-is-one-of), leaving the "is it a real/known album" check for after a DB client exists:

```ts
function validate(body: AtomBody | null):
  | { ok: true; entityA: string; entityB: string; winner: string; sessionId: string }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };

  const { entity_a: entityA, entity_b: entityB, winner, session_id: sessionId } = body;
  if (!isUuid(entityA) || !isUuid(entityB) || !isUuid(winner)) {
    return { ok: false, message: 'invalid_entity' };
  }
  if (entityA === entityB) return { ok: false, message: 'same_entity' };
  if (winner !== entityA && winner !== entityB) return { ok: false, message: 'invalid_winner' };
  if (!isSessionId(sessionId)) return { ok: false, message: 'invalid_session' };

  return { ok: true, entityA, entityB, winner, sessionId };
}
```

- [ ] **Step 3: Check known-ness inside the handler, after `ensureSchema`/`db()` exist**

The handler currently reads:

```ts
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const validated = validate(parseBody(req));
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  try {
    await ensureSchema();
    const client = db();
    const now = Date.now();
```

Insert a known-mbid check right after `const client = db();`:

```ts
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const validated = validate(parseBody(req));
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  try {
    await ensureSchema();
    const client = db();

    const [aKnown, bKnown] = await Promise.all([
      isKnownMbid(validated.entityA, client),
      isKnownMbid(validated.entityB, client),
    ]);
    if (!aKnown || !bKnown) {
      res.status(400).json({ error: 'invalid_entity' });
      return;
    }

    const now = Date.now();
```

(The rest of the `try` block — the `client.batch([...])` insert and `res.status(201).json(...)` — is unchanged.)

- [ ] **Step 4: Run the build to verify type-correctness**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual verification**

With `vercel dev` running (from Task 3's Step 3) and a Radiohead album already discovered via that step's curl command, note one of the returned mbids, then:

```bash
curl -s -X POST http://localhost:3000/api/atom \
  -H 'content-type: application/json' \
  -d '{"entity_a":"<a-known-seed-mbid>","entity_b":"<the-discovered-mbid>","winner":"<a-known-seed-mbid>","session_id":"11111111-1111-4111-8111-111111111111"}'
```
Expected: `{"ok":true}` with a 201 — a discovered album's mbid is now accepted where it would previously have failed with `invalid_entity`.

- [ ] **Step 6: Commit**

```bash
git add web/api/atom.ts
git commit -m "fix: accept discovered-album mbids in atom recording"
```

---

### Task 5: Client discovery functions

**Files:**
- Create: `web/src/discovery.ts`
- Test: `web/src/discovery.test.ts`

**Interfaces:**
- Consumes: `Album` type from `./ranking/types` (already defined; matches the shape returned by Task 3's endpoint).
- Produces: `export async function loadDiscoveredAlbums(sessionId: string): Promise<Album[]>` and `export async function discoverArtist(sessionId: string, artistName: string, knownMbids: string[]): Promise<Album[]>`, consumed by Task 7 (`web/src/main.ts`).

- [ ] **Step 1: Write the failing tests**

Create `web/src/discovery.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import { discoverArtist, loadDiscoveredAlbums } from './discovery';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: 'Radiohead',
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('loadDiscoveredAlbums', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the albums from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ albums: [album('a')] }),
      } as unknown as Response)
    );

    const result = await loadDiscoveredAlbums('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([album('a')]);
  });

  it('returns an empty array on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await loadDiscoveredAlbums('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([]);
  });

  it('returns an empty array on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as unknown as Response));

    const result = await loadDiscoveredAlbums('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([]);
  });
});

describe('discoverArtist', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the artist name and known mbids, returns the albums', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ albums: [album('b')] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverArtist('11111111-1111-4111-8111-111111111111', 'Radiohead', ['a']);

    expect(result).toEqual([album('b')]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/discover-artist',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          session_id: '11111111-1111-4111-8111-111111111111',
          artist_name: 'Radiohead',
          known_mbids: ['a'],
        }),
      })
    );
  });

  it('returns an empty array on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await discoverArtist('11111111-1111-4111-8111-111111111111', 'Radiohead', []);

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/discovery.test.ts`
Expected: FAIL — `Cannot find module './discovery'`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/discovery.ts`:

```ts
import type { Album } from './ranking/types';

function asAlbumArray(value: unknown): Album[] {
  return Array.isArray(value) ? (value as Album[]) : [];
}

/** Everything already discovered for this session, across all artists. Used
 * at startup to merge into the in-memory pool alongside the static seed. */
export async function loadDiscoveredAlbums(sessionId: string): Promise<Album[]> {
  let response: Response;
  try {
    response = await fetch(`/api/discover-artist?session_id=${encodeURIComponent(sessionId)}`);
  } catch {
    return [];
  }
  if (!response.ok) return [];

  try {
    const body = (await response.json()) as { albums?: unknown };
    return asAlbumArray(body.albums);
  } catch {
    return [];
  }
}

/** Discover (and persist) one artist's other LPs. `knownMbids` is every mbid
 * the client already has for that artist, so the server can skip
 * re-persisting or re-returning them. */
export async function discoverArtist(
  sessionId: string,
  artistName: string,
  knownMbids: string[]
): Promise<Album[]> {
  let response: Response;
  try {
    response = await fetch('/api/discover-artist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        artist_name: artistName,
        known_mbids: knownMbids,
      }),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  try {
    const body = (await response.json()) as { albums?: unknown };
    return asAlbumArray(body.albums);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/discovery.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/discovery.ts web/src/discovery.test.ts
git commit -m "feat: add client functions for artist discography discovery"
```

---

### Task 6: Discover button and status message in `rankList.ts`

**Files:**
- Modify: `web/src/ui/rankList.ts` (options type, `buildRow`, `render`, `RankListController`, add a status-display mechanism)
- Modify: `web/src/style.css` (button + status styling)

**Interfaces:**
- Consumes: nothing new (uses `Album` already imported).
- Produces: `RankListOptions.onDiscoverArtist?: (album: Album) => void` and `RankListController.showStatus: (message: string) => void`, both consumed by Task 7 (`web/src/main.ts`).

No dedicated unit test (DOM wiring, same reasoning as Task 2 of the companion rank-badges plan). Verified manually.

- [ ] **Step 1: Add `onDiscoverArtist` to the options type**

In `web/src/ui/rankList.ts`, `RankListOptions` currently ends with:

```ts
  /** Record a single assisted this-or-that answer as a pairwise atom. */
  onCompare?: (winnerMbid: string, loserMbid: string) => void;
};
```

Change to:

```ts
  /** Record a single assisted this-or-that answer as a pairwise atom. */
  onCompare?: (winnerMbid: string, loserMbid: string) => void;
  /** Discover and queue the rest of this album's artist's other LPs. */
  onDiscoverArtist?: (album: Album) => void;
};
```

- [ ] **Step 2: Add the discover button to `buildRow`**

`buildRow` currently ends with (after the Task 2-of-the-companion-plan change, or the original if that plan hasn't run yet -- either way the grip button and final `li.append` are unaffected by that other plan):

```ts
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'rank-grip';
    grip.setAttribute('aria-label', `Reorder ${album.title}`);
    grip.textContent = '⇅';
    grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));

    li.append(num, meta, grip);
    return li;
  }
```

Change to:

```ts
    const discoverBtn = document.createElement('button');
    discoverBtn.type = 'button';
    discoverBtn.className = 'rank-discover';
    discoverBtn.setAttribute('aria-label', `Rank the rest of ${album.primary_artist_name}'s albums`);
    discoverBtn.textContent = '▶';
    discoverBtn.addEventListener('click', () => opts.onDiscoverArtist?.(album));

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'rank-grip';
    grip.setAttribute('aria-label', `Reorder ${album.title}`);
    grip.textContent = '⇅';
    grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));

    li.append(num, meta, discoverBtn, grip);
    return li;
  }
```

- [ ] **Step 3: Add a one-shot status message to the controller**

In `web/src/ui/rankList.ts`, find the controller-state declarations near the top of `mountRankList` (currently):

```ts
  let drag: DragState | null = null;
  let scrollRaf = 0;
  let scrollDir = 0;
```

Add a status variable:

```ts
  let drag: DragState | null = null;
  let scrollRaf = 0;
  let scrollDir = 0;
  let statusMessage: string | null = null;
```

- [ ] **Step 4: Display and clear the status message in `render()`**

In `render()`, right after the `layout` element is created:

```ts
    const layout = document.createElement('div');
    layout.className = 'rank-layout';
```

add the status display, clearing it immediately after so it shows for exactly one render:

```ts
    const layout = document.createElement('div');
    layout.className = 'rank-layout';

    if (statusMessage) {
      const status = document.createElement('p');
      status.className = 'rank-status';
      status.textContent = statusMessage;
      layout.append(status);
      statusMessage = null;
    }
```

- [ ] **Step 5: Expose `showStatus` from the controller**

`RankListController` type currently reads:

```ts
export type RankListController = {
  render: () => void;
  teardown: () => void;
};
```

Change to:

```ts
export type RankListController = {
  render: () => void;
  teardown: () => void;
  showStatus: (message: string) => void;
};
```

And the function's final `return` statement, currently:

```ts
  render();
  return { render, teardown };
}
```

Change to:

```ts
  function showStatus(message: string): void {
    statusMessage = message;
    render();
  }

  render();
  return { render, teardown, showStatus };
}
```

- [ ] **Step 6: Add CSS for the button and status line**

In `web/src/style.css`, after the existing `.rank-grip:hover` rule:

```css
.rank-grip:hover {
  background: var(--color-bg-alt);
  color: var(--color-fg);
}
```

add:

```css
.rank-discover {
  flex-shrink: 0;
  width: 44px;
  min-height: 44px;
  border: 1px solid var(--color-border-btn);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 1rem;
  cursor: pointer;
}

.rank-discover:hover {
  background: var(--color-bg-alt);
  color: var(--color-fg);
}

.rank-status {
  margin: 0 0 8px;
  padding: 8px;
  color: var(--color-muted);
  font-size: 0.85rem;
}
```

- [ ] **Step 7: Run the build to verify type-correctness**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 8: Run the full test suite to check for regressions**

Run: `cd web && npm run test`
Expected: PASS, no failures (this task doesn't touch any tested pure module).

- [ ] **Step 9: Commit**

```bash
git add web/src/ui/rankList.ts web/src/style.css
git commit -m "feat: add discover-artist button and status line to ranked rows"
```

---

### Task 7: Wire discovery into `main.ts`

**Files:**
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `loadDiscoveredAlbums`, `discoverArtist` from `./discovery` (Task 5); `onDiscoverArtist`, `showStatus` from `./ui/rankList` (Task 6).
- No new exports; this task only changes `main()`'s internal wiring.

No dedicated unit test for this step, matching `main.ts`'s existing pattern: its exported pure functions (`resolveInitialState`, `restoreFromCode`) are tested in `main.test.ts`, but the imperative `main()` function itself (DOM mounting, event wiring) is not, and this task only touches `main()`. Verified manually.

- [ ] **Step 1: Import the new client functions**

In `web/src/main.ts`, change:

```ts
import { loadRankingSnapshot, saveRankingSnapshot } from './rankingSync';
```

to:

```ts
import { loadRankingSnapshot, saveRankingSnapshot } from './rankingSync';
import { loadDiscoveredAlbums, discoverArtist } from './discovery';
```

- [ ] **Step 2: Merge previously-discovered albums into the pool at startup**

`main()` currently loads the pool and then (later) the server ranking snapshot:

```ts
  const pool = await loadSeedPool();
```

... (other code) ...

```ts
  const serverSnapshot = await loadRankingSnapshot(OWNER_ID);
```

Change `const pool = await loadSeedPool();` to `const pool = await loadSeedPool();` (unchanged), and immediately after the `const serverSnapshot = await loadRankingSnapshot(OWNER_ID);` line, add:

```ts
  const serverSnapshot = await loadRankingSnapshot(OWNER_ID);
  const discovered = await loadDiscoveredAlbums(OWNER_ID);
  const knownPoolIds = new Set(pool.map((album) => album.mbid));
  for (const album of discovered) {
    if (!knownPoolIds.has(album.mbid)) {
      pool.push(album);
      knownPoolIds.add(album.mbid);
    }
  }
```

(This runs before `reselectCandidate()` is ever called — the first call is later in `main()` — so every discovered album is already part of `pool` by the time candidate selection starts.)

- [ ] **Step 3: Add the discovery handler**

Somewhere in `main()` alongside the other function declarations (e.g. right after `function persistLists()`), add:

```ts
  async function handleDiscoverArtist(album: Album): Promise<void> {
    const artistName = album.primary_artist_name;
    const knownMbids = pool
      .filter((a) => a.primary_artist_name === artistName)
      .map((a) => a.mbid);

    const found = await discoverArtist(session.session_id, artistName, knownMbids);
    if (found.length === 0) {
      rankList.showStatus(`No more ${artistName} albums found.`);
      return;
    }

    const knownPoolIds = new Set(pool.map((a) => a.mbid));
    const newToPool = found.filter((a) => !knownPoolIds.has(a.mbid));
    pool.push(...newToPool);

    priorityQueue = [...found.map((a) => a.mbid), ...priorityQueue];
    savePriorityQueue(priorityQueue);
    reselectCandidate();
    rankList.render();
  }
```

- [ ] **Step 4: Wire it into `mountRankList`**

`mountRankList`'s options object currently ends with:

```ts
    onCompare: (winnerMbid, loserMbid) => {
      enqueueAtom({
        entity_a: winnerMbid,
        entity_b: loserMbid,
        winner: winnerMbid,
        session_id: session.session_id,
      });
    },
  });
```

Change to:

```ts
    onCompare: (winnerMbid, loserMbid) => {
      enqueueAtom({
        entity_a: winnerMbid,
        entity_b: loserMbid,
        winner: winnerMbid,
        session_id: session.session_id,
      });
    },
    onDiscoverArtist: (album) => {
      void handleDiscoverArtist(album);
    },
  });
```

(`handleDiscoverArtist` is a hoisted function declaration, so this works even though it's defined after `mountRankList` is called, the same way `reselectCandidate` and `persistRankingState` are already used before their point of declaration elsewhere in this file.)

- [ ] **Step 5: Run the build to verify type-correctness**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `cd web && npm run test`
Expected: PASS, no failures.

- [ ] **Step 7: Manual verification (end-to-end)**

Run: `cd web && vercel dev` (needs `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` set, same as Task 3).

In the browser: open the ranked list, find a row for an artist with more albums than the seed includes (e.g. Radiohead), click its "▶" button.
Expected: the next candidate shown becomes one of that artist's other LPs (e.g. "The Bends"). Reload the page — the same album is still available as a candidate or already ranked (proves the Turso round trip persisted it, and the startup merge in Step 2 picked it back up). Click the button again on an artist whose full MusicBrainz LP catalog is already known — expect the "No more `<artist>` albums found." status line.

- [ ] **Step 8: Commit**

```bash
git add web/src/main.ts
git commit -m "feat: wire artist discography discovery into the ranking loop"
```

---

## Self-Review Notes

- **Spec coverage:** LP definition + artist resolution (Task 3), persistence/schema (Task 1), API shape incl. GET for previously-discovered + POST for discover (Task 3), atom-allowlist extension (Task 4), client integration/pool merge/button/immediate-queue-jump (Tasks 5-7), edge cases -- MB errors caught in `discoverArtist`/`loadDiscoveredAlbums` returning `[]` (Task 5), fully-ranked-artist empty-response status message (Task 7 Step 3), null release_year already handled by `DiscoveredAlbum`'s `number | null` (Task 2) -- all covered.
- **Placeholder scan:** none found.
- **Type consistency:** `DiscoveredAlbum` (Task 2) matches the row shape returned by `discoveredForSession`/`discoveredForArtist` (Task 3) and the `Album` shape consumed in `web/src/discovery.ts` (Task 5) and `main.ts` (Task 7) -- same five fields throughout. `RankListOptions.onDiscoverArtist` (Task 6) matches its call site in `main.ts` (Task 7 Step 4). `RankListController.showStatus` (Task 6) matches its call in `handleDiscoverArtist` (Task 7 Step 3).
- **Deviation from the spec, resolved during planning:** the spec described the persistence column as `owner_id`; renamed to `session_id` in Task 1 for consistency with every other table in `_schema.ts` (all keyed by `session_id`, even though in this single-owner app it always holds `OWNER_ID`). Behavior is identical, only the column name changed.
- **Deviation from the spec, resolved during planning:** the spec described a client-side `loadDiscoveredAlbums()` as a "sibling Turso fetch," implying a possible new dedicated GET endpoint or reuse of `/api/ranking`. Folded instead into the same `discover-artist.ts` file as a GET handler (Task 3), keeping all `discovered_albums`-related server code in one place and leaving `ranking.ts`/`rankingSync.ts` (and their existing tests) untouched.
