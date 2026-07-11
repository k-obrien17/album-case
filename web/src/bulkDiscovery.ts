import type { Album } from './ranking/types';

export const TOP_ARTIST_DISCOVERY_COUNT = 10;

export function topRankedArtists(
  ranked: Album[],
  n: number
): { mbid: string; name: string }[] {
  const seen = new Set<string>();
  const out: { mbid: string; name: string }[] = [];
  for (const album of ranked) {
    if (out.length >= n) break;
    const mbid = album.primary_artist_mbid;
    if (!mbid || seen.has(mbid)) continue;
    seen.add(mbid);
    out.push({ mbid, name: album.primary_artist_name });
  }
  return out;
}
