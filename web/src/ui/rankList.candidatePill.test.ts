// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import type { Album, RankedAlbum } from '../ranking/types';
import { mountRankList, type RankListOptions } from './rankList';

function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 2000,
    cover_url: '',
    rating,
  };
}

function candidateAlbum(): Album {
  const { rating: _rating, ...rest } = rankedAlbum('cand', 0);
  return rest;
}

function mount(rankedCount: number, overrides: Partial<RankListOptions> = {}) {
  const ranked = Array.from({ length: rankedCount }, (_, i) => rankedAlbum(`a${i}`, 9 - i * 0.1));
  const container = document.createElement('div');
  document.body.append(container);
  const controller = mountRankList(container, {
    getRanked: () => ranked,
    getCandidate: () => candidateAlbum(),
    onPlace: () => {},
    onReorder: () => {},
    onSetAside: () => {},
    onSkip: () => {},
    onBlockArtist: () => {},
    onSetRating: () => {},
    ...overrides,
  });
  return { container, controller };
}

// jsdom has no matchMedia, so these tests exercise the narrow-viewport
// default: the candidate card starts collapsed to a one-line pill.
describe('candidate pill', () => {
  test('collapses the drag card to a pill naming the candidate', () => {
    const { container } = mount(3);
    const pill = container.querySelector<HTMLButtonElement>('.candidate-pill');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('Title cand');
    expect(pill!.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.candidate')).toBeNull();
  });

  test('collapses the assisted card too', () => {
    const { container } = mount(9);
    expect(container.querySelector('.candidate-pill')).not.toBeNull();
    expect(container.querySelector('.assist-choose')).toBeNull();
  });

  test('tapping the pill expands the card and stays expanded across renders', () => {
    const { container, controller } = mount(9);
    container.querySelector<HTMLButtonElement>('.candidate-pill')!.click();
    expect(container.querySelector('.candidate')).not.toBeNull();
    expect(container.querySelector('.assist-choose')).not.toBeNull();
    expect(container.querySelector('.candidate-pill')).toBeNull();
    controller.render();
    expect(container.querySelector('.candidate')).not.toBeNull();
  });

  test('the expanded card offers a Hide control that collapses it again', () => {
    const { container } = mount(9);
    container.querySelector<HTMLButtonElement>('.candidate-pill')!.click();
    const hide = container.querySelector<HTMLButtonElement>('.candidate-collapse');
    expect(hide).not.toBeNull();
    hide!.click();
    expect(container.querySelector('.candidate-pill')).not.toBeNull();
    expect(container.querySelector('.candidate')).toBeNull();
  });

  test('no pill when there is no candidate', () => {
    const { container } = mount(3, { getCandidate: () => null });
    expect(container.querySelector('.candidate-pill')).toBeNull();
  });
});
