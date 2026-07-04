import { describe, it, expect } from 'vitest';
import type { Album } from './types';
import { insertAt, moveItem } from './order';

function album(mbid: string): Album {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
  };
}

const ids = (albums: Album[]) => albums.map((a) => a.mbid);

describe('insertAt', () => {
  it('inserts at the given index producing the expected order', () => {
    const ranked = [album('a'), album('b'), album('c')];
    expect(ids(insertAt(ranked, album('x'), 1))).toEqual(['a', 'x', 'b', 'c']);
  });

  it('seats the first album into an empty list at index 0', () => {
    expect(ids(insertAt([], album('first'), 0))).toEqual(['first']);
  });

  it('clamps an over-the-end index to an append', () => {
    const ranked = [album('a'), album('b')];
    expect(ids(insertAt(ranked, album('z'), 99))).toEqual(['a', 'b', 'z']);
  });

  it('does not mutate the input', () => {
    const ranked = [album('a'), album('b')];
    insertAt(ranked, album('c'), 0);
    expect(ids(ranked)).toEqual(['a', 'b']);
  });
});

describe('moveItem', () => {
  it('moves an earlier item to a later position', () => {
    const ranked = [album('a'), album('b'), album('c'), album('d')];
    // remove index 0 (a), insert at index 2 of the remainder [b,c,d]
    expect(ids(moveItem(ranked, 0, 2))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a later item to an earlier position', () => {
    const ranked = [album('a'), album('b'), album('c')];
    expect(ids(moveItem(ranked, 2, 0))).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op copy when from is out of range', () => {
    const ranked = [album('a'), album('b')];
    expect(ids(moveItem(ranked, 5, 0))).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const ranked = [album('a'), album('b'), album('c')];
    moveItem(ranked, 0, 2);
    expect(ids(ranked)).toEqual(['a', 'b', 'c']);
  });
});
