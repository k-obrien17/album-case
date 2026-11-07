// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import type { Album, RankedAlbum } from '../ranking/types';
import type { Suggestion } from '../suggestions';
import { mountSliceView, type SliceViewOptions } from './sliceView';

function rankedAlbum(mbid: string, rating: number, year = 1994): RankedAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: year,
    cover_url: '',
    rating,
  };
}

function mount(overrides: Partial<SliceViewOptions> = {}) {
  // Global list [A 9.0, B 8.5, C 8.5, D 7.0]; the slice holds B and D.
  const global = [
    rankedAlbum('A', 9.0),
    rankedAlbum('B', 8.5),
    rankedAlbum('C', 8.5),
    rankedAlbum('D', 7.0),
  ];
  const slice = [global[1], global[3]];
  const container = document.createElement('div');
  document.body.append(container);
  const onSetRating = vi.fn();
  const onClose = vi.fn();
  const controller = mountSliceView(container, {
    label: '1994',
    getRanked: () => global,
    getSliceAlbums: () => slice,
    onSetRating,
    onSetOverallRank: () => {},
    onRemoveRanked: () => {},
    onUndoRemove: () => {},
    onClose,
    ...overrides,
  });
  return { container, controller, onSetRating, onClose };
}

describe('mountSliceView', () => {
  test('renders a heading with the label and a Back button wired to onClose', () => {
    const { container, onClose } = mount();
    expect(container.querySelector('h2')!.textContent).toContain('1994');
    const back = container.querySelector<HTMLButtonElement>('.lock-view-back');
    expect(back).not.toBeNull();
    back!.click();
    expect(onClose).toHaveBeenCalled();
  });

  test('renders the slice rows with reordering suppressed', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.rank-row')).toHaveLength(2);
    expect(container.querySelector('.rank-grip')).toBeNull();
  });

  test('renders candidate cards with rate, want-to-listen, and skip wired through', () => {
    const plainAlbum = (mbid: string): Album => {
      const { rating: _rating, ...rest } = rankedAlbum(mbid, 0);
      return rest;
    };
    const toSuggestion = (album: Album, reason: string): Suggestion => ({ album, reason, kind: 'familiar', score: 1 });
    const candidates = [
      toSuggestion(plainAlbum('X'), 'Because you love 1994.'),
      toSuggestion(plainAlbum('Y'), 'Another 1994 pick.'),
    ];
    const onRate = vi.fn();
    const onWantToListen = vi.fn();
    const onSkip = vi.fn();
    const { container } = mount({
      candidates: {
        title: 'Unranked picks for 1994',
        get: () => candidates,
        onRate,
        onWantToListen,
        onSkip,
        onFindMore: () => {},
      },
    });
    const cards = container.querySelectorAll('.slice-candidates .backlog-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Title X');
    expect(cards[0].textContent).toContain('Because you love 1994.');
    const form = cards[0].querySelector('form')!;
    const input = form.querySelector('input')!;
    input.value = '8.25';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onRate).toHaveBeenCalledWith(candidates[0].album, 8.25);
    const buttons = [...cards[0].querySelectorAll('button')];
    buttons.find((b) => b.textContent === 'Want to listen')!.click();
    expect(onWantToListen).toHaveBeenCalledWith(candidates[0].album);
    buttons.find((b) => b.textContent === 'Skip')!.click();
    expect(onSkip).toHaveBeenCalledWith(candidates[0].album);
  });

  test('with no candidates, shows a message and still offers Find more', () => {
    const onFindMore = vi.fn();
    const { container } = mount({
      candidates: {
        title: 'Unranked picks for 1994',
        get: () => [],
        onRate: () => {},
        onWantToListen: () => {},
        onSkip: () => {},
        onFindMore,
      },
    });
    expect(container.querySelector('.slice-candidates-empty')).not.toBeNull();
    expect(container.querySelectorAll('.backlog-card')).toHaveLength(0);
    const findMore = [...container.querySelectorAll('button')].find((b) => b.textContent!.startsWith('Find more'));
    expect(findMore).not.toBeUndefined();
    findMore!.click();
    expect(onFindMore).toHaveBeenCalled();
  });

  test('renders no candidate strip when the slice has no candidate source', () => {
    const { container } = mount();
    expect(container.querySelector('.slice-candidates')).toBeNull();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent!.startsWith('Find more'))).toBe(false);
  });

  test('rating edit resolves ties against the global list, not the slice', () => {
    const { container, onSetRating } = mount();
    // D is the slice's second row; its global index is 3.
    const editBtn = [...container.querySelectorAll<HTMLButtonElement>('button.rank-rating')][1];
    editBtn.click();
    const input = container.querySelector<HTMLInputElement>('.rank-rating-edit input');
    input!.value = '8.5';
    input!.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSetRating).toHaveBeenCalledWith(3, 8.5);
  });
});
