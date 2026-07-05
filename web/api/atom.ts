import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import allowlist from './_allowlist.json' with { type: 'json' };
import { SCHEMA_STATEMENTS } from './_schema.js';

const MECHANISM = 'drag_to_place';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedMbids = new Set<string>(allowlist);

type AtomBody = {
  entity_a?: unknown;
  entity_b?: unknown;
  winner?: unknown;
  session_id?: unknown;
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

function parseBody(req: VercelRequest): AtomBody | null {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as AtomBody;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === 'object') return req.body as AtomBody;
  return null;
}

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

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

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

    await client.batch([
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
INSERT INTO atoms (entity_a, entity_b, winner, mechanism, session_id, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`,
        args: [
          validated.entityA,
          validated.entityB,
          validated.winner,
          MECHANISM,
          validated.sessionId,
          now,
        ],
      },
    ]);

    res.status(201).json({ ok: true });
  } catch {
    schemaReady = null;
    res.status(500).json({ error: 'store_error' });
  }
}
