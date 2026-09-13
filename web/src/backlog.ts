import type { Album, RankedAlbum } from './ranking/types';
import { allSavedAlbums, removeFromAllLists, type SavedLists } from './lists';
import { emptyBacklog } from '../shared/backlog';
import { key, normalize } from './curatedListMatch';
import type { ArtistPlays } from './seed';

export type ReviewDecision = 'readyToRank' | 'wantToListen' | 'notHeard' | 'dontCare';
export type ArtistGap = {
  id: string;
  name: string;
  ranked: RankedAlbum[];
  albums: Album[];
  remaining: Album[];
  plays: number;
  reviewed: boolean;
};

/** A reversible title hint, never an authoritative release classification. */
export function otherReleaseReason(album: Album): string | null {
  if (/\b(demos?|bootleg|broadcast|sessions?|remixes|instrumentals)\b/i.test(album.title)) return 'Title suggests demos, sessions, or another version';
  if (/\blive\s+(at|in|from|on)\b|\b(live collection|concert recordings)\b|\b\d{4}[-‐–]\d{2}[-‐–]\d{2}\b/i.test(album.title)) return 'Title suggests a live recording';
  return null;
}

export function albumKey(album: Album): string {
  return key(album.primary_artist_name, album.title);
}

export function buildArtistGaps(
  pool: Album[], ranked: RankedAlbum[], lists: SavedLists, preferred: ArtistPlays[],
  blockedArtists: string[] = [], skipped: Set<string> = new Set(),
): ArtistGap[] {
  const saved = allSavedAlbums(lists);
  const all = [...ranked, ...saved, ...(lists.backlog?.pendingReview ?? []), ...pool];
  const artistIds = new Map<string, string>();
  for (const a of all) if (a.primary_artist_mbid) artistIds.set(normalize(a.primary_artist_name), a.primary_artist_mbid);
  const artistId = (a: Album) => a.primary_artist_mbid ?? artistIds.get(normalize(a.primary_artist_name)) ?? `name:${normalize(a.primary_artist_name)}`;
  const plays = new Map(preferred.map((a) => [normalize(a.artist), a.plays]));
  const blocked = new Set(blockedArtists.map(normalize));
  const reviewed = new Set(lists.backlog?.reviewedArtistIds ?? []);
  const groups = new Map<string, ArtistGap>();
  const rankedIds = new Set(ranked.map((a) => a.mbid));
  const rankedKeys = new Set(ranked.map(albumKey));
  const savedIds = new Set(saved.map((a) => a.mbid));
  const savedKeys = new Set(saved.map(albumKey));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const a of all) {
    if (blocked.has(normalize(a.primary_artist_name))) continue;
    const id = artistId(a);
    let group = groups.get(id);
    if (!group) {
      group = { id, name: a.primary_artist_name, ranked: [], albums: [], remaining: [], plays: plays.get(normalize(a.primary_artist_name)) ?? 0, reviewed: reviewed.has(id) };
      groups.set(id, group);
    }
    if (seenIds.has(a.mbid) || seenKeys.has(albumKey(a))) continue;
    seenIds.add(a.mbid);
    seenKeys.add(albumKey(a));
    if (rankedIds.has(a.mbid)) group.ranked.push(a as RankedAlbum);
    else if (!skipped.has(a.mbid)) {
      group.albums.push(a);
      if (!rankedKeys.has(albumKey(a)) && !savedIds.has(a.mbid) && !savedKeys.has(albumKey(a))) group.remaining.push(a);
    }
  }
  const byYear = (a: Album, b: Album) => (a.release_year ?? 9999) - (b.release_year ?? 9999) || a.title.localeCompare(b.title);
  return [...groups.values()]
    .filter((g) => g.ranked.length > 0 || g.plays > 0)
    .map((g) => ({ ...g, albums: g.albums.sort(byYear), remaining: g.remaining.sort(byYear) }))
    .sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || b.ranked.length - a.ranked.length || b.plays - a.plays || a.name.localeCompare(b.name));
}

export function decideAlbum(lists: SavedLists, album: Album, decision: ReviewDecision | null): SavedLists {
  const next = removeFromAllLists(lists, album);
  if (!decision) {
    const backlog = next.backlog ?? emptyBacklog<Album>();
    return { ...next, backlog: { ...backlog, pendingReview: [...(backlog.pendingReview ?? []), album] } };
  }
  if (decision === 'wantToListen' || decision === 'notHeard' || decision === 'dontCare') return { ...next, [decision]: [...next[decision], album] };
  const backlog = next.backlog ?? emptyBacklog<Album>();
  return { ...next, backlog: { ...backlog, [decision]: [...backlog[decision], album] } };
}

export function decisionFor(lists: SavedLists, album: Album): string | null {
  const match = (albums: Album[]) => albums.some((a) => a.mbid === album.mbid || albumKey(a) === albumKey(album));
  if (match(lists.backlog?.readyToRank ?? [])) return 'Ready to rank';
  if (match(lists.backlog?.needsRefresher ?? [])) return 'Want to listen';
  if (match(lists.notHeard)) return 'Haven’t heard';
  if (match(lists.dontCare)) return 'Not interested';
  if (match(lists.wantToListen)) return 'Want to listen';
  return null;
}
