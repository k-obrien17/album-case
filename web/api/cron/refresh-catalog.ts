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
