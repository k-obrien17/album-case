import type { VercelRequest, VercelResponse } from '@vercel/node';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LB_BASE = 'https://labs.api.listenbrainz.org';
// ListenBrainz's current recommended session-based similarity model. If LB
// retires this algorithm string, the upstream call fails and this route 502s
// -- the client reports that cleanly rather than showing stale/empty data.
const LB_ALGORITHM =
  'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const MAX_RESULTS = 50;
const FETCH_TIMEOUT_MS = 8000;

type LbRow = { artist_mbid?: string; name?: string; score?: number };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const mbid = typeof req.query.artist_mbid === 'string' ? req.query.artist_mbid : '';
  if (!UUID_RE.test(mbid)) {
    res.status(400).json({ error: 'invalid_artist_mbid' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ artist_mbids: mbid, algorithm: LB_ALGORITHM });
    const lb = await fetch(`${LB_BASE}/similar-artists/json?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!lb.ok) throw new Error(`listenbrainz_${lb.status}`);

    const rows = (await lb.json()) as LbRow[];
    const artists = (Array.isArray(rows) ? rows : [])
      .filter((r) => typeof r.artist_mbid === 'string' && typeof r.name === 'string' && typeof r.score === 'number')
      .slice(0, MAX_RESULTS)
      .map((r) => ({ mbid: r.artist_mbid as string, name: r.name as string, score: r.score as number }));

    // Similarity data changes rarely; a day of edge caching makes repeat
    // presses of the button nearly free for the same seed artists.
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.status(200).json({ artists });
  } catch {
    res.status(502).json({ error: 'listenbrainz_unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
