// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderCuratedListView } from './curatedListView';
import { rankedFromCuratedList } from '../curatedListMatch';
import type { CuratedList } from '../data/curatedLists';
import type { RankedAlbum } from '../ranking/types';

const list: CuratedList = {
  name: 'Test list',
  source: 'https://example.com/list',
  albums: [
    { rank: 1, artist: 'Pavement', title: 'Slanted and Enchanted' },
    { rank: 2, artist: 'Slint', title: 'Spiderland' },
    { rank: 3, artist: 'Guided by Voices', title: 'Bee Thousand' },
  ],
};
const ranked: RankedAlbum[] = [
  { mbid: 'm1', title: 'Slanted & Enchanted', primary_artist_name: 'Pavement', release_year: 1992, cover_url: '', rating: 9.1 },
  { mbid: 'm2', title: 'Spiderland', primary_artist_name: 'Slint', release_year: 1991, cover_url: '', rating: 9.34 },
];

describe('rankedFromCuratedList', () => {
  it('matches ranked albums by artist+title and returns their ratings in list order', () => {
    const r = rankedFromCuratedList(list.albums, ranked);
    expect(r.map((x) => [x.entry.rank, x.rating])).toEqual([[2, 9.34]]);
  });
});

describe('renderCuratedListView header', () => {
  it('shows progress, a source link and a collapsed Already ranked section', () => {
    const el = document.createElement('div');
    const rankedEntries = rankedFromCuratedList(list.albums, ranked);
    renderCuratedListView(el, {
      lists: { t: list }, selectedListId: 't',
      unranked: [list.albums[0], list.albums[2]], rankedEntries,
      onSelectList: vi.fn(), onRateAlbum: vi.fn(), onSkipEntry: vi.fn(), onHideArtist: vi.fn(),
      onWantToListen: vi.fn(), onViewArtist: vi.fn(), ratingEntryKey: null, rateMessage: null,
      pendingMatch: null, onConfirmMatch: vi.fn(), onCancelMatch: vi.fn(),
    });
    expect(el.querySelector('.curated-list-status')?.textContent).toBe('1 ranked · 2 to go');
    const a = el.querySelector<HTMLAnchorElement>('.curated-list-source');
    expect(a?.href).toBe('https://example.com/list');
    expect(a?.rel).toContain('noopener');
    const d = el.querySelector<HTMLDetailsElement>('details.curated-list-ranked');
    expect(d?.open).toBe(false);
    expect(d?.querySelector('summary')?.textContent).toBe('Already ranked (1)');
    expect(d?.textContent).toContain('you rated 9.34');
  });
});
