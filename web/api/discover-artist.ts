import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import { SCHEMA_STATEMENTS } from './_schema.js';
import { isLpReleaseGroup, mergeDiscovered, browseArtistLps, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';
import { requireWriteKey } from './_writeKey.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DiscoverBody = {
  session_id?: unknown;
  artist_name?: unknown;
  artist_mbid?: unknown;
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
    try {
      await client.execute('ALTER TABLE discovered_albums ADD COLUMN primary_artist_mbid TEXT');
    } catch {
      // Existing deployments may already have this nullable column. libSQL
      // does not need a hard failure for a duplicate-column migration.
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
  | {
      ok: true;
      sessionId: string;
      artistName: string;
      artistMbid: string;
      knownMbids: string[];
    }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };
  if (!isSessionId(body.session_id)) return { ok: false, message: 'invalid_session' };
  if (typeof body.artist_name !== 'string' || !body.artist_name.trim()) {
    return { ok: false, message: 'invalid_artist_name' };
  }
  if (!isSessionId(body.artist_mbid)) return { ok: false, message: 'invalid_artist_mbid' };
  if (!isKnownMbids(body.known_mbids)) return { ok: false, message: 'invalid_known_mbids' };
  return {
    ok: true,
    sessionId: body.session_id,
    artistName: body.artist_name,
    artistMbid: body.artist_mbid,
    knownMbids: body.known_mbids,
  };
}

function rowToAlbum(row: Record<string, unknown>): DiscoveredAlbum {
  return {
    mbid: String(row.mbid),
    title: String(row.title),
    primary_artist_name: String(row.primary_artist_name),
    primary_artist_mbid:
      typeof row.primary_artist_mbid === 'string' ? String(row.primary_artist_mbid) : undefined,
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
SELECT mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url
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
  artistMbid: string
): Promise<DiscoveredAlbum[]> {
  const rows = await client.execute({
    sql: `
SELECT mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url
FROM discovered_albums
WHERE session_id = ? AND primary_artist_mbid = ?
`,
    args: [sessionId, artistMbid],
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
  if (!requireWriteKey(req, res)) return;

  const validated = validatePost(parseBody(req));
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  await ensureSchema();
  const client = db();
  const known = new Set(validated.knownMbids);
  const previouslyUnranked = await discoveredForArtist(
    client,
    validated.sessionId,
    validated.artistMbid
  );

  const lps = await browseArtistLps(validated.artistMbid, validated.artistName);
  const newlyDiscovered = lps.filter((album) => !known.has(album.mbid));

  if (newlyDiscovered.length > 0) {
    const now = Date.now();
    await client.batch(
      newlyDiscovered.map((album) => ({
        sql: `
INSERT INTO discovered_albums
  (session_id, mbid, title, primary_artist_name, primary_artist_mbid, release_year, cover_url, discovered_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, mbid) DO NOTHING
`,
        args: [
          validated.sessionId,
          album.mbid,
          album.title,
          album.primary_artist_name,
          album.primary_artist_mbid ?? null,
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
