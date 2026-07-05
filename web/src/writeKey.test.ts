import { afterEach, describe, expect, it } from 'vitest';
import { clearWriteKey, getWriteKey, hasWriteKey, setWriteKey, writeKeyHeaders } from './writeKey';

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
