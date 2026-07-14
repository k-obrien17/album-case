import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAlbumOrEpReleaseGroup, type ReleaseGroup, type DiscoveredAlbum } from './_lp.js';

const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 200;
const MB_SEARCH_LIMIT = 50;
const MB_TIMEOUT_MS = 8000;

function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

function releaseYear(group: ReleaseGroup): number | null {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

type SearchReleaseGroup = ReleaseGroup & {
  'artist-credit'?: { name?: string; artist?: { id?: string } }[];
};

function toAlbum(group: SearchReleaseGroup): DiscoveredAlbum {
  const credit = group['artist-credit']?.[0];
  return {
    mbid: group.id,
    title: group.title,
    primary_artist_name: credit?.name ?? 'Unknown Artist',
    ...(credit?.artist?.id ? { primary_artist_mbid: credit.artist.id } : {}),
    release_year: releaseYear(group),
    cover_url: coverUrlFor(group.id),
  };
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

  // This is an unauthenticated public route proxying MusicBrainz, which
  // rate-limits per User-Agent (~1 req/s). Let Vercel's edge absorb repeat
  // queries for the same string rather than every hit going to MusicBrainz --
  // a hammered endpoint here would also degrade /api/discover-artist and the
  // canon import script, which share the same User-Agent.
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

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
    const albums = (data['release-groups'] ?? [])
      .filter(isAlbumOrEpReleaseGroup)
      .slice(0, MAX_RESULTS)
      .map(toAlbum);

    res.status(200).json({ albums });
  } catch {
    // Covers both a non-ok MusicBrainz response and the AbortController
    // firing on a hung upstream (a hang would otherwise burn the function's
    // full duration instead of failing fast).
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
}
