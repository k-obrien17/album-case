// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import type { RankedAlbum } from '../ranking/types';
import { mountRankList, type RankListOptions } from './rankList';

function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: `https://example.test/${mbid}.jpg`,
    rating,
  };
}

function mount(overrides: Partial<RankListOptions> = {}) {
  const ranked = [rankedAlbum('a', 9), rankedAlbum('b', 8), rankedAlbum('c', 7)];
  const container = document.createElement('div');
  document.body.append(container);
  const onSetRating = vi.fn();
  const controller = mountRankList(container, {
    getRanked: () => ranked,
    getCandidate: () => null,
    onPlace: () => {},
    onReorder: () => {},
    onSetAside: () => {},
    onSkip: () => {},
    onBlockArtist: () => {},
    onSetRating,
    suppressReorder: true,
    ...overrides,
  });
  return { container, controller, onSetRating };
}

describe('suppressReorder', () => {
  test('renders no drag grips', () => {
    const { container } = mount();
    expect(container.querySelector('.rank-grip')).toBeNull();
    expect(container.querySelectorAll('.rank-row')).toHaveLength(3);
  });

  test('keeps the rating editor active and resolves the global index', () => {
    const { container, onSetRating } = mount();
    const editBtn = [...container.querySelectorAll<HTMLButtonElement>('button.rank-rating')][2];
    editBtn.click();
    const input = container.querySelector<HTMLInputElement>('.rank-rating-edit input');
    expect(input).not.toBeNull();
    input!.value = '9.5';
    input!.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSetRating).toHaveBeenCalledWith(2, 9.5);
  });

  test('renders no search chrome', () => {
    const { container } = mount();
    expect(container.querySelector('.rank-search-section-label')).toBeNull();
  });
});
