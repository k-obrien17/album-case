const PENDING_SYNC_STORAGE = 'albumcase-pending-sync';
let memoryPendingSync = false;

/**
 * Tracks whether the local ranking/lists cache holds changes that have not
 * been confirmed saved to the server. Load-on-open uses this to avoid
 * letting a stale server snapshot silently clobber unsynced local edits (the
 * bug: add an album while writes are locked, refresh, the add vanishes).
 */
function readPendingSync(): boolean {
  if (typeof localStorage === 'undefined') return memoryPendingSync;
  try {
    return localStorage.getItem(PENDING_SYNC_STORAGE) === '1';
  } catch {
    return memoryPendingSync;
  }
}

export function hasPendingSync(): boolean {
  return readPendingSync();
}

export function markPendingSync(): void {
  memoryPendingSync = true;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PENDING_SYNC_STORAGE, '1');
  } catch {
    // Ignore storage failures; the in-memory fallback still tracks this session.
  }
}

export function clearPendingSync(): void {
  memoryPendingSync = false;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_SYNC_STORAGE);
  } catch {
    // Ignore storage failures.
  }
}
