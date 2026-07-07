import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';
import { parseAlbum } from './album';

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

/** Resolve a stored album list against the current pool. A backup must
 * survive seed changes: if an album is still in the seed we prefer the pool's
 * canonical record (fresh cover, etc.), otherwise we keep the stored record so
 * a previously-ranked album that left the seed is never dropped. Only a
 * malformed entry (not a valid album) rejects the import. */
function canonicalAlbums(value: unknown, pool: Album[]): Album[] | null {
  if (!Array.isArray(value)) return null;

  const byId = albumMap(pool);
  const seen = new Set<string>();
  const albums: Album[] = [];

  for (const item of value) {
    const stored = parseAlbum(item);
    if (!stored || seen.has(stored.mbid)) return null;
    seen.add(stored.mbid);
    albums.push(byId.get(stored.mbid) ?? stored);
  }

  return albums;
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
  const ranked = canonicalAlbums(rankingSource.ranked, pool);
  if (!ranked) return { ok: false, error: 'backup contains a malformed or duplicate album entry' };

  const lists = parseLists(payload.lists, pool);
  return {
    ok: true,
    state: { ranked, pending: null },
    lists,
  };
}
