import type { SavedLists } from './lists';
import type { Album, RankingState } from './ranking/types';

/**
 * The snapshot carries FULL album records (not just mbids). The server is the
 * single source of truth, so it must be able to reconstruct the list without
 * any client-side seed pool -- which also makes the stored ranking robust to
 * seed changes (an album that later leaves the seed still renders).
 */
type SnapshotLists = {
  wantToListen: Album[];
  notHeard: Album[];
  dontCare: Album[];
};

type SnapshotPayload = {
  session_id: string;
  ranked: Album[];
  lists: SnapshotLists;
};

type SnapshotResponse = {
  snapshot: null | {
    ranked: Album[];
    lists: {
      wantToListen: Album[];
      notHeard: Album[];
      // Older snapshots predate dontCare; a missing bucket is an empty list.
      dontCare?: Album[];
    };
    updated_at: number;
  };
};

function asAlbumArray(value: unknown): Album[] {
  return Array.isArray(value) ? (value as Album[]) : [];
}

export function snapshotPayload(
  sessionId: string,
  state: RankingState,
  lists: SavedLists
): SnapshotPayload {
  return {
    session_id: sessionId,
    ranked: state.ranked,
    lists: {
      wantToListen: lists.wantToListen,
      notHeard: lists.notHeard,
      dontCare: lists.dontCare,
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
    // is distinguishable from success. The offline cache stays usable either way.
    if (!response.ok) {
      console.warn('tastetest: ranking snapshot save failed', response.status);
    }
  } catch {
    // The server is the source of truth; the offline localStorage cache keeps
    // the loop alive and the next mutation/startup retries the sync.
  }
}

export async function loadRankingSnapshot(
  sessionId: string
): Promise<{ ranked: Album[]; lists: SavedLists } | null> {
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

  // Records are full: no seed-pool resolution needed. Guard array shapes so a
  // malformed payload degrades to empty rather than crashing the loop.
  return {
    ranked: asAlbumArray(body.snapshot.ranked),
    lists: {
      wantToListen: asAlbumArray(body.snapshot.lists?.wantToListen),
      notHeard: asAlbumArray(body.snapshot.lists?.notHeard),
      dontCare: asAlbumArray(body.snapshot.lists?.dontCare),
    },
  };
}
