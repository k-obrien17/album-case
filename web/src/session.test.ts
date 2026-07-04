import { describe, it, expect } from 'vitest';
import { getOrCreateSession } from './session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('getOrCreateSession', () => {
  it('creates a session with a UUID id and a numeric created_at timestamp', () => {
    const session = getOrCreateSession();
    expect(session.session_id).toMatch(UUID_RE);
    expect(typeof session.created_at).toBe('number');
  });

  it('is idempotent: a second call returns the same session', () => {
    const first = getOrCreateSession();
    const second = getOrCreateSession();
    expect(second.session_id).toBe(first.session_id);
    expect(second.created_at).toBe(first.created_at);
  });
});
