import type { RankedAlbum } from './ranking/types';
import type { CuratedAlbumEntry } from './data/curatedLists';

// Ligatures/letters Unicode NFD decomposition doesn't break into a base
// letter + combining mark (unlike e.g. "e" with an acute accent -> "e" +
// combining acute), so they'd otherwise just get silently dropped by the
// strip-non-alphanumeric step below. The real MusicBrainz title "AE" used
// as a ligature (as in "gaetis Byrjun") vs. the curated-list source
// spelling it out as two letters is exactly this failure.
const LIGATURES: Record<string, string> = {
  'æ': 'ae', // ae ligature
  'œ': 'oe', // oe ligature
  'ø': 'o', // o with stroke
  'ð': 'd', // eth
  'þ': 'th', // thorn
  'ß': 'ss', // sharp s
};

// Loose text match (case/punctuation/diacritic/leading-"the"-insensitive):
// curated list entries carry no mbid (see curatedLists.ts's header
// comment), so this is the only way to check them against the owner's
// ranked list. Exported so cross-check-curated-titles.mjs can group by the
// same normalized artist -- see that script for why.
export function normalize(s: string): string {
  let out = s.toLowerCase();
  for (const [from, to] of Object.entries(LIGATURES)) out = out.split(from).join(to);
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, ''); // combining accents, e.g. acute/tilde
  return out.replace(/^the /, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Exported so resolve-curated-list-mbids.mjs can build its local-ranked-hit
// index against the exact same normalization -- two independently-drifting
// implementations would risk the resolver and the live app disagreeing
// about what counts as "already ranked".
export function key(artist: string, title: string): string {
  return `${normalize(artist)}|${normalize(title)}`;
}

/** Stable per-entry identity for in-flight/message tracking and for
 *  skip-state -- curated entries carry no mbid (see curatedLists.ts's
 *  header comment). */
export function curatedEntryKey(listId: string, entry: CuratedAlbumEntry): string {
  return `${listId}:${entry.rank}`;
}

export type UnrankedFilterOptions = {
  /** Required only when `skippedKeys` is passed -- skip keys are scoped
   *  `listId:rank` (see curatedEntryKey), so the list being filtered must
   *  be known to check membership. */
  listId?: string;
  skippedKeys?: Set<string>;
  /** Same owner-hidden-artist names used elsewhere (artistBlocks.ts),
   *  matched the same normalized/leading-"the"-insensitive way as the
   *  ranked-list check above. */
  blockedArtists?: string[];
};

/** Curated list entries not yet represented in `ranked`, in the list's
 *  original rank order. An entry with a `resolved` mbid is checked against
 *  `ranked`'s mbids directly (exact, handles a curated entry's artist
 *  spelling differing from MusicBrainz's canonical artist credit -- e.g.
 *  "MF DOOM & Madlib" on the curated list vs. "Madvillain" as ranked).
 *  Everything else falls back to the normalized artist+title text match.
 *  Also excludes entries the owner has blocked (by artist) or skipped (by
 *  curatedEntryKey), so a hidden/skipped entry actually stops resurfacing. */
export function unrankedFromCuratedList(
  albums: CuratedAlbumEntry[],
  ranked: RankedAlbum[],
  opts: UnrankedFilterOptions = {}
): CuratedAlbumEntry[] {
  const rankedIds = new Set(ranked.map((a) => a.mbid));
  const rankedKeys = new Set(ranked.map((a) => key(a.primary_artist_name, a.title)));
  const blockedKeys = new Set((opts.blockedArtists ?? []).map((name) => normalize(name)));
  const skippedKeys = opts.skippedKeys ?? new Set<string>();
  return albums.filter((a) => {
    if (a.resolved && rankedIds.has(a.resolved.mbid)) return false;
    if (rankedKeys.has(key(a.artist, a.title))) return false;
    if (blockedKeys.has(normalize(a.artist))) return false;
    if (opts.listId && skippedKeys.has(curatedEntryKey(opts.listId, a))) return false;
    return true;
  });
}
