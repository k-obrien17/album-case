import type { VercelResponse } from '@vercel/node';

// Temporary containment while the app has no owner-write authentication: the
// fixed session/owner ID in client code is not a secret, so anyone who finds
// the URL can currently write. Gates every mutating endpoint until a real
// owner-write gate (signed cookie / server-side token) replaces this. See
// README "Security / deployment status".
export function publicWritesAllowed(): boolean {
  return process.env.ALLOW_PUBLIC_WRITES === 'true';
}

export function blockWrite(res: VercelResponse): void {
  res.status(503).json({ error: 'writes_disabled' });
}
