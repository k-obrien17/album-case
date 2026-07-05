import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';

type SnapshotPayload = {
  session_id: string;
  ranked: string[];
  lists: {
    wantToListen: string[];
    notHeard: string[];
    dontCare: string[];
  };
};

type SnapshotResponse = {
  snapshot: null | {
    ranked: string[];
    lists: {
      wantToListen: string[];
      notHeard: string[];
      dontCare?: string[];
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
      dontCare: lists.dontCare.map((album) => album.mbid),
    },
  };
}

export async function saveRankingSnapshot(
  sessionId: string,
  state: RankingState,
  lists: SavedLists
): Promise<void> {
  try {
    const response = await fetch('/api/ranking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshotPayload(sessionId, state, lists)),
    });
    // Fire-and-forget, but not silently-blind: surface a non-2xx so a 400/500
    // is distinguishable from success. LocalStorage stays the source of truth.
    if (!response.ok) {
      console.warn('tastetest: ranking snapshot save failed', response.status);
    }
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

  // Parse inside try/catch: a 200 carrying non-JSON (an SPA/HTML fallback when
  // no API is running) must boot the app to empty state, never crash it.
  let body: SnapshotResponse;
  try {
    body = (await response.json()) as SnapshotResponse;
  } catch {
    return null;
  }
  if (!body || !body.snapshot) return null;

  const ranked = albumsFromIds(body.snapshot.ranked, pool);
  const wantToListen = albumsFromIds(body.snapshot.lists.wantToListen, pool);
  const notHeard = albumsFromIds(body.snapshot.lists.notHeard, pool);
  // Older snapshots predate dontCare; a missing list is an empty list.
  const dontCare = albumsFromIds(body.snapshot.lists.dontCare ?? [], pool);
  if (!ranked || !wantToListen || !notHeard || !dontCare) return null;

  return {
    state: { ranked, pending: null },
    lists: { wantToListen, notHeard, dontCare },
  };
}
