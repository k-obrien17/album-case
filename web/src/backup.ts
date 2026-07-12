import type { SavedLists } from './lists';
import type { Album, RankedAlbum, RankingState } from './ranking/types';
import { parseAlbum } from './album';
import { ratingForDropIndex } from './ranking/rating';

type BackupBundle = {
  version: 1;
  exported_at: string;
  ranking: RankingState;
  lists: SavedLists;
};

type ParseResult =
  | { ok: true; state: RankingState; lists: SavedLists | null }
  | { ok: false; error: string };

function albumMap(pool: Album[]): Map<string, Album> {
  return new Map(pool.map((album) => [album.mbid, album]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve one raw album JSON entry against the pool: if the album is still
 * in the seed we prefer the pool's canonical record (fresh cover, etc.),
 * otherwise we keep the stored record so a previously-ranked album that left
 * the seed is never dropped. Returns null for a malformed entry (not a valid
 * album). Shared by canonicalAlbums and canonicalRankedAlbums so the
 * pool-preference logic lives in exactly one place. */
function canonicalAlbum(item: unknown, byId: Map<string, Album>): Album | null {
  const stored = parseAlbum(item);
  if (!stored) return null;
  return byId.get(stored.mbid) ?? stored;
}

/** Resolve a stored album list against the current pool. A backup must
 * survive seed changes -- see canonicalAlbum. Only a malformed or duplicate
 * entry rejects the import. Used for the non-ranked lists (wantToListen/
 * notHeard/dontCare), which never carry a rating. */
function canonicalAlbums(value: unknown, pool: Album[]): Album[] | null {
  if (!Array.isArray(value)) return null;

  const byId = albumMap(pool);
  const seen = new Set<string>();
  const albums: Album[] = [];

  for (const item of value) {
    const album = canonicalAlbum(item, byId);
    if (!album || seen.has(album.mbid)) return null;
    seen.add(album.mbid);
    albums.push(album);
  }

  return albums;
}

/** Same pool-resolution as canonicalAlbums, but for the ranked list: each
 * entry's OWN stored `rating` is preserved when present -- the common case,
 * since any backup taken after ratings became the source of truth carries
 * real, owner-set values that must survive a round-trip untouched. Only
 * falls back to recomputing a rating from list position (ratingForDropIndex)
 * when the raw entry has no valid numeric rating, i.e. a legacy backup taken
 * before ratings existed. Built incrementally so a recomputed fallback still
 * accounts for previously-placed albums in the same import. */
function canonicalRankedAlbums(value: unknown, pool: Album[]): RankedAlbum[] | null {
  if (!Array.isArray(value)) return null;

  const byId = albumMap(pool);
  const seen = new Set<string>();
  const ranked: RankedAlbum[] = [];

  for (const item of value) {
    const album = canonicalAlbum(item, byId);
    if (!album || seen.has(album.mbid)) return null;
    seen.add(album.mbid);

    const rawRating = isObject(item) ? item.rating : undefined;
    const rating = typeof rawRating === 'number' ? rawRating : ratingForDropIndex(ranked, ranked.length);
    ranked.push({ ...album, rating });
  }

  return ranked;
}

function parseLists(value: unknown, pool: Album[]): SavedLists | null {
  if (!isObject(value)) return null;
  const wantToListen = canonicalAlbums(value.wantToListen, pool);
  const notHeard = canonicalAlbums(value.notHeard, pool);
  // dontCare was added after v1 backups shipped; a missing key is a valid
  // older file, so default to an empty list rather than rejecting the import.
  const dontCare = value.dontCare === undefined ? [] : canonicalAlbums(value.dontCare, pool);
  if (!wantToListen || !notHeard || !dontCare) return null;
  return { wantToListen, notHeard, dontCare };
}

export function createRankingBackup(state: RankingState, lists: SavedLists): string {
  const bundle: BackupBundle = {
    version: 1,
    exported_at: new Date().toISOString(),
    ranking: { ranked: state.ranked, pending: null },
    lists,
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseRankingBackup(raw: string, pool: Album[]): ParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'backup is not valid JSON' };
  }

  if (!isObject(payload)) return { ok: false, error: 'backup must be a JSON object' };

  const rankingSource = isObject(payload.ranking) ? payload.ranking : payload;
  const ranked = canonicalRankedAlbums(rankingSource.ranked, pool);
  if (!ranked) return { ok: false, error: 'backup contains a malformed or duplicate album entry' };

  const lists = parseLists(payload.lists, pool);
  return {
    ok: true,
    state: { ranked, pending: null },
    lists,
  };
}
