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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

function htmlResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  } as unknown as Response;
}

describe('atom retry queue', () => {
  it('keeps an atom queued when fetch rejects and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect(() => enqueueAtom(atom)).not.toThrow();
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([atom]);
  });

  it('removes an atom only after an affirmative JSON { ok: true } response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));

    enqueueAtom(atom);
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([]);
  });

  it('leaves an atom queued on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_entity' })));

    enqueueAtom(atom);
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([atom]);
  });

  it('leaves an atom queued on a 200 non-JSON response (SPA/HTML fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(200)));

    enqueueAtom(atom);
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([atom]);
  });

  it('leaves an atom queued when a 200 JSON body does not confirm ok:true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: false })));

    enqueueAtom(atom);
    await flushAtomQueue();

    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toEqual([atom]);
  });
});
