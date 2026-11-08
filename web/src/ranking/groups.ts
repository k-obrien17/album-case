import type { RankedAlbum } from './types';

export type GroupDimension = 'artist' | 'year' | 'decade' | 'genre';

export type RankedSection = {
  key: string;
  label: string;
  /** Global rating order preserved within the section. */
  albums: RankedAlbum[];
  count: number;
  /** Unrounded arithmetic mean of the section's ratings. */
  meanRating: number;
};

// Same key rule as subRank.ts: artists collide by display name across
// distinct MusicBrainz artists, so key by mbid when present.
function artistGroupKey(album: RankedAlbum): string {
  return album.primary_artist_mbid ?? album.primary_artist_name;
}

function section(key: string, label: string, albums: RankedAlbum[]): RankedSection {
  return {
    key,
    label,
    albums,
    count: albums.length,
    meanRating: albums.reduce((sum, a) => sum + a.rating, 0) / albums.length,
  };
}

/** Keys of each album in `dimension`, paired with the section label.
 *  Genre is the only multi-key dimension. Null keys mean "no bucket in
 *  this dimension" (collected into the dimension's trailing section). */
function bucketsFor(album: RankedAlbum, dimension: GroupDimension): { key: string; label: string }[] {
  if (dimension === 'artist') {
    return [{ key: `artist:${artistGroupKey(album)}`, label: album.primary_artist_name }];
  }
  if (dimension === 'year') {
    return album.release_year != null
      ? [{ key: `year:${album.release_year}`, label: String(album.release_year) }]
      : [];
  }
  if (dimension === 'decade') {
    if (album.release_year == null) return [];
    const decade = Math.floor(album.release_year / 10) * 10;
    return [{ key: `decade:${decade}`, label: `${decade}s` }];
  }
  return (album.genres ?? []).map((g) => ({ key: `genre:${g}`, label: g }));
}

/**
 * Project the globally-ordered ranked list into sections for one browse
 * dimension. Album order inside every section is the global rating order;
 * sections never re-sort albums.
 *
 * Section order: artist sorts by the global rank of its best album; year
 * and decade read chronologically, newest first (best-album order looks
 * random on a time axis). Genre sorts by count descending (ties
 * alphabetical), collapses
 * single-album genres into one trailing "More genres" section (deduped),
 * and ends with "No genre yet" for untagged albums. Year/decade end with
 * "Year unknown" for null-year albums.
 */
export function groupRanked(ranked: RankedAlbum[], dimension: GroupDimension): RankedSection[] {
  const byKey = new Map<string, { label: string; albums: RankedAlbum[] }>();
  const unbucketed: RankedAlbum[] = [];
  for (const album of ranked) {
    const buckets = bucketsFor(album, dimension);
    if (buckets.length === 0) {
      unbucketed.push(album);
      continue;
    }
    for (const { key, label } of buckets) {
      const entry = byKey.get(key) ?? { label, albums: [] };
      entry.albums.push(album);
      byKey.set(key, entry);
    }
  }

  // Insertion order of byKey = order of each section's best (first) album,
  // because `ranked` is iterated in global order.
  let sections = [...byKey.entries()].map(([key, e]) => section(key, e.label, e.albums));

  if (dimension === 'genre') {
    sections.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const singles = sections.filter((s) => s.count === 1);
    sections = sections.filter((s) => s.count > 1);
    if (singles.length > 0) {
      const seen = new Set<string>();
      const albums = ranked.filter((a) =>
        singles.some((s) => s.albums[0].mbid === a.mbid) && !seen.has(a.mbid) && !!seen.add(a.mbid)
      );
      sections.push(section('genre:more', 'More genres', albums));
    }
    if (unbucketed.length > 0) sections.push(section('genre:none', 'No genre yet', unbucketed));
    return sections;
  }

  if (dimension === 'year' || dimension === 'decade') {
    // Keys are `year:<n>` / `decade:<n>`; compare the numeric part.
    sections.sort((a, b) => Number(b.key.split(':')[1]) - Number(a.key.split(':')[1]));
    if (unbucketed.length > 0) sections.push(section('year:unknown', 'Year unknown', unbucketed));
  }
  return sections;
}
