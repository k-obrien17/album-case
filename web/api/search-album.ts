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
