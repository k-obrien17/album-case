import type { VercelRequest, VercelResponse } from '@vercel/node';

export const WRITE_KEY_HEADER = 'x-album-case-write-key';
export const WRITE_KEY_ENV = 'ALBUM_CASE_WRITE_KEY';

// Write-key enforcement is dropped for now (Keith's call -- single-owner
// app, the key was causing more harm than good: a browser that never got
// unlocked silently cached ratings locally instead of saving them). Kept
// as a pass-through rather than deleted from the three call sites, so
// re-enabling is a one-function revert if this gets reconsidered.
export function requireWriteKey(_req: VercelRequest, _res: VercelResponse): boolean {
  return true;
}
