import type { Album, RankedAlbum } from './ranking/types';
import type { SavedLists } from './lists';
import { allSavedAlbums } from './lists';
import { albumKey, otherReleaseReason } from './backlog';
import { normalize, key } from './curatedListMatch';
import { playsMapFromPreferred, type ArtistPlays } from './seed';
import { artistKeys } from './priority';
import { parseAlbumArray } from './album';

export type RelatedArtist = { mbid: string; name: string; strength: number; sources: string[] };
export type Suggestion = { album: Album; reason: string; kind: 'familiar' | 'discovery'; score: number };
export type SuggestionOptions = {
  pool: Album[]; ranked: RankedAlbum[]; lists: SavedLists; preferred: ArtistPlays[];
  blocked: string[]; skipped: Set<string>; seen: Album[]; recentArtists: string[];
  related: RelatedArtist[]; discoveryTurn: boolean;
  curated?: { artist: string; title: string; source: string }[];
};

export function suggestAlbum(opts: SuggestionOptions): Suggestion | null {
  const excluded = [...opts.ranked, ...allSavedAlbums(opts.lists), ...opts.seen];
  const ids = new Set([...excluded.map(a => a.mbid), ...opts.skipped]);
  const keys = new Set([...excluded, ...opts.pool.filter(a => opts.skipped.has(a.mbid))].map(albumKey));
  const blocked = new Set(opts.blocked.map(normalize));
  const plays = playsMapFromPreferred(opts.preferred);
  const curated = new Map((opts.curated ?? []).map(entry => [key(entry.artist, entry.title), entry.source]));
  const ratings = new Map<string, RankedAlbum[]>();
  for (const a of opts.ranked) {
    const name = normalize(a.primary_artist_name);
    ratings.set(name, [...(ratings.get(name) ?? []), a]);
  }
  const seenKeys = new Set<string>();
  const candidates: Suggestion[] = [];
  for (const album of [...(opts.lists.backlog?.pendingReview ?? []), ...opts.pool]) {
    const name = normalize(album.primary_artist_name);
    const identity = albumKey(album);
    const source = curated.get(identity);
    if (ids.has(album.mbid) || keys.has(identity) || blocked.has(name) || seenKeys.has(identity) || (otherReleaseReason(album) && !source)) continue;
    seenKeys.add(identity);
    const rated = ratings.get(name) ?? [];
    const loved = rated.filter(a => a.rating >= 8).sort((a, b) => b.rating - a.rating);
    const playCount = Math.max(0, ...artistKeys(album.primary_artist_name).map(k => plays.get(k) ?? 0));
    const mean = rated.length ? rated.reduce((sum, a) => sum + a.rating, 0) / rated.length : 7;
    const connection = opts.related.find(a => a.mbid === album.primary_artist_mbid || normalize(a.name) === name);
    let score: number;
    let reason: string;
    let kind: Suggestion['kind'];
    if (mean >= 7 && (loved.length || playCount > 0)) {
      kind = 'familiar';
      // Shrink sparse ratings toward 7; one enthusiastic score shouldn't
      // outweigh a whole discography the owner consistently likes.
      const affinity = (mean * rated.length + 14) / (rated.length + 2);
      score = 25 + (affinity - 7) * 12 + Math.min(5, loved.length) + Math.log1p(playCount);
      reason = loved.length
        ? `You rated ${loved[0].title} by ${album.primary_artist_name} ${loved[0].rating.toFixed(2)}.`
        : `${album.primary_artist_name} has ${playCount.toLocaleString()} plays in your listening history.`;
      const nearby = loved.filter(a => a.release_year !== null && album.release_year !== null)
        .sort((a, b) => Math.abs(a.release_year! - album.release_year!) - Math.abs(b.release_year! - album.release_year!))[0];
      if (nearby && Math.abs(nearby.release_year! - album.release_year!) <= 4) {
        score += 7 - Math.abs(nearby.release_year! - album.release_year!);
        reason = `You rated ${nearby.title} (${nearby.release_year}) ${nearby.rating.toFixed(2)}. This is another ${album.primary_artist_name} album from ${album.release_year}.`;
      }
    } else if (!rated.length && connection) {
      kind = 'discovery';
      score = 15 + connection.strength * 5;
      reason = `Listeners connect ${album.primary_artist_name} with ${connection.sources.slice(0, 3).join(', ')}—artists you rated highly. An artist match, not an album rating prediction.`;
    } else continue;
    if (source) {
      score += 20;
      reason += ` Featured in ${source}.`;
    }
    // Keep seasonal releases and alternate editions behind ordinary albums.
    if (/\b(christmas|holiday|deluxe|anniversary|expanded|remaster)\b/i.test(album.title)) score -= 25;
    candidates.push({ album, reason, kind, score });
  }
  const desired = candidates.filter(s => s.kind === (opts.discoveryTurn ? 'discovery' : 'familiar'));
  // Variety stays within the scheduled kind; fall back to the other kind
  // only when no eligible albums of the requested kind remain.
  const scheduled = desired.length ? desired : candidates;
  const fresh = scheduled.filter(s => !opts.recentArtists.includes(normalize(s.album.primary_artist_name)));
  return (fresh.length ? fresh : scheduled).sort((a, b) => b.score - a.score || a.album.title.localeCompare(b.album.title))[0] ?? null;
}

export function suggestionSeeds(ranked: RankedAlbum[], blocked: string[]): { mbid: string; name: string }[] {
  const banned = new Set(blocked.map(normalize));
  const seeds = new Map<string, { mbid: string; name: string }>();
  for (const a of [...ranked].sort((a, b) => b.rating - a.rating)) {
    if (a.rating < 8 || !a.primary_artist_mbid || banned.has(normalize(a.primary_artist_name))) continue;
    seeds.set(a.primary_artist_mbid, { mbid: a.primary_artist_mbid, name: a.primary_artist_name });
    if (seeds.size === 5) break;
  }
  return [...seeds.values()];
}

/** Read-only enrichment; failures leave local taste-based suggestions usable. */
export async function loadSuggestionConnections(
  ranked: RankedAlbum[], blocked: string[], pool: Album[],
  request: typeof fetch = fetch,
): Promise<{ related: RelatedArtist[]; albums: Album[]; unavailable: boolean }> {
  const related = new Map<string, RelatedArtist>();
  const seeds = suggestionSeeds(ranked, blocked);
  let successes = 0;
  const responses = await Promise.all(seeds.map(async seed => {
    try {
      const res = await request(`/api/similar-artists?artist_mbid=${encodeURIComponent(seed.mbid)}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const body = await res.json();
      if (!Array.isArray(body.artists)) return null;
      return { seed, artists: body.artists.filter((a: Partial<RelatedArtist> & { score?: number }) =>
        typeof a.mbid === 'string' && /^[0-9a-f-]{36}$/i.test(a.mbid) && typeof a.name === 'string' && typeof a.score === 'number' && Number.isFinite(a.score) && a.score > 0) as { mbid: string; name: string; score: number }[] };
    } catch { return null; }
  }));
  for (const response of responses) {
    if (!response) continue;
    successes++;
    const max = Math.max(1, ...response.artists.map(a => a.score));
    const seen = new Set<string>();
    for (const artist of response.artists) {
      if (seen.has(artist.mbid) || blocked.some(name => normalize(name) === normalize(artist.name))) continue;
      seen.add(artist.mbid);
      const entry = related.get(artist.mbid) ?? { mbid: artist.mbid, name: artist.name, strength: 0, sources: [] };
      entry.strength += artist.score / max;
      entry.sources.push(response.seed.name);
      related.set(artist.mbid, entry);
    }
  }
  const connections = [...related.values()].sort((a, b) => b.strength - a.strength);
  const albums: Album[] = [];
  // A small bounded browse supplies genuinely new artists when the local
  // catalogue has no albums for a strong connection. No discovery writes.
  const known = new Set([...ranked, ...pool].map(a => normalize(a.primary_artist_name)));
  for (const artist of connections.filter(a => !known.has(normalize(a.name))).slice(0, 2)) {
    try {
      const params = new URLSearchParams({ artist_mbid: artist.mbid, artist_name: artist.name });
      const res = await request(`/api/browse-artist?${params}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) albums.push(...parseAlbumArray((await res.json()).albums));
    } catch { /* Existing catalogue suggestions remain available. */ }
  }
  return { related: connections, albums, unavailable: seeds.length > 0 && successes === 0 };
}
