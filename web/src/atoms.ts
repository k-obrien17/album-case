import { getWriteKey, writeKeyHeaders } from './writeKey';

const ATOM_QUEUE_KEY = 'tastetest-atom-queue';

export type AtomPayload = {
  entity_a: string;
  entity_b: string;
  winner: string;
  session_id: string;
};

let memoryQueue: AtomPayload[] = [];
let activeFlush: Promise<void> | null = null;

function loadQueue(): AtomPayload[] {
  if (typeof localStorage === 'undefined') return memoryQueue;

  try {
    const raw = localStorage.getItem(ATOM_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as AtomPayload[]) : [];
  } catch (err) {
    console.warn('tastetest: failed to read atom queue, using in-memory queue', err);
    return memoryQueue;
  }
}

function saveQueue(queue: AtomPayload[]): void {
  memoryQueue = queue;
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(ATOM_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('tastetest: failed to persist atom queue, continuing in-memory', err);
  }
}

export function enqueueAtom(atom: AtomPayload): void {
  saveQueue([...loadQueue(), atom]);
  void flushAtomQueue();
}

export async function flushAtomQueue(): Promise<void> {
  if (activeFlush) return activeFlush;
  if (!getWriteKey()) return;

  activeFlush = (async () => {
    let queue = loadQueue();
    while (queue.length > 0) {
      const [atom] = queue;
      let response: Response;
      try {
        response = await fetch('/api/atom', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...writeKeyHeaders() },
          body: JSON.stringify(atom),
        });
      } catch {
        return;
      }

      // Dequeue ONLY on an affirmative success: a 2xx response whose body is
      // JSON and confirms `{ ok: true }` (the handler answers 201 + { ok: true }).
      // A 200 carrying non-JSON (an SPA/HTML fallback when no API is running)
      // must NOT drop the pick — stop the flush and keep the queue for retry.
      if (!response.ok) return;

      const contentType = response.headers?.get?.('content-type') ?? '';
      if (!contentType.includes('application/json')) return;

      let confirmed: { ok?: unknown };
      try {
        confirmed = (await response.json()) as { ok?: unknown };
      } catch {
        return;
      }
      if (confirmed.ok !== true) return;

      queue = queue.slice(1);
      saveQueue(queue);
    }
  })();

  try {
    await activeFlush;
  } finally {
    activeFlush = null;
  }
}
