import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireWriteKey } from './_writeKey';

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('requireWriteKey (opt-in enforcement, off unless ALBUM_CASE_ENFORCE_WRITE_KEY=1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when enforcement is off, even in production with a key still configured', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    const res = makeRes();

    expect(requireWriteKey({ headers: {} } as never, res as never)).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });

  it('fails closed with 500 when enforcement is on but no key is configured', () => {
    vi.stubEnv('ALBUM_CASE_ENFORCE_WRITE_KEY', '1');
    const res = makeRes();

    expect(requireWriteKey({ headers: {} } as never, res as never)).toBe(false);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'missing_write_key' });
  });

  it('rejects a missing header with 401 once enforcement is on', () => {
    vi.stubEnv('ALBUM_CASE_ENFORCE_WRITE_KEY', '1');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    const res = makeRes();

    expect(requireWriteKey({ headers: {} } as never, res as never)).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'write_key_required' });
  });

  it('rejects a wrong key, including one of a different length', () => {
    vi.stubEnv('ALBUM_CASE_ENFORCE_WRITE_KEY', '1');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    for (const provided of ['secret-124', 'short', 'secret-123-and-more']) {
      const res = makeRes();
      expect(requireWriteKey({ headers: { 'x-album-case-write-key': provided } } as never, res as never)).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });

  it('accepts the matching key', () => {
    vi.stubEnv('ALBUM_CASE_ENFORCE_WRITE_KEY', '1');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    const res = makeRes();

    expect(requireWriteKey({ headers: { 'x-album-case-write-key': 'secret-123' } } as never, res as never)).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
