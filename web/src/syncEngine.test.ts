// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingState } from './ranking/types';
import type { SavedLists } from './lists';

const { saveMock, loadMock } = vi.hoisted(() => ({ saveMock: vi.fn(), loadMock: vi.fn() }));

vi.mock('./rankingSync', () => ({
  saveRankingSnapshot: saveMock,
  loadRankingSnapshotDetailed: loadMock,
}));

import { createSyncEngine } from './syncEngine';
import { clearPendingSync, clearSyncConflict, hasPendingSync, markSyncConflict, saveSyncBase } from './syncStatus';
import { clearWriteKey, getWriteKey } from './writeKey';

const state: RankingState = { ranked: [], pending: null };
const lists: SavedLists = { wantToListen: [], notHeard: [], dontCare: [] };

function makeEngine(
  baseUpdatedAt: number | null | undefined = 10,
  hidden: { blocked?: string[]; curated?: string[]; skipped?: string[] } = {}
) {
  return createSyncEngine({
    session: { session_id: '11111111-1111-4111-8111-111111111111' } as never,
    getState: () => state,
    getLists: () => lists,
    getArtistLocks: () => [],
    getBlockedArtists: () => hidden.blocked ?? [],
    getCuratedSkips: () => new Set<string>(hidden.curated ?? []),
    getSkippedAlbums: () => new Set<string>(hidden.skipped ?? []),
    baseUpdatedAt,
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('sync engine banner and save outcomes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveMock.mockReset();
    loadMock.mockReset();
    clearPendingSync();
    clearSyncConflict();
    clearWriteKey();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces itself to assistive tech', () => {
    const { bannerElement } = makeEngine();

    expect(bannerElement.getAttribute('role')).toBe('status');
    expect(bannerElement.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps retrying a transient failure and says so', async () => {
    saveMock.mockResolvedValue({ status: 'error' });
    const engine = makeEngine();

    engine.persistLists();
    await flush();

    expect(engine.bannerElement.hidden).toBe(false);
    expect(engine.bannerElement.textContent).toContain('Retrying');
    await vi.advanceTimersByTimeAsync(4000);
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('stops retrying and shows the unlock control when the server answers 401', async () => {
    saveMock.mockResolvedValue({ status: 'locked' });
    const engine = makeEngine();

    engine.persistLists();
    await flush();

    expect(engine.bannerElement.textContent).toContain('Saving is locked on this device');
    expect(engine.bannerElement.querySelector('input[aria-label="Write key"]')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(20000);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(hasPendingSync()).toBe(true);
  });

  it('stores the key and saves again when the user unlocks', async () => {
    saveMock.mockResolvedValueOnce({ status: 'locked' }).mockResolvedValueOnce({ status: 'saved', updatedAt: 99 });
    const engine = makeEngine();
    engine.persistLists();
    await flush();

    const input = engine.bannerElement.querySelector('input') as HTMLInputElement;
    input.value = '  secret-123  ';
    const unlock = [...engine.bannerElement.querySelectorAll('button')].find((b) => b.textContent === 'Unlock & save');
    unlock?.click();
    await flush();

    expect(getWriteKey()).toBe('secret-123');
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(hasPendingSync()).toBe(false);
    expect(engine.bannerElement.hidden).toBe(true);
  });

  it('stops retrying a permanently rejected snapshot, offers a backup, and retries once after the next edit', async () => {
    saveMock.mockResolvedValue({ status: 'rejected', httpStatus: 413 });
    const engine = makeEngine();

    engine.persistLists();
    await flush();

    expect(engine.bannerElement.textContent).toContain('error 413');
    expect([...engine.bannerElement.querySelectorAll('button')].map((b) => b.textContent)).toContain('Export unsaved backup');
    await vi.advanceTimersByTimeAsync(20000);
    expect(saveMock).toHaveBeenCalledTimes(1);

    engine.persistLists();
    await flush();
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('needs two taps before discarding unsaved work on a conflict', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    loadMock.mockResolvedValue({
      status: 'found',
      ranked: [],
      lists,
      artistLocks: [],
      blockedArtists: [],
      curatedSkips: [],
      skippedAlbums: [],
      updatedAt: 50,
    });
    saveMock.mockResolvedValue({ status: 'conflict' });
    const engine = makeEngine();
    engine.persistLists();
    await flush();
    expect(engine.bannerElement.textContent).toContain('changed in another tab or device');

    const discard = [...engine.bannerElement.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Discard')) as HTMLButtonElement;
    discard.click();
    await flush();
    expect(loadMock).not.toHaveBeenCalled();
    expect(discard.textContent).toContain('Tap again');

    discard.click();
    await flush();
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('offers a lossless reload when the tab returns and the server moved on, but never when edits are unsaved', async () => {
    saveSyncBase(10);
    const engine = makeEngine(10);
    loadMock.mockResolvedValue({ status: 'found', ranked: [], lists, artistLocks: [], blockedArtists: [], curatedSkips: [], skippedAlbums: [], updatedAt: 20 });

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();

    expect(engine.bannerElement.hidden).toBe(false);
    expect(engine.bannerElement.textContent).toContain('changed on another device');

    markSyncConflict();
    clearSyncConflict();
    clearPendingSync();
    const second = makeEngine(10);
    loadMock.mockClear();
    second.persistLists();
    saveMock.mockResolvedValue({ status: 'error' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('sends removed albums with every save', async () => {
    saveMock.mockResolvedValue({ status: 'saved', updatedAt: 11 });
    const engine = makeEngine(10, { skipped: ['mbid-1', 'mbid-2'] });

    engine.persistSkippedAlbums();
    await flush();

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][7]).toEqual(['mbid-1', 'mbid-2']);
    expect(hasPendingSync()).toBe(false);
  });

  describe('discarding a conflict keeps what was hidden on this device', () => {
    function foundCopy(extra: Partial<{ blockedArtists: string[]; curatedSkips: string[]; skippedAlbums: string[] }> = {}) {
      return { status: 'found', ranked: [], lists, artistLocks: [], blockedArtists: [], curatedSkips: [], skippedAlbums: [], updatedAt: 50, ...extra };
    }

    async function discard(engine: ReturnType<typeof makeEngine>) {
      const button = () => [...engine.bannerElement.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Discard') || b.textContent?.startsWith('Tap again')) as HTMLButtonElement;
      button().click();
      await flush();
      button().click();
      await flush();
    }

    beforeEach(() => {
      vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
      saveMock.mockResolvedValue({ status: 'conflict' });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('unions hidden artists, curated skips and removed albums with the server copy and queues a save', async () => {
      loadMock.mockResolvedValue(foundCopy({ blockedArtists: ['Server Artist'], curatedSkips: ['srv:1'], skippedAlbums: ['srv-album'] }));
      const engine = makeEngine(10, { blocked: ['Local Artist'], curated: ['loc:1'], skipped: ['loc-album'] });
      engine.persistLists();
      await flush();

      await discard(engine);

      expect(JSON.parse(localStorage.getItem('tastetest-skipped-albums') ?? '[]').sort()).toEqual(['loc-album', 'srv-album']);
      expect(JSON.parse(localStorage.getItem('tastetest-curated-skips') ?? '[]').sort()).toEqual(['loc:1', 'srv:1']);
      expect(JSON.parse(localStorage.getItem('tastetest-blocked-artists') ?? '[]').sort()).toEqual(['Local Artist', 'Server Artist']);
      expect(hasPendingSync()).toBe(true);
    });

    it('clears the pending flag when nothing was hidden only on this device', async () => {
      loadMock.mockResolvedValue(foundCopy({ skippedAlbums: ['same'] }));
      const engine = makeEngine(10, { skipped: ['same'] });
      engine.persistLists();
      await flush();

      await discard(engine);

      expect(hasPendingSync()).toBe(false);
    });
  });
});
