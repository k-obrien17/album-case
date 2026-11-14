import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

export const WRITE_KEY_HEADER = 'x-album-case-write-key';
export const WRITE_KEY_ENV = 'ALBUM_CASE_WRITE_KEY';
export const ENFORCE_ENV = 'ALBUM_CASE_ENFORCE_WRITE_KEY';

function timingSafeMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

/**
 * Opt-in write protection, off by default. It enforces only when
 * ALBUM_CASE_ENFORCE_WRITE_KEY=1 AND ALBUM_CASE_WRITE_KEY is set, so deploying
 * this code changes nothing by itself (a stale ALBUM_CASE_WRITE_KEY is still in
 * the production environment from when enforcement was on; its presence alone
 * must not lock the owner out). The key was dropped 2026-08-11 because an
 * unlocked browser cached ratings locally instead of saving them; the client
 * now shows an explicit locked state on a 401 instead of failing silently.
 * Once enforcement is on, every mutation route rejects requests without the
 * matching header, and enforcement fails closed if the flag is on but no key
 * is configured.
 */
export function requireWriteKey(req: VercelRequest, res: VercelResponse): boolean {
  if (process.env[ENFORCE_ENV] !== '1') return true;

  const expected = process.env[WRITE_KEY_ENV];
  if (!expected) {
    res.status(500).json({ error: 'missing_write_key' });
    return false;
  }

  const provided = req.headers[WRITE_KEY_HEADER];
  if (typeof provided !== 'string' || !timingSafeMatch(expected, provided)) {
    res.status(401).json({ error: 'write_key_required' });
    return false;
  }
  return true;
}
