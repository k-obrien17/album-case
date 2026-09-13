import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPendingSync, hasPendingSync, markPendingSync, loadSyncBase, saveSyncBase, pendingBaseConflicts } from './syncStatus';

describe('pending sync flag', () => {
  afterEach(() => {
    clearPendingSync();
    vi.unstubAllGlobals();
  });

  it('tracks whether local changes have been confirmed saved', () => {
    expect(hasPendingSync()).toBe(false);

    markPendingSync();
    expect(hasPendingSync()).toBe(true);

    clearPendingSync();
    expect(hasPendingSync()).toBe(false);
  });

  it('round-trips the acknowledged base separately from pending edits', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    expect(loadSyncBase()).toBeUndefined();
    saveSyncBase(123);
    markPendingSync();
    expect(loadSyncBase()).toBe(123);
    expect(pendingBaseConflicts(hasPendingSync(), loadSyncBase(), 124)).toBe(true);
    expect(pendingBaseConflicts(hasPendingSync(), loadSyncBase(), 123)).toBe(false);
    saveSyncBase(null);
    expect(loadSyncBase()).toBeNull();
  });

  it('protects legacy pending caches with no saved revision while allowing clean loads', () => {
    expect(pendingBaseConflicts(true, undefined, 123)).toBe(true);
    expect(pendingBaseConflicts(false, undefined, 123)).toBe(false);
    expect(pendingBaseConflicts(true, null, null)).toBe(false);
    expect(pendingBaseConflicts(true, undefined, null)).toBe(false);
  });
});
