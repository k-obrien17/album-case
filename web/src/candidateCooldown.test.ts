import { describe, expect, it } from 'vitest';
import type { Album } from './ranking/types';
import { albumArtistKey, applyArtistCooldown, pushArtistCooldown } from './candidateCooldown';

function album(mbid: string, artist: string, artistMbid = `${artist}-mbid`): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: artist,
    primary_artist_mbid: artistMbid,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

describe('candidate artist cooldown', () => {
  it('uses the artist mbid when available', () => {
    expect(albumArtistKey(album('a', 'Radiohead', 'artist-1'))).toBe('artist-1');
  });

  it('pushes the newest artist and de-dupes older entries', () => {
    expect(pushArtistCooldown(['a', 'b'], album('x', 'Artist A', 'a'), 3)).toEqual(['b', 'a']);
  });

  it('temporarily excludes recently shown artists when other artists are eligible', () => {
    const pool = [album('r1', 'Radiohead', 'r'), album('r2', 'Radiohead', 'r'), album('n1', 'Nirvana', 'n')];
    const excluded = applyArtistCooldown(pool, [], new Set(), ['r']);

    expect([...excluded].sort()).toEqual(['r1', 'r2']);
  });

  it('does not exclude the only remaining artist', () => {
    const pool = [album('r1', 'Radiohead', 'r'), album('r2', 'Radiohead', 'r')];
    const excluded = applyArtistCooldown(pool, [album('r1', 'Radiohead', 'r')], new Set(), ['r']);

    expect([...excluded]).toEqual([]);
  });
});
