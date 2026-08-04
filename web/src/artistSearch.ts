const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ArtistResult = {
  mbid: string;
  name: string;
  disambiguation: string | null;
  type: string | null;
  country: string | null;
};

export type ArtistSearchOutcome =
  | { status: 'found'; artists: ArtistResult[] }
  | { status: 'empty' }
  | { status: 'error' };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseArtistResult(value: unknown): ArtistResult | null {
  if (!isObject(value)) return null;
  const { mbid, name } = value;
  if (typeof mbid !== 'string' || !UUID_RE.test(mbid)) return null;
  if (typeof name !== 'string' || !name.trim()) return null;

  return {
    mbid,
    name,
    disambiguation: typeof value.disambiguation === 'string' ? value.disambiguation : null,
    type: typeof value.type === 'string' ? value.type : null,
    country: typeof value.country === 'string' ? value.country : null,
  };
}

function parseArtistResultArray(value: unknown): ArtistResult[] {
  if (!Array.isArray(value)) return [];
  const artists: ArtistResult[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const artist = parseArtistResult(item);
    if (!artist || seen.has(artist.mbid)) continue;
    seen.add(artist.mbid);
    artists.push(artist);
  }
  return artists;
}

export async function searchArtists(query: string): Promise<ArtistSearchOutcome> {
  const q = query.trim();
  if (!q) return { status: 'empty' };

  let response: Response;
  try {
    response = await fetch(`/api/search-artist?q=${encodeURIComponent(q)}`);
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };

  try {
    const body = (await response.json()) as { artists?: unknown };
    const artists = parseArtistResultArray(body.artists);
    return artists.length > 0 ? { status: 'found', artists } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
