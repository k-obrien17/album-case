import { describe, it, expect } from 'vitest';
import { getOrCreateSession, isValidSessionId, setSession } from './session';
import { OWNER_ID } from './owner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('getOrCreateSession', () => {
  it('returns the fixed OWNER_ID (single-user app), which is UUID-shaped', () => {
    const session = getOrCreateSession();
    expect(session.session_id).toBe(OWNER_ID);
    expect(session.session_id).toMatch(UUID_RE);
    expect(typeof session.created_at).toBe('number');
  });

  it('is idempotent: a second call returns the same owner session', () => {
    const first = getOrCreateSession();
    const second = getOrCreateSession();
    expect(second.session_id).toBe(OWNER_ID);
    expect(second.session_id).toBe(first.session_id);
    expect(second.created_at).toBe(first.created_at);
  });
});

describe('isValidSessionId', () => {
  it('accepts a canonical UUID, any case, tolerant of surrounding whitespace', () => {
    expect(isValidSessionId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isValidSessionId('  11111111-1111-4111-8111-111111111111  ')).toBe(true);
    expect(isValidSessionId('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
    expect(isValidSessionId(OWNER_ID)).toBe(true);
  });

  it('rejects non-UUID strings and non-string inputs', () => {
    expect(isValidSessionId('not-a-code')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('11111111111111111111111111111111')).toBe(false);
    expect(isValidSessionId('zzzzzzzz-1111-4111-8111-111111111111')).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
    expect(isValidSessionId(42)).toBe(false);
  });
});

describe('setSession', () => {
  it('returns the written session for the given id', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const written = setSession(id);

    expect(written.session_id).toBe(id);
    expect(typeof written.created_at).toBe('number');
  });

  it('trims the id before persisting it', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const written = setSession(`  ${id}  `);
    expect(written.session_id).toBe(id);
  });

  it('preserves created_at when the id is unchanged, refreshes it when it changes', () => {
    const idA = '44444444-4444-4444-8444-444444444444';
    const first = setSession(idA);
    const again = setSession(idA);
    expect(again.created_at).toBe(first.created_at);

    const idB = '55555555-5555-4555-8555-555555555555';
    const changed = setSession(idB);
    expect(changed.session_id).toBe(idB);
    expect(changed.created_at).toBeGreaterThanOrEqual(first.created_at);
  });
});
