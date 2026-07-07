const WRITE_KEY_STORAGE = 'albumcase-write-key';
const WRITE_KEY_HEADER = 'x-album-case-write-key';
let memoryWriteKey: string | null = null;

function readStoredWriteKey(): string | null {
  if (typeof localStorage === 'undefined') return memoryWriteKey;
  try {
    const raw = localStorage.getItem(WRITE_KEY_STORAGE);
    return raw ? raw.trim() : memoryWriteKey;
  } catch {
    return memoryWriteKey;
  }
}

function writeStoredWriteKey(value: string): void {
  memoryWriteKey = value.trim();
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WRITE_KEY_STORAGE, memoryWriteKey);
  } catch {
    // Ignore storage failures; writes can still be attempted for this session.
  }
}

function clearStoredWriteKey(): void {
  memoryWriteKey = null;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(WRITE_KEY_STORAGE);
  } catch {
    // Ignore storage failures.
  }
}

export function getWriteKey(): string | null {
  return readStoredWriteKey();
}

export function setWriteKey(value: string): void {
  writeStoredWriteKey(value);
}

export function clearWriteKey(): void {
  clearStoredWriteKey();
}

export function hasWriteKey(): boolean {
  return getWriteKey() !== null;
}

export function writeKeyHeaders(): HeadersInit {
  const key = getWriteKey();
  return key ? { [WRITE_KEY_HEADER]: key } : {};
}

/**
 * Pull a write key out of a `?key=...` query string (a bookmarkable
 * auto-unlock link -- visit it once per device, never re-type the key
 * again). Pure so the parsing is testable without touching `window`.
 */
export function extractKeyFromSearch(search: string): string | null {
  const key = new URLSearchParams(search).get('key');
  return key && key.trim() ? key.trim() : null;
}
