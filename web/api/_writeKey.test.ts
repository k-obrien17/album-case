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

  it('always passes, regardless of headers or env -- enforcement is dropped for now', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ALBUM_CASE_WRITE_KEY', 'secret-123');
    const res = makeRes();

    const ok = requireWriteKey({ headers: {} } as never, res as never);

    expect(ok).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });

  it('passes even with no write key configured at all', () => {
    const res = makeRes();

    const ok = requireWriteKey({ headers: {} } as never, res as never);

    expect(ok).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });
});
