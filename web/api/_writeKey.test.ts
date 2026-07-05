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

describe('requireWriteKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a matching write key', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    const res = makeRes();

    const ok = requireWriteKey(
      { headers: { 'x-album-case-write-key': 'secret-123' } } as never,
      res as never
    );

    expect(ok).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });

  it('rejects a missing or wrong key', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    const res = makeRes();

    const ok = requireWriteKey({ headers: {} } as never, res as never);

    expect(ok).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'write_key_required' });
  });
});
