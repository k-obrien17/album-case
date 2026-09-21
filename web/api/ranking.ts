import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import allowlist from './_allowlist.json' with { type: 'json' };
import { SCHEMA_STATEMENTS, alterTableAddColumnIfMissing } from './_schema.js';
import { requireWriteKey } from './_writeKey.js';
import { withDbTimeout } from './_dbTimeout.js';
import { parseBacklog, type Backlog } from '../shared/backlog.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Defensive cap on client-supplied arrays -- Keith's real collection is
// nowhere near this scale; this only ever trips on a pathological payload.
const MAX_ARRAY_ENTRIES = 5000;
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
  genres?: string[];
};

// A ranked-list entry additionally requires a rating (the single source of
// truth for its position). Pool/list albums have no rating.
type RankedAlbum = Album & { rating: number };

type SnapshotLists = {
  wantToListen: Album[];
  notHeard: Album[];
  dontCare: Album[];
  backlog?: Backlog<Album>;
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
  blocked_artists?: unknown;
  curated_skips?: unknown;
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
      await withDbTimeout(client.execute(sql));
    }
    for (const column of ['artist_locks_json', 'blocked_artists_json', 'curated_skips_json']) {
      await alterTableAddColumnIfMissing(
        client,
        `ALTER TABLE ranking_snapshots ADD COLUMN ${column} TEXT`,
      );
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
    genres,
  } = value;
  if (typeof mbid !== 'string' || !UUID_RE.test(mbid)) return null;
  if (typeof title !== 'string' || typeof artist !== 'string') return null;
  if (artistMbid !== undefined && (typeof artistMbid !== 'string' || !UUID_RE.test(artistMbid))) {
    return null;
  }
  const genresList =
    Array.isArray(genres) && genres.every((g) => typeof g === 'string') ? genres : undefined;
  return {
    mbid,
    title,
    primary_artist_name: artist,
    ...(artistMbid ? { primary_artist_mbid: artistMbid } : {}),
    release_year: typeof year === 'number' ? year : null,
    cover_url: typeof cover === 'string' ? cover : '',
    ...(genresList?.length ? { genres: genresList } : {}),
  };
}

// A list of full album records, de-duped by mbid within the list.
function parseAlbumList(value: unknown): Album[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) return null;
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

// Ranked entries additionally require a numeric rating. Kept separate from
// parseAlbum/parseAlbumList, which stay untouched for pool/list albums that
// have no rating.
function parseRankedAlbum(value: unknown): RankedAlbum | null {
  const album = parseAlbum(value);
  if (!album) return null;
  const rating = isObject(value) ? value.rating : undefined;
  if (typeof rating !== 'number') return null;
  return { ...album, rating };
}

// Duplicate mbids within `ranked` are NOT rejected here -- that's validate()'s
// job (the `duplicate_ranked_album` check below), so the caller gets a
// specific, diagnosable error code instead of this collapsing into the same
// generic `invalid_snapshot` as any other malformed entry.
function parseRankedAlbumList(value: unknown): RankedAlbum[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) return null;
  const albums: RankedAlbum[] = [];
  for (const item of value) {
    const album = parseRankedAlbum(item);
    if (!album) return null;
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
  const backlog = value.backlog === undefined ? undefined : parseBacklog(value.backlog, parseAlbumList);
  if (backlog === null) return null;
  return { wantToListen, notHeard, dontCare, ...(backlog && { backlog }) };
}

function parseArtistLocks(value: unknown): ArtistLock[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) return null;
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

// Plain string list -- blocked artist names and curated-entry skip keys
// (`listId:rank`) are both just opaque strings from the API's point of
// view; validated here, given meaning by the client.
function parseStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

function exceedsMaxEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > MAX_ARRAY_ENTRIES;
}

// Re-checks the raw (unparsed) body for an over-cap array so validate() can
// return the specific `too_many_entries` code instead of the generic
// `invalid_snapshot` the parsers themselves fall back to.
function exceedsMaxEntriesSomewhere(body: RankingBody): boolean {
  if (
    exceedsMaxEntries(body.ranked) ||
    exceedsMaxEntries(body.artist_locks) ||
    exceedsMaxEntries(body.blocked_artists) ||
    exceedsMaxEntries(body.curated_skips)
  ) {
    return true;
  }
  if (!isObject(body.lists)) return false;
  const lists = body.lists;
  if (
    exceedsMaxEntries(lists.wantToListen) ||
    exceedsMaxEntries(lists.notHeard) ||
    exceedsMaxEntries(lists.dontCare)
  ) {
    return true;
  }
  if (!isObject(lists.backlog)) return false;
  const backlog = lists.backlog;
  return (
    exceedsMaxEntries(backlog.readyToRank) ||
    exceedsMaxEntries(backlog.needsRefresher) ||
    exceedsMaxEntries(backlog.pendingReview)
  );
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
      ranked: RankedAlbum[];
      lists: SnapshotLists;
      artistLocks: ArtistLock[];
      blockedArtists: string[];
      curatedSkips: string[];
      baseUpdatedAt: number | null | undefined;
    }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };
  if (!isSessionId(body.session_id)) return { ok: false, message: 'invalid_session' };

  const ranked = parseRankedAlbumList(body.ranked);
  const lists = parseLists(body.lists);
  const artistLocks = parseArtistLocks(body.artist_locks);
  const blockedArtists = parseStringArray(body.blocked_artists);
  const curatedSkips = parseStringArray(body.curated_skips);
  if (!ranked || !lists || !artistLocks || !blockedArtists || !curatedSkips) {
    // Give the specific over-cap error code precedence over the generic
    // shape-mismatch one, since the cap check inside each parser above
    // collapses to the same null return as any other invalid shape.
    if (exceedsMaxEntriesSomewhere(body)) {
      return { ok: false, message: 'too_many_entries' };
    }
    return { ok: false, message: 'invalid_snapshot' };
  }
  const baseUpdatedAt = parseBaseUpdatedAt(body.base_updated_at);
  if (body.base_updated_at !== undefined && baseUpdatedAt === undefined) {
    return { ok: false, message: 'invalid_base_updated_at' };
  }

  const rankedIds = new Set(ranked.map((album) => album.mbid));
  if (rankedIds.size !== ranked.length) {
    return { ok: false, message: 'duplicate_ranked_album' };
  }

  const saved = [...lists.wantToListen, ...lists.notHeard, ...lists.dontCare,
    ...(lists.backlog?.readyToRank ?? []), ...(lists.backlog?.needsRefresher ?? []), ...(lists.backlog?.pendingReview ?? [])];
  if (saved.some((album) => rankedIds.has(album.mbid))) {
    return { ok: false, message: 'ranked_album_in_saved_list' };
  }

  const savedIds = new Set<string>();
  for (const album of saved) {
    if (savedIds.has(album.mbid)) return { ok: false, message: 'duplicate_saved_album' };
    savedIds.add(album.mbid);
  }

  return {
    ok: true,
    sessionId: body.session_id,
    ranked,
    lists,
    artistLocks,
    blockedArtists,
    curatedSkips,
    baseUpdatedAt,
  };
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!isSessionId(sessionId)) {
    res.status(400).json({ error: 'invalid_session' });
    return;
  }

  await ensureSchema();
  const rows = await withDbTimeout(
    db().execute({
      sql: `
SELECT ranking_json, lists_json, artist_locks_json, blocked_artists_json, curated_skips_json, updated_at
FROM ranking_snapshots
WHERE session_id = ?
`,
      args: [sessionId],
    })
  );
  const row = rows.rows[0];
  if (!row) {
    res.status(200).json({ snapshot: null });
    return;
  }

  const ranked = JSON.parse(String(row.ranking_json)) as RankedAlbum[];
  const lists = JSON.parse(String(row.lists_json)) as Partial<SnapshotLists>;
  const artistLocks = row.artist_locks_json ? (JSON.parse(String(row.artist_locks_json)) as ArtistLock[]) : [];
  const blockedArtists = row.blocked_artists_json ? (JSON.parse(String(row.blocked_artists_json)) as string[]) : [];
  const curatedSkips = row.curated_skips_json ? (JSON.parse(String(row.curated_skips_json)) as string[]) : [];
  res.status(200).json({
    snapshot: {
      ranked,
      lists: {
        wantToListen: lists.wantToListen ?? [],
        notHeard: lists.notHeard ?? [],
        dontCare: lists.dontCare ?? [],
        ...(lists.backlog && { backlog: lists.backlog }),
      },
      artist_locks: artistLocks,
      blocked_artists: blockedArtists,
      curated_skips: curatedSkips,
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
    JSON.stringify(validated.blockedArtists),
    JSON.stringify(validated.curatedSkips),
    now,
  ];
  const snapshotSql =
    validated.baseUpdatedAt === null
      ? `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, blocked_artists_json, curated_skips_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO NOTHING
`
      : validated.baseUpdatedAt === undefined
        ? `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, blocked_artists_json, curated_skips_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  artist_locks_json = excluded.artist_locks_json,
  blocked_artists_json = excluded.blocked_artists_json,
  curated_skips_json = excluded.curated_skips_json,
  updated_at = excluded.updated_at
WHERE json_type(ranking_snapshots.lists_json, '$.backlog') IS NULL
   OR json_type(excluded.lists_json, '$.backlog') IS NOT NULL
`
        : `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, artist_locks_json, blocked_artists_json, curated_skips_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  artist_locks_json = excluded.artist_locks_json,
  blocked_artists_json = excluded.blocked_artists_json,
  curated_skips_json = excluded.curated_skips_json,
  updated_at = excluded.updated_at
WHERE ranking_snapshots.updated_at = ?
  AND (json_type(ranking_snapshots.lists_json, '$.backlog') IS NULL
    OR json_type(excluded.lists_json, '$.backlog') IS NOT NULL)
`;

  const results = await withDbTimeout(
    db().batch([
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
    ])
  );
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
  } catch (err) {
    console.error('ranking_error', err);
    schemaReady = null;
    res.status(500).json({ error: 'store_error' });
  }
}
