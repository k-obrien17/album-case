import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import allowlist from './_allowlist.json' with { type: 'json' };
import { SCHEMA_STATEMENTS } from './_schema.js';
import { requireWriteKey } from './_writeKey.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The allowlist gates /api/atom only. Ranking snapshots deliberately do NOT
// gate on it: the server stores whatever FULL album records the owner has
// placed, so the saved list survives seed/allowlist changes. Import retained
// for parity with the atom handler's Vercel-ESM JSON import.
void allowlist;

type Album = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  primary_artist_mbid?: string;
  release_year: number | null;
  cover_url: string;
};

type SnapshotLists = {
  wantToListen: Album[];
  notHeard: Album[];
  dontCare: Album[];
};

type ArtistLock = {
  artistMbid: string;
  order: string[];
};

type RankingBody = {
  session_id?: unknown;
  ranked?: unknown;
  lists?: unknown;
  artist_locks?: unknown;
  base_updated_at?: unknown;
};

let schemaReady: Promise<void> | null = null;

function db() {
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
      await client.execute('ALTER TABLE ranking_snapshots ADD COLUMN artist_locks_json TEXT');
    } catch {
      // Existing deployments may already have this nullable column.
    }
  })();
  return schemaReady;
}

function parseBody(req: VercelRequest): RankingBody | null {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as RankingBody;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === 'object') return req.body as RankingBody;
  return null;
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Coerce a client-sent entry into a full Album record. Requires the
// identifying fields (mbid, title, artist); tolerates a loose year/cover.
function parseAlbum(value: unknown): Album | null {
  if (!isObject(value)) return null;
  const {
    mbid,
    title,
    primary_artist_name: artist,
    primary_artist_mbid: artistMbid,
    release_year: year,
    cover_url: cover,
  } = value;
  if (typeof mbid !== 'string' || !UUID_RE.test(mbid)) return null;
  if (typeof title !== 'string' || typeof artist !== 'string') return null;
  if (artistMbid !== undefined && (typeof artistMbid !== 'string' || !UUID_RE.test(artistMbid))) {
    return null;
  }
  return {
    mbid,
    title,
    primary_artist_name: artist,
    ...(artistMbid ? { primary_artist_mbid: artistMbid } : {}),
    release_year: typeof year === 'number' ? year : null,
    cover_url: typeof cover === 'string' ? cover : '',
  };
}

// A list of full album records, de-duped by mbid within the list.
function parseAlbumList(value: unknown): Album[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const albums: Album[] = [];
  for (const item of value) {
    const album = parseAlbum(item);
    if (!album || seen.has(album.mbid)) return null;
    seen.add(album.mbid);
    albums.push(album);
  }
  return albums;
}

function parseLists(value: unknown): SnapshotLists | null {
  if (!isObject(value)) return null;
  const wantToListen = parseAlbumList(value.wantToListen);
  const notHeard = parseAlbumList(value.notHeard);
  const dontCare = parseAlbumList(value.dontCare);
  if (!wantToListen || !notHeard || !dontCare) return null;
  return { wantToListen, notHeard, dontCare };
}

function parseArtistLocks(value: unknown): ArtistLock[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const locks: ArtistLock[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const { artistMbid, order } = item;
    if (typeof artistMbid !== 'string' || !UUID_RE.test(artistMbid)) return null;
    if (!Array.isArray(order) || !order.every((mbid) => typeof mbid === 'string' && UUID_RE.test(mbid))) {
      return null;
    }
    locks.push({ artistMbid, order: order as string[] });
  }
  return locks;
}

function parseBaseUpdatedAt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function validate(body: RankingBody | null):
  | {
      ok: true;
      sessionId: string;
      ranked: Album[];
      lists: SnapshotLists;
      artistLocks: ArtistLock[];
      baseUpdatedAt: number | null | undefined;
    }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };
  if (!isSessionId(body.session_id)) return { ok: false, message: 'invalid_session' };

  const ranked = parseAlbumList(body.ranked);
  const lists = parseLists(body.lists);
  const artistLocks = parseArtistLocks(body.artist_locks);
  if (!ranked || !lists || !artistLocks) return { ok: false, message: 'invalid_snapshot' };
  const baseUpdatedAt = parseBaseUpdatedAt(body.base_updated_at);
  if (body.base_updated_at !== undefined && baseUpdatedAt === undefined) {
    return { ok: false, message: 'invalid_base_updated_at' };
  }

  const rankedIds = new Set(ranked.map((album) => album.mbid));
  const saved = [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare];
  if (saved.some((album) => rankedIds.has(album.mbid))) {
    return { ok: false, message: 'ranked_album_in_saved_list' };
  }

  const savedIds = new Set<string>();
  for (const album of saved) {
    if (savedIds.has(album.mbid)) return { ok: false, message: 'duplicate_saved_album' };
    savedIds.add(album.mbid);
  }

  return { ok: true, sessionId: body.session_id, ranked, lists, artistLocks, baseUpdatedAt };
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!isSessionId(sessionId)) {
    res.status(400).json({ error: 'invalid_session' });
    return;
  }

  await ensureSchema();
  const rows = await db().execute({
    sql: `
SELECT ranking_json, lists_json, artist_locks_json, updated_at
FROM ranking_snapshots
WHERE session_id = ?
`,
    args: [sessionId],
  });
  const row = rows.rows[0];
  if (!row) {
    res.status(200).json({ snapshot: null });
    return;
  }

  const ranked = JSON.parse(String(row.ranking_json)) as Album[];
  const lists = JSON.parse(String(row.lists_json)) as Partial<SnapshotLists>;
  const artistLocks = row.artist_locks_json ? (JSON.parse(String(row.artist_locks_json)) as ArtistLock[]) : [];
  res.status(200).json({
    snapshot: {
      ranked,
      lists: {
        wantToListen: lists.wantToListen ?? [],
        notHeard: lists.notHeard ?? [],
        dontCare: lists.dontCare ?? [],
      },
      artist_locks: artistLocks,
      updated_at: Number(row.updated_at),
    },
  });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireWriteKey(req, res)) return;

  const validated = validate(parseBody(req));
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  await ensureSchema();
  const now = Date.now();
  const snapshotArgs = [
    validated.sessionId,
    JSON.stringify(validated.ranked),
    JSON.stringify(validated.lists),
    JSON.stringify(validated.artistLocks),
    now,
  ];
  const snapshotSql =
    validated.baseUpdatedAt === null
      ? `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO NOTHING
`
      : validated.baseUpdatedAt === undefined
        ? `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  artist_locks_json = excluded.artist_locks_json,
  updated_at = excluded.updated_at
`
        : `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  artist_locks_json = excluded.artist_locks_json,
  updated_at = excluded.updated_at
WHERE ranking_snapshots.updated_at = ?
`;

  const results = await db().batch([
    {
      sql: `
INSERT INTO sessions (session_id, created_at, last_seen_at)
VALUES (?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
`,
      args: [validated.sessionId, now, now],
    },
    {
      sql: snapshotSql,
      args:
        validated.baseUpdatedAt == null
          ? snapshotArgs
          : [...snapshotArgs, validated.baseUpdatedAt],
    },
  ]);
  const snapshotRowsAffected = Number(results[1]?.rowsAffected ?? 0);
  if (snapshotRowsAffected === 0) {
    res.status(409).json({ error: 'snapshot_conflict' });
    return;
  }

  res.status(200).json({ ok: true, updated_at: now });
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
    res.status(500).json({ error: 'store_error' });
  }
}
