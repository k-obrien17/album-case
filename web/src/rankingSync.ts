import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';

type SnapshotPayload = {
  session_id: string;
  ranked: string[];
  lists: {
    wantToListen: string[];
    notHeard: string[];
  };
};

type SnapshotResponse = {
  snapshot: null | {
    ranked: string[];
    lists: {
      wantToListen: string[];
      notHeard: string[];
    };
    updated_at: number;
  };
};

function byMbid(pool: Album[]): Map<string, Album> {
  return new Map(pool.map((album) => [album.mbid, album]));
}

function albumsFromIds(ids: string[], pool: Album[]): Album[] | null {
  const lookup = byMbid(pool);
  const albums: Album[] = [];
  for (const id of ids) {
    const album = lookup.get(id);
    if (!album) return null;
    albums.push(album);
  }
  return albums;
}

export function snapshotPayload(
  sessionId: string,
  state: RankingState,
  lists: SavedLists
): SnapshotPayload {
  return {
    session_id: sessionId,
    ranked: state.ranked.map((album) => album.mbid),
    lists: {
      wantToListen: lists.wantToListen.map((album) => album.mbid),
      notHeard: lists.notHeard.map((album) => album.mbid),
    },
  };
}

export async function saveRankingSnapshot(
  sessionId: string,
  state: RankingState,
  lists: SavedLists
): Promise<void> {
  try {
    await fetch('/api/ranking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshotPayload(sessionId, state, lists)),
    });
  } catch {
    // LocalStorage remains the immediate source of truth; server sync retries
    // on the next mutation/startup.
  }
}

export async function loadRankingSnapshot(
  sessionId: string,
  pool: Album[]
): Promise<{ state: RankingState; lists: SavedLists } | null> {
  let response: Response;
  try {
    response = await fetch(`/api/ranking?session_id=${encodeURIComponent(sessionId)}`);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = (await response.json()) as SnapshotResponse;
  if (!body.snapshot) return null;

  const ranked = albumsFromIds(body.snapshot.ranked, pool);
  const wantToListen = albumsFromIds(body.snapshot.lists.wantToListen, pool);
  const notHeard = albumsFromIds(body.snapshot.lists.notHeard, pool);
  if (!ranked || !wantToListen || !notHeard) return null;

  return {
    state: { ranked, pending: null },
    lists: { wantToListen, notHeard },
  };
}
