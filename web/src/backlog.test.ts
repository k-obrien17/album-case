import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildArtistGaps, decideAlbum, otherReleaseReason } from './backlog';
import { addToList, excludedMbids, loadLists, saveLists, mergeRefresherIntoWantToListen, type SavedLists } from './lists';
import { addSearchedAlbum } from './main';
import { hydrateLists, resolveInitialState } from './syncEngine';
import { createRankingBackup, parseRankingBackup } from './backup';
import { loadRankingSnapshotDetailed, snapshotPayload } from './rankingSync';
import { emptyBacklog } from '../shared/backlog';
import type { Album } from './ranking/types';

const artistId = '11111111-1111-4111-8111-111111111111';
const album = (id: string, title = id, year = 2000): Album => ({ mbid: id, title, primary_artist_name: 'Known Artist', primary_artist_mbid: artistId, release_year: year, cover_url: '' });
const empty = (): SavedLists => ({ wantToListen: [], notHeard: [], dontCare: [] });
afterEach(() => vi.unstubAllGlobals());

describe('artist backlog', () => {
  it('merges old refresher saves on server and offline startup without duplicates or losing progress', () => {
    const existing = album('existing', 'The Album!');
    const refresher = album('refresher');
    const lists = { ...empty(), wantToListen: [existing], backlog: {
      ...emptyBacklog<Album>(), needsRefresher: [album('alias', 'The Album'), refresher],
      reviewedArtistIds: [artistId], currentArtistId: artistId,
    } };
    const expected = { ...lists, wantToListen: [existing, refresher], backlog: { ...lists.backlog, needsRefresher: [] } };
    const cached = { state: { ranked: [], pending: null }, lists, artistLocks: [] };
    expect(resolveInitialState(null, cached).lists).toEqual(expected);
    expect(resolveInitialState({ ranked: [], lists, artistLocks: [] }, cached).lists).toEqual(expected);
    expect(mergeRefresherIntoWantToListen(expected)).toBe(expected);
    expect(lists.backlog.needsRefresher).toHaveLength(2);
  });

  it('finds chronological gaps without resurfacing rated aliases, saved albums, or local skips', () => {
    const ranked = [{ ...album('rated', 'The Album!'), rating: 8.2 }];
    const pool = [album('duplicate', 'The Album'), album('saved'), album('skip'), album('later', 'Later', 2003), album('early', 'Early', 1991)];
    const lists = { ...empty(), notHeard: [album('saved')] };
    const gaps = buildArtistGaps(pool, ranked, lists, [], [], new Set(['skip']));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].remaining.map((a) => a.mbid)).toEqual(['early', 'later']);
    expect(gaps[0].ranked).toEqual(ranked);
  });

  it('includes preferred artists without rankings and puts reviewed artists last', () => {
    const second = { ...album('second'), primary_artist_name: 'Most played', primary_artist_mbid: undefined };
    const lists = { ...empty(), backlog: { ...emptyBacklog<Album>(), reviewedArtistIds: [artistId] } };
    const gaps = buildArtistGaps([second], [{ ...album('rated'), rating: 8 }], lists, [{ artist: 'Most played', plays: 100, rank: 1, hours: 5 }]);
    expect(gaps.map((g) => g.name)).toEqual(['Most played', 'Known Artist']);
    expect(buildArtistGaps([second], [], lists, [], ['Known Artist'])).toEqual([]);
  });

  it('moves decisions between queues exclusively and removes them when rated', () => {
    const a = album('a');
    let lists = decideAlbum(empty(), a, 'wantToListen');
    expect(lists.wantToListen).toEqual([a]);
    lists = decideAlbum(lists, a, 'readyToRank');
    expect(lists.wantToListen).toEqual([]);
    expect(lists.backlog?.needsRefresher).toEqual([]);
    expect(excludedMbids(lists)).toEqual(new Set(['a']));
    const result = addSearchedAlbum([{ ...album('existing'), rating: 9 }], lists, a, 8.25);
    expect(result.ranked.map((a) => a.rating)).toEqual([9, 8.25]);
    expect(result.lists.backlog?.readyToRank).toEqual([]);
    expect(excludedMbids(result.lists)).toEqual(new Set());
    expect(addToList(lists, a, 'notHeard').backlog?.readyToRank).toEqual([]);
  });

  it('flags likely other releases without hiding ordinary studio titles', () => {
    for (const title of ['Born to Die Demos', 'Live at Stockholm Water Festival', '2005‐07‐02 – St.Gallen', 'Popular (The Remixes)']) expect(otherReleaseReason(album(title))).not.toBeNull();
    for (const title of ['Live Through This', 'Naked', 'White Chalk']) expect(otherReleaseReason(album(title))).toBeNull();
  });

  it('keeps full records when returning an album absent from the pool to review', () => {
    const returned = album('retired');
    const lists = decideAlbum(decideAlbum(empty(), returned, 'readyToRank'), returned, null);
    const restored = parseRankingBackup(createRankingBackup({ ranked: [], pending: null }, lists), []);
    if (!restored.ok || !restored.lists) throw new Error('Backup failed');
    const gaps = buildArtistGaps([], [{ ...album('rated'), rating: 8 }], restored.lists, []);
    expect(gaps[0].remaining).toEqual([returned]);
    expect(decideAlbum(lists, returned, 'wantToListen').backlog?.pendingReview).toEqual([]);
  });

  it('removes queued aliases when the same album is rated or moved through search', () => {
    const a = album('old-id', 'The Album!');
    const alias = album('new-id', 'The Album');
    const lists = decideAlbum(empty(), a, 'readyToRank');
    expect(addSearchedAlbum([], lists, alias, 8).lists.backlog?.readyToRank).toEqual([]);
    expect(decideAlbum(lists, alias, 'wantToListen').backlog?.readyToRank).toEqual([]);
    expect(addToList(lists, alias, 'wantToListen').backlog?.readyToRank).toEqual([]);
  });

  it('preserves queues and resume progress through cache, server payload, hydration, and backup', async () => {
    const lists = { ...empty(), backlog: { readyToRank: [album('ready')], needsRefresher: [album('refresh')], reviewedArtistIds: [artistId], currentArtistId: artistId } };
    let stored = '';
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
    saveLists(lists);
    expect(loadLists()).toEqual(lists);
    const state = { ranked: [{ ...album('ranked'), rating: 9.34 }], pending: null };
    const payload = snapshotPayload('owner', state, lists, [], [], [], 123);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ snapshot: { ...payload, updated_at: 124 } }) }));
    const loaded = await loadRankingSnapshotDetailed('owner');
    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('Snapshot missing');
    expect(hydrateLists(loaded.lists, new Map())).toEqual(lists);
    expect(parseRankingBackup(createRankingBackup(state, lists), [])).toEqual({ ok: true, state, lists });
  });
});
