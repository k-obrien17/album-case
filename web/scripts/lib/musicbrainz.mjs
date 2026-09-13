/**
 * Shared MusicBrainz genre lookup for the genre-backfill scripts
 * (backfill-genres-discovered.mjs, backfill-genres-snapshot.mjs,
 * backfill-genres-seed.mjs). Same fetch/rate-limit/retry shape as
 * resolve-curated-list-mbids.mjs and import-spotify-albums.mjs, which don't
 * export it -- kept as a small shared helper here rather than duplicating a
 * fourth copy, without touching those existing scripts.
 */
import { topGenres } from '../../api/_lp.ts';

export const MB_BASE = 'https://musicbrainz.org/ws/2';
export const USER_AGENT = 'AlbumCase/0.1 (keith@totalemphasis.com)';
export const MB_DELAY_MS = 1000;

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches a release-group's top genre tags by mbid. 3-try retry with the
// same backoff resolve-curated-list-mbids.mjs uses for MusicBrainz's
// transient 503s. A 404 (mbid no longer exists upstream) is not transient --
// returns [] immediately instead of burning retries.
export async function fetchGenresForMbid(mbid) {
  const params = new URLSearchParams({ inc: 'genres', fmt: 'json' });
  let lastStatus;
  for (const backoffMs of [0, 2000, 4000]) {
    if (backoffMs > 0) await delay(backoffMs);
    const res = await fetch(`${MB_BASE}/release-group/${mbid}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.ok) {
      const group = await res.json();
      return topGenres(group);
    }
    if (res.status === 404) return [];
    lastStatus = res.status;
  }
  throw new Error(`musicbrainz_${lastStatus}`);
}
