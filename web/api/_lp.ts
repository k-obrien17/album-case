export type ReleaseGroup = {
  id: string;
  title: string;
  'first-release-date'?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
};

// Matches the seed builder's LP rule: MusicBrainz Album, excluding secondary
// categories such as Compilation, Live, Remix, and Soundtrack.
export function isLpReleaseGroup(group: ReleaseGroup): boolean {
  return group['primary-type'] === 'Album' && (group['secondary-types']?.length ?? 0) === 0;
}

// Same secondary-types rule as isLpReleaseGroup, widened to also admit EPs
// (e.g. Pixies' "Come On Pilgrim") for free-text search results only.
export function isAlbumOrEpReleaseGroup(group: ReleaseGroup): boolean {
  const type = group['primary-type'];
  return (type === 'Album' || type === 'EP') && (group['secondary-types']?.length ?? 0) === 0;
}

export type DiscoveredAlbum = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  primary_artist_mbid?: string;
  release_year: number | null;
  cover_url: string;
};

export const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
export const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_TIMEOUT_MS = 8000;

export function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

function releaseYear(group: ReleaseGroup): number | null {
  const date = group['first-release-date'] ?? '';
  const yearStr = date.split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

/** Fetches an artist's studio LPs directly from MusicBrainz -- no
 *  persistence. Shared by discover-artist.ts's write-key-gated persist path
 *  and browse-artist.ts's unauthenticated browse-only path, so both always
 *  apply the same LP filter and the same upstream timeout. */
export async function browseArtistLps(
  artistMbid: string,
  artistName: string
): Promise<DiscoveredAlbum[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MB_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({ artist: artistMbid, type: 'album', limit: '100', fmt: 'json' });
    const res = await fetch(`${MB_BASE}/release-group?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`musicbrainz_browse_${res.status}`);
    const data = (await res.json()) as { 'release-groups'?: ReleaseGroup[] };
    return (data['release-groups'] ?? []).filter(isLpReleaseGroup).map((group) => ({
      mbid: group.id,
      title: group.title,
      primary_artist_name: artistName,
      primary_artist_mbid: artistMbid,
      release_year: releaseYear(group),
      cover_url: coverUrlFor(group.id),
    }));
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('musicbrainz_browse_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function mergeDiscovered(
  previouslyUnranked: DiscoveredAlbum[],
  newlyDiscovered: DiscoveredAlbum[]
): DiscoveredAlbum[] {
  const seen = new Set<string>();
  const merged: DiscoveredAlbum[] = [];
  for (const album of [...previouslyUnranked, ...newlyDiscovered]) {
    if (seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    merged.push(album);
  }
  return merged;
}
