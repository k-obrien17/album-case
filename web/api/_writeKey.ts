import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

export const WRITE_KEY_HEADER = 'x-album-case-write-key';
export const WRITE_KEY_ENV = 'ALBUM_CASE_WRITE_KEY';

const PROD_ENV = new Set(['production', 'preview']);

function envRequiresKey(): boolean {
  return PROD_ENV.has(process.env.VERCEL_ENV ?? '');
}

function timingSafeMatch(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return timingSafeEqual(expectedBytes, providedBytes);
}

export function requireWriteKey(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env[WRITE_KEY_ENV];
  if (!expected) {
    if (envRequiresKey()) {
      res.status(500).json({ error: 'missing_write_key' });
      return false;
    }
    return true;
  }

  const provided = req.headers[WRITE_KEY_HEADER];
  if (typeof provided !== 'string' || !timingSafeMatch(expected, provided)) {
    res.status(401).json({ error: 'write_key_required' });
    return false;
  }

  return true;
}
