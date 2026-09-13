import type { SavedLists } from './lists';
import type { Album, ArtistLock, RankedAlbum, RankingState } from './ranking/types';
import { writeKeyHeaders } from './writeKey';
import { parseAlbumArray, parseRankedAlbumArray } from './album';
import { parseBacklog, type Backlog } from '../shared/backlog';

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
  backlog?: Backlog<Album>;
};

type SnapshotPayload = {
  session_id: string;
  ranked: Album[];
  lists: SnapshotLists;
  artist_locks: ArtistLock[];
  blocked_artists: string[];
  curated_skips: string[];
  base_updated_at?: number | null;
};

type SnapshotResponse = {
  snapshot: null | {
    ranked: Album[];
    lists: {
      wantToListen: Album[];
      notHeard: Album[];
      // Older snapshots predate dontCare; a missing bucket is an empty list.
      dontCare?: Album[];
      backlog?: Backlog<Album>;
    };
    // Older snapshots predate artist locks/blocked artists/curated skips; a
    // missing field is empty.
    artist_locks?: ArtistLock[];
    blocked_artists?: string[];
    curated_skips?: string[];
    updated_at: number;
  };
};

export type RankingSnapshotLoad =
  | {
      status: 'found';
      ranked: RankedAlbum[];
      lists: SavedLists;
      artistLocks: ArtistLock[];
      blockedArtists: string[];
      curatedSkips: string[];
      updatedAt: number;
    }
  | { status: 'missing' }
  | { status: 'error' };

export type RankingSnapshotSave =
  | { status: 'saved'; updatedAt: number }
  | { status: 'conflict' }
  | { status: 'error' };

export function snapshotPayload(
  sessionId: string,
  state: RankingState,
  lists: SavedLists,
  artistLocks: ArtistLock[],
  blockedArtists: string[],
  curatedSkips: string[],
  baseUpdatedAt?: number | null
): SnapshotPayload {
  const payload: SnapshotPayload = {
    session_id: sessionId,
    ranked: state.ranked,
    lists: {
      wantToListen: lists.wantToListen,
      notHeard: lists.notHeard,
      dontCare: lists.dontCare,
      ...(lists.backlog && { backlog: lists.backlog }),
    },
    artist_locks: artistLocks,
    blocked_artists: blockedArtists,
    curated_skips: curatedSkips,
  };
  if (baseUpdatedAt !== undefined) payload.base_updated_at = baseUpdatedAt;
  return payload;
}

export async function saveRankingSnapshot(
  sessionId: string,
  state: RankingState,
  lists: SavedLists,
  artistLocks: ArtistLock[],
  blockedArtists: string[],
  curatedSkips: string[],
  baseUpdatedAt?: number | null
): Promise<RankingSnapshotSave> {
  try {
    const response = await fetch('/api/ranking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...writeKeyHeaders() },
      body: JSON.stringify(
        snapshotPayload(sessionId, state, lists, artistLocks, blockedArtists, curatedSkips, baseUpdatedAt)
      ),
    });
    if (response.status === 409) return { status: 'conflict' };
    // Fire-and-forget, but not silently-blind: surface a non-2xx so a 400/500
    // is distinguishable from success. The offline cache stays usable either way.
    if (!response.ok) {
      console.warn('tastetest: ranking snapshot save failed', response.status);
      return { status: 'error' };
    }

    let body: { updated_at?: unknown };
    try {
      body = (await response.json()) as { updated_at?: unknown };
    } catch {
      return { status: 'error' };
    }
    return typeof body.updated_at === 'number'
      ? { status: 'saved', updatedAt: body.updated_at }
      : { status: 'error' };
  } catch {
    // The server is the source of truth; the offline localStorage cache keeps
    // the loop alive and the next mutation/startup retries the sync.
    return { status: 'error' };
  }
}

export async function loadRankingSnapshotDetailed(sessionId: string): Promise<RankingSnapshotLoad> {
  let response: Response;
  try {
    response = await fetch(`/api/ranking?session_id=${encodeURIComponent(sessionId)}`);
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };

  // Parse inside try/catch: a 200 carrying non-JSON (an SPA/HTML fallback when
  // no API is running) must boot the app to empty state, never crash it.
  let body: SnapshotResponse;
  try {
    body = (await response.json()) as SnapshotResponse;
  } catch {
    return { status: 'error' };
  }
  if (!body || !body.snapshot) return { status: 'missing' };

  // Records are full: no seed-pool resolution needed. Guard array shapes so a
  // malformed payload degrades to empty rather than crashing the loop.
  return {
    status: 'found',
    ranked: parseRankedAlbumArray(body.snapshot.ranked),
    lists: {
      wantToListen: parseAlbumArray(body.snapshot.lists?.wantToListen),
      notHeard: parseAlbumArray(body.snapshot.lists?.notHeard),
      dontCare: parseAlbumArray(body.snapshot.lists?.dontCare),
      ...(body.snapshot.lists?.backlog && {
        backlog: parseBacklog(body.snapshot.lists.backlog, parseAlbumArray) ?? undefined,
      }),
    },
    artistLocks: Array.isArray(body.snapshot.artist_locks) ? body.snapshot.artist_locks : [],
    blockedArtists: Array.isArray(body.snapshot.blocked_artists) ? body.snapshot.blocked_artists : [],
    curatedSkips: Array.isArray(body.snapshot.curated_skips) ? body.snapshot.curated_skips : [],
    updatedAt: body.snapshot.updated_at,
  };
}

export async function loadRankingSnapshot(sessionId: string): Promise<{
  ranked: RankedAlbum[];
  lists: SavedLists;
  artistLocks: ArtistLock[];
  blockedArtists: string[];
  curatedSkips: string[];
} | null> {
  const result = await loadRankingSnapshotDetailed(sessionId);
  if (result.status !== 'found') return null;
  return {
    ranked: result.ranked,
    lists: result.lists,
    artistLocks: result.artistLocks,
    blockedArtists: result.blockedArtists,
    curatedSkips: result.curatedSkips,
  };
}
