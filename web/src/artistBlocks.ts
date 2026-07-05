import type { Album } from './ranking/types';
import { artistKeys } from './priority';

const BLOCKED_ARTISTS_KEY = 'tastetest-blocked-artists';

let memoryBlockedArtists: string[] = [];

function hasSameArtist(artists: string[], artistName: string): boolean {
  const keys = new Set(artistKeys(artistName));
  return artists.some((artist) => artistKeys(artist).some((key) => keys.has(key)));
}

export function loadBlockedArtists(): string[] {
  if (typeof localStorage === 'undefined') return memoryBlockedArtists;

  try {
    const raw = localStorage.getItem(BLOCKED_ARTISTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch (err) {
    console.warn('tastetest: failed to read blocked artists from localStorage, using memory', err);
    return memoryBlockedArtists;
  }
}

export function saveBlockedArtists(artists: string[]): void {
  memoryBlockedArtists = artists;
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(BLOCKED_ARTISTS_KEY, JSON.stringify(artists));
  } catch (err) {
    console.warn('tastetest: failed to persist blocked artists, continuing in-memory', err);
  }
}

export function addBlockedArtist(artists: string[], artistName: string): string[] {
  const trimmed = artistName.trim();
  if (!trimmed || hasSameArtist(artists, trimmed)) return artists;
  return [...artists, trimmed];
}

export function removeBlockedArtist(artists: string[], artistName: string): string[] {
  const keys = new Set(artistKeys(artistName));
  return artists.filter((artist) => !artistKeys(artist).some((key) => keys.has(key)));
}

export function blockedArtistMbids(pool: Album[], artists: string[]): Set<string> {
  const blockedKeys = new Set(artists.flatMap((artist) => artistKeys(artist)));
  const ids = new Set<string>();
  for (const album of pool) {
    if (artistKeys(album.primary_artist_name).some((key) => blockedKeys.has(key))) {
      ids.add(album.mbid);
    }
  }
  return ids;
}
