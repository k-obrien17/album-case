/** An anonymous, zero-setup player session (no account, no PII). */
export type Session = {
  session_id: string;
  created_at: number;
};

const SESSION_KEY = 'tastetest-session';

// In-memory fallback used whenever localStorage is unavailable or throws
// (private browsing, quota exceeded, or a non-browser environment such as a
// test runner) so the loop never crashes -- it just won't persist across a
// real page reload in that case.
let memorySession: Session | null = null;

function readStoredSession(): Session | null {
  if (typeof localStorage === 'undefined') return memorySession;

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch (err) {
    console.warn('tastetest: failed to read session from localStorage, using in-memory session', err);
    return memorySession;
  }
}

function writeStoredSession(session: Session): void {
  memorySession = session;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn('tastetest: failed to persist session to localStorage, continuing in-memory', err);
  }
}

/**
 * Read the player's existing anonymous session from `tastetest-session`, or
 * create and persist a new one. Idempotent: repeated calls within the same
 * page load (or across reloads, once persisted) return the same session.
 */
export function getOrCreateSession(): Session {
  const existing = readStoredSession();
  if (existing) return existing;

  const session: Session = {
    session_id: crypto.randomUUID(),
    created_at: Date.now(),
  };
  writeStoredSession(session);
  return session;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `s` looks like a canonical UUID (the shape `crypto.randomUUID`
 * mints). Used to validate a user-pasted restore code before trusting it as a
 * session id.
 */
export function isValidSessionId(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

/**
 * Adopt an explicit session id (the player's restore code) and persist it to
 * `tastetest-session`, so a wiped browser or a new device can reattach to a
 * server-side ranking snapshot. Preserves the existing `created_at` when the
 * id is unchanged; otherwise stamps a fresh one. Returns the written session.
 */
export function setSession(id: string): Session {
  const trimmed = id.trim();
  const existing = readStoredSession();
  const created_at =
    existing && existing.session_id === trimmed ? existing.created_at : Date.now();

  const session: Session = { session_id: trimmed, created_at };
  writeStoredSession(session);
  return session;
}
