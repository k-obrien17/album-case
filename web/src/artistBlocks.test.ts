import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album } from './ranking/types';
import {
  addBlockedArtist,
  blockedArtistMbids,
  loadBlockedArtists,
  removeBlockedArtist,
  saveBlockedArtists,
} from './artistBlocks';

function album(mbid: string, artist: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: artist,
    release_year: 2000,
    cover_url: '',
  };
}

describe('artistBlocks', () => {
  afterEach(() => {
    saveBlockedArtists([]);
    vi.restoreAllMocks();
  });

  it('persists blocked artists in localStorage', () => {
    saveBlockedArtists(['Radiohead']);

    expect(loadBlockedArtists()).toEqual(['Radiohead']);
  });

  it('dedupes blocked artists while preserving the first spelling', () => {
    expect(addBlockedArtist(['Radiohead'], 'radiohead')).toEqual(['Radiohead']);
  });

  it('removes blocked artists case-insensitively', () => {
    expect(removeBlockedArtist(['Radiohead', 'GZA'], 'radiohead')).toEqual(['GZA']);
  });

  it('returns mbids for albums by blocked artists', () => {
    const pool = [
      album('a', 'Radiohead'),
      album('b', 'The Smile'),
      album('c', 'Genius/GZA'),
    ];

    expect(blockedArtistMbids(pool, ['GZA'])).toEqual(new Set(['c']));
  });
});
