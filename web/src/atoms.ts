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

  activeFlush = (async () => {
    let queue = loadQueue();
    while (queue.length > 0) {
      const [atom] = queue;
      let response: Response;
      try {
        response = await fetch('/api/atom', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(atom),
        });
      } catch {
        return;
      }

      if (!response.ok) return;
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
