import type { VercelRequest, VercelResponse } from '@vercel/node';
import { browseArtistLps } from './_lp.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const artistMbid = typeof req.query.artist_mbid === 'string' ? req.query.artist_mbid : '';
  if (!UUID_RE.test(artistMbid)) {
    res.status(400).json({ error: 'invalid_artist_mbid' });
    return;
  }

  const artistName = typeof req.query.artist_name === 'string' ? req.query.artist_name.trim() : '';
  if (!artistName) {
    res.status(400).json({ error: 'missing_artist_name' });
    return;
  }
  if (artistName.length > MAX_NAME_LENGTH) {
    res.status(400).json({ error: 'artist_name_too_long' });
    return;
  }

  // Unauthenticated public route proxying MusicBrainz, same reasoning as
  // search-album.ts / search-artist.ts: let Vercel's edge absorb repeat
  // browses of the same artist rather than every hit going to MusicBrainz.
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  try {
    const albums = await browseArtistLps(artistMbid, artistName);
    res.status(200).json({ albums });
  } catch {
    res.status(502).json({ error: 'musicbrainz_unavailable' });
  }
}
