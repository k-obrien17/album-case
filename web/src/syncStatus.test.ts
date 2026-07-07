import { afterEach, describe, expect, it } from 'vitest';
import { clearPendingSync, hasPendingSync, markPendingSync } from './syncStatus';

describe('pending sync flag', () => {
  afterEach(() => {
    clearPendingSync();
  });

  it('tracks whether local changes have been confirmed saved', () => {
    expect(hasPendingSync()).toBe(false);

    markPendingSync();
    expect(hasPendingSync()).toBe(true);

    clearPendingSync();
    expect(hasPendingSync()).toBe(false);
  });
});
