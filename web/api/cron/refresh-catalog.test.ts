import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import handler, { refreshCatalog, releaseWindow } from './refresh-catalog';
import { CATALOG_SCHEMA_STATEMENTS, catalogUpsertStatement, searchCatalog } from '../_catalog';

const RADIOHEAD = 'artist-radiohead';

function group(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    'primary-type': 'Album',
    'first-release-date': '2026-09-20',
    'artist-credit': [{ name: 'Radiohead', artist: { id: RADIOHEAD } }],
    ...over,
  };
}

function page(groups: unknown[], count: number) {
  return { ok: true, json: async () => ({ count, 'release-groups': groups }) } as unknown as Response;
}

async function catalogWithRadiohead(): Promise<Client> {
  const client = createClient({ url: ':memory:' });
  for (const sql of CATALOG_SCHEMA_STATEMENTS) await client.execute(sql);
  await client.execute(catalogUpsertStatement({
    mbid: 'ok-computer', title: 'OK Computer', primary_artist_name: 'Radiohead',
    primary_artist_mbid: RADIOHEAD, release_year: 1997, primary_type: 'Album', listener_count: 3000,
  }, 1, 'full'));
  return client;
}

const now = () => new Date('2026-09-24T10:00:00Z');
const noSleep = async () => {};

describe('releaseWindow', () => {
  it('covers the last 21 days, inclusive of today', () => {
    expect(releaseWindow(now())).toEqual({ from: '2026-09-03', to: '2026-09-24' });
  });
});

describe('refreshCatalog', () => {
  let client: Client;
  beforeEach(async () => { client = await catalogWithRadiohead(); });

  it('adds new albums by known artists and skips unknown artists, live albums, and singles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([
      group('new-radiohead'),
      group('unknown-artist', { 'artist-credit': [{ name: 'Nobody', artist: { id: 'artist-nobody' } }] }),
      group('radiohead-live', { 'secondary-types': ['Live'] }),
      group('radiohead-single', { 'primary-type': 'Single' }),
    ], 4));

    const result = await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    expect(result).toMatchObject({ scanned: 4, kept: 1, added: 1, pages: 1, partial: false });
    expect((await searchCatalog(client, 'title new', 10)).map((a) => a.mbid)).toEqual(['new-radiohead']);
    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'new-radiohead'")).rows[0];
    expect(Number(row.listener_count)).toBe(0);
  });

  it('adds nothing on a re-run of the same window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([group('new-radiohead')], 1));
    await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    const second = await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    expect(second.added).toBe(0);
  });

  it('never overwrites the popularity of an album already in the catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([group('ok-computer', { title: 'OK Computer' })], 1));

    await refreshCatalog({ client, fetchImpl, sleep: noSleep, now });

    const row = (await client.execute("SELECT listener_count FROM catalog_albums WHERE mbid = 'ok-computer'")).rows[0];
    expect(Number(row.listener_count)).toBe(3000);
  });

  it('keeps earlier pages and reports partial when a later page fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([group('new-radiohead')], 150))
      .mockRejectedValueOnce(new Error('503'));
    const sleep = vi.fn(async () => {});

    const result = await refreshCatalog({ client, fetchImpl, sleep, now });

    expect(result).toMatchObject({ pages: 1, added: 1, partial: true });
    expect(sleep).toHaveBeenCalledTimes(1); // between pages, never before the first
  });
});

describe('GET /api/cron/refresh-catalog auth', () => {
  afterEach(() => vi.unstubAllEnvs());

  function res() {
    return {
      statusCode: 200, body: null as unknown,
      status(c: number) { this.statusCode = c; return this; },
      json(p: unknown) { this.body = p; return this; },
      setHeader() { return this; },
    };
  }

  it('rejects a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'right');
    const r = res();
    await handler({ method: 'GET', headers: {} } as never, r as never);
    expect(r.statusCode).toBe(401);
  });

  it('rejects a wrong secret, and everything when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', 'right');
    const wrong = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } } as never, wrong as never);
    expect(wrong.statusCode).toBe(401);

    vi.stubEnv('CRON_SECRET', '');
    const unset = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer ' } } as never, unset as never);
    expect(unset.statusCode).toBe(401);
  });
});
