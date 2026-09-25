// Bounds how long a handler waits on a Turso call, mirroring the
// AbortController timeout every MusicBrainz/ListenBrainz fetch already uses
// (see _lp.ts). @libsql/client doesn't expose a clean cancellation hook for
// execute()/batch(), so this races the real call against a rejecting timer --
// it bounds how long the HANDLER waits, not the underlying query's execution.
const DB_TIMEOUT_MS = 8000;

export function withDbTimeout<T>(promise: Promise<T>, ms: number = DB_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('db_timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
