import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWriteKey,
  extractKeyFromSearch,
  getWriteKey,
  hasWriteKey,
  setWriteKey,
  writeKeyHeaders,
} from './writeKey';

describe('writeKey storage', () => {
  afterEach(() => {
    clearWriteKey();
  });

  it('stores and reads the write key from localStorage', () => {
    expect(hasWriteKey()).toBe(false);

    setWriteKey('  secret-123  ');
    expect(getWriteKey()).toBe('secret-123');
    expect(hasWriteKey()).toBe(true);
    expect(writeKeyHeaders()).toEqual({ 'x-album-case-write-key': 'secret-123' });

    clearWriteKey();
    expect(getWriteKey()).toBeNull();
    expect(hasWriteKey()).toBe(false);
  });
});

describe('extractKeyFromSearch', () => {
  it('reads and trims a key from a bookmarkable auto-unlock URL', () => {
    expect(extractKeyFromSearch('?key=secret-123')).toBe('secret-123');
    expect(extractKeyFromSearch('?key=%20secret-123%20')).toBe('secret-123');
  });

  it('returns null when there is no key param or it is blank', () => {
    expect(extractKeyFromSearch('')).toBeNull();
    expect(extractKeyFromSearch('?other=1')).toBeNull();
    expect(extractKeyFromSearch('?key=')).toBeNull();
  });
});
