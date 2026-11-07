// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import type { RankedAlbum } from '../ranking/types';
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
