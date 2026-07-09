import type { Album } from './ranking/types';
import { artistKeys } from './priority';

const CANDIDATE_ARTIST_COOLDOWN_KEY = 'albumcase-candidate-artist-cooldown';
const DEFAULT_COOLDOWN_LIMIT = 8;

export function albumArtistKey(album: Album): string {
  return album.primary_artist_mbid ?? artistKeys(album.primary_artist_name)[0] ?? album.primary_artist_name;
}

export function pushArtistCooldown(
  recentArtistKeys: string[],
  album: Album | null,
  limit = DEFAULT_COOLDOWN_LIMIT
): string[] {
  if (!album) return recentArtistKeys;
  const key = albumArtistKey(album);
  return [...recentArtistKeys.filter((recent) => recent !== key), key].slice(-limit);
}

export function applyArtistCooldown(
  pool: Album[],
  ranked: Album[],
  excluded: Set<string>,
  recentArtistKeys: string[]
): Set<string> {
  if (recentArtistKeys.length === 0) return excluded;

  const recent = new Set(recentArtistKeys);
  const rankedIds = new Set(ranked.map((album) => album.mbid));
  const eligible = pool.filter((album) => !rankedIds.has(album.mbid) && !excluded.has(album.mbid));
  if (eligible.some((album) => !recent.has(albumArtistKey(album)))) {
    const next = new Set(excluded);
    for (const album of eligible) {
      if (recent.has(albumArtistKey(album))) next.add(album.mbid);
    }
    return next;
  }

  return excluded;
}

export function loadCandidateArtistCooldown(): string[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(CANDIDATE_ARTIST_COOLDOWN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function saveCandidateArtistCooldown(recentArtistKeys: string[]): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(CANDIDATE_ARTIST_COOLDOWN_KEY, JSON.stringify(recentArtistKeys));
  } catch {
    // Non-critical: cooldown only improves candidate variety.
  }
}
