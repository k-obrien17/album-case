import type { VercelRequest, VercelResponse } from '@vercel/node';

const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 200;
const MB_TIMEOUT_MS = 8000;

type MbArtist = {
  id: string;
  name: string;
  disambiguation?: string;
  type?: string;
  country?: string;
};

type ArtistResult = {
  mbid: string;
  name: string;
  disambiguation: string | null;
  type: string | null;
  country: string | null;
};

function toArtistResult(artist: MbArtist): ArtistResult {
  return {
    mbid: artist.id,
    name: artist.name,
    disambiguation: artist.disambiguation ?? null,
    type: artist.type ?? null,
    country: artist.country ?? null,
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

  // Same reasoning as search-album.ts: an unauthenticated public route
  // proxying MusicBrainz, which rate-limits per User-Agent (~1 req/s). Let
  // Vercel's edge absorb repeat queries for the same string.
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MB_TIMEOUT_MS);

  try {
    // Lucene-escape double quotes so a quoted query can't break the syntax.
    const params = new URLSearchParams({
      query: q.replace(/"/g, '\\"'),
      fmt: 'json',
      limit: String(MAX_RESULTS),
    });
    const mb = await fetch(`${MB_BASE}/artist/?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!mb.ok) throw new Error(`musicbrainz_${mb.status}`);

    const data = (await mb.json()) as { artists?: MbArtist[] };
    const artists = (data.artists ?? []).slice(0, MAX_RESULTS).map(toArtistResult);

    res.status(200).json({ artists });
  } catch {
    // Covers both a non-ok MusicBrainz response and the AbortController
    // firing on a hung upstream.
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
}
