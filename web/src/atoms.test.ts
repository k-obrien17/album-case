import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueAtom, flushAtomQueue, type AtomPayload } from './atoms';

const QUEUE_KEY = 'tastetest-atom-queue';

const atom: AtomPayload = {
  entity_a: '9162580e-5df4-32de-80cc-f45a8d8a9b1d',
  entity_b: '72d15666-99a7-321e-b1f3-a3f8c09dff9f',
  winner: '9162580e-5df4-32de-80cc-f45a8d8a9b1d',
  session_id: '11111111-1111-4111-8111-111111111111',
};

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // @ts-expect-error - restore the default Node test environment.
  delete globalThis.localStorage;
});

describe('atom retry queue', () => {
  it('keeps an atom queued when fetch rejects and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect(() => enqueueAtom(atom)).not.toThrow();
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([atom]);
  });

  it('removes an atom only after a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    enqueueAtom(atom);
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([]);
  });

  it('leaves an atom queued on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    enqueueAtom(atom);
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([atom]);
  });
});
