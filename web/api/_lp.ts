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
