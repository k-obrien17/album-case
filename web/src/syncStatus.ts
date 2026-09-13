const PENDING_SYNC_STORAGE = 'albumcase-pending-sync';
let memoryPendingSync = false;
const CONFLICT_STORAGE = 'albumcase-sync-conflict';
let memoryConflict = false;
const BASE_STORAGE = 'albumcase-sync-base';
let memoryBase: number | null | undefined;

/** The acknowledged server revision that the cached edits were made against. */
export function loadSyncBase(): number | null | undefined {
  if (typeof localStorage === 'undefined') return memoryBase;
  try {
    const raw = localStorage.getItem(BASE_STORAGE);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0) ? value : undefined;
  } catch { return memoryBase; }
}

export function saveSyncBase(value: number | null): void {
  memoryBase = value;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(BASE_STORAGE, JSON.stringify(value)); } catch { /* in-memory fallback */ }
}

export function pendingBaseConflicts(pending: boolean, cachedBase: number | null | undefined, serverBase: number | null): boolean {
  return pending && cachedBase !== serverBase && !(cachedBase === undefined && serverBase === null);
}

export function hasSyncConflict(): boolean {
  if (typeof localStorage === 'undefined') return memoryConflict;
  try { return localStorage.getItem(CONFLICT_STORAGE) === '1'; } catch { return memoryConflict; }
}

export function markSyncConflict(): void {
  memoryConflict = true;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CONFLICT_STORAGE, '1'); } catch { /* in-memory fallback */ }
}

export function clearSyncConflict(): void {
  memoryConflict = false;
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(CONFLICT_STORAGE); } catch { /* in-memory fallback */ }
}

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
