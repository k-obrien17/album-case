import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import allowlist from './_allowlist.json' with { type: 'json' };
import { SCHEMA_STATEMENTS } from './_schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedMbids = new Set<string>(allowlist);

type SnapshotLists = {
  wantToListen: string[];
  notHeard: string[];
};

type RankingBody = {
  session_id?: unknown;
  ranked?: unknown;
  lists?: unknown;
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

function parseMbidList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !UUID_RE.test(item) || !allowedMbids.has(item) || seen.has(item)) {
      return null;
    }
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

function parseLists(value: unknown): SnapshotLists | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<Record<keyof SnapshotLists, unknown>>;
  const wantToListen = parseMbidList(candidate.wantToListen);
  const notHeard = parseMbidList(candidate.notHeard);
  if (!wantToListen || !notHeard) return null;
  return { wantToListen, notHeard };
}

function validate(body: RankingBody | null):
  | { ok: true; sessionId: string; ranked: string[]; lists: SnapshotLists }
  | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'invalid_json' };
  if (!isSessionId(body.session_id)) return { ok: false, message: 'invalid_session' };

  const ranked = parseMbidList(body.ranked);
  const lists = parseLists(body.lists);
  if (!ranked || !lists) return { ok: false, message: 'invalid_snapshot' };

  const rankedIds = new Set(ranked);
  if (lists.wantToListen.some((id) => rankedIds.has(id)) || lists.notHeard.some((id) => rankedIds.has(id))) {
    return { ok: false, message: 'ranked_album_in_saved_list' };
  }

  const wantIds = new Set(lists.wantToListen);
  if (lists.notHeard.some((id) => wantIds.has(id))) {
    return { ok: false, message: 'duplicate_saved_album' };
  }

  return { ok: true, sessionId: body.session_id, ranked, lists };
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
SELECT ranking_json, lists_json, updated_at
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

  res.status(200).json({
    snapshot: {
      ranked: JSON.parse(String(row.ranking_json)) as string[],
      lists: JSON.parse(String(row.lists_json)) as SnapshotLists,
      updated_at: Number(row.updated_at),
    },
  });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const validated = validate(parseBody(req));
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  await ensureSchema();
  const now = Date.now();
  await db().batch([
    {
      sql: `
INSERT INTO sessions (session_id, created_at, last_seen_at)
VALUES (?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
`,
      args: [validated.sessionId, now, now],
    },
    {
      sql: `
INSERT INTO ranking_snapshots (session_id, ranking_json, lists_json, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  ranking_json = excluded.ranking_json,
  lists_json = excluded.lists_json,
  updated_at = excluded.updated_at
`,
      args: [
        validated.sessionId,
        JSON.stringify(validated.ranked),
        JSON.stringify(validated.lists),
        now,
      ],
    },
  ]);

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
