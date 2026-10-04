import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type Client } from '@libsql/client';
import { isAlbumOrEpReleaseGroup, MB_BASE, USER_AGENT } from '../_lp.js';
import {
  CATALOG_SCHEMA_STATEMENTS,
  catalogUpsertStatement,
  searchGroupToCatalogAlbum,
  type CatalogAlbum,
  type SearchReleaseGroup,
} from '../_catalog.js';

const WINDOW_DAYS = 21;
const PAGE_SIZE = 100;
const MAX_PAGES = 40;
// Stop starting new pages after this much wall time. One more page can still
// take MB_TIMEOUT_MS plus its write, so this leaves headroom inside the 60s
// maxDuration in vercel.json. Each page is saved as it arrives, so a run cut
// short keeps everything it fetched.
const TIME_BUDGET_MS = 40_000;
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

async function saveGroups(
  deps: RefreshDeps,
  groups: SearchReleaseGroup[],
): Promise<{ kept: number; added: number }> {
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
  return { kept: kept.length, added: kept.filter((a) => !existing.has(a.mbid)).length };
}

export async function refreshCatalog(deps: RefreshDeps): Promise<RefreshResult> {
  const startedAt = deps.now().getTime();
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await deps.client.execute(sql);

  const { from, to } = releaseWindow(deps.now());
  const query = `firstreleasedate:[${from} TO ${to}] AND (primarytype:album OR primarytype:ep)`;

  const result: RefreshResult = { scanned: 0, kept: 0, added: 0, pages: 0, partial: false };
  let total = Infinity;
  for (let offset = 0; offset < total && result.pages < MAX_PAGES; offset += PAGE_SIZE) {
    if (deps.now().getTime() - startedAt >= TIME_BUDGET_MS) break;
    if (result.pages > 0) await deps.sleep(PAGE_DELAY_MS);
    let groups: SearchReleaseGroup[];
    try {
      const pageResult = await fetchPage(deps, query, offset);
      total = pageResult.count;
      groups = pageResult.groups;
    } catch (err) {
      console.error('refresh-catalog page failed', { offset, err });
      result.partial = true;
      break;
    }
    result.pages += 1;
    result.scanned += groups.length;
    const saved = await saveGroups(deps, groups);
    result.kept += saved.kept;
    result.added += saved.added;
  }
  // Out of pages or time before covering the window.
  if (result.pages * PAGE_SIZE < total) result.partial = true;
  return result;
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
