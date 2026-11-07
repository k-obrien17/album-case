// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import type { RankedAlbum } from '../ranking/types';
import type { RankedSection } from '../ranking/groups';
import { renderBrowseView } from './browseView';

function rankedAlbum(mbid: string, rating: number): RankedAlbum {
  return {
    mbid,
    title: `Title ${mbid}`,
    primary_artist_name: `Artist ${mbid}`,
    release_year: 1994,
    cover_url: '',
    rating,
  };
}

function section(key: string, label: string, ratings: number[]): RankedSection {
  const albums = ratings.map((r, i) => rankedAlbum(`${key}-${i}`, r));
  return {
    key,
    label,
    albums,
    count: albums.length,
    meanRating: albums.reduce((s, a) => s + a.rating, 0) / albums.length,
  };
}

describe('renderBrowseView', () => {
  test('renders one button per section with label, count, and 2-decimal mean', () => {
    const container = document.createElement('div');
    const sections = [section('decade:1990', '1990s', [8.5, 6.36]), section('decade:2000', '2000s', [9])];
    renderBrowseView(container, { dimension: 'decade', sections, onOpenSection: () => {} });
    const buttons = container.querySelectorAll<HTMLButtonElement>('button.browse-section');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('1990s');
    expect(buttons[0].textContent).toContain('2 albums');
    expect(buttons[0].textContent).toContain('avg 7.43');
    expect(buttons[1].textContent).toContain('1 album');
  });

  test('clicking a section button reports that section', () => {
    const container = document.createElement('div');
    const onOpenSection = vi.fn();
    const sections = [section('year:1994', '1994', [8]), section('year:2001', '2001', [7])];
    renderBrowseView(container, { dimension: 'year', sections, onOpenSection });
    container.querySelector<HTMLButtonElement>('button.browse-section')!.click();
    expect(onOpenSection).toHaveBeenCalledWith(sections[0]);
  });

  test('renders a status line when a message is passed, and none otherwise', () => {
    const container = document.createElement('div');
    const sections = [section('year:1994', '1994', [8])];
    renderBrowseView(container, { dimension: 'year', sections, onOpenSection: () => {}, statusMessage: 'Refresh Album Case to view this artist.' });
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('Refresh Album Case');
    renderBrowseView(container, { dimension: 'year', sections, onOpenSection: () => {} });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  test('renders a message, not a blank container, when there are no sections', () => {
    const container = document.createElement('div');
    renderBrowseView(container, { dimension: 'genre', sections: [], onOpenSection: () => {} });
    const message = container.querySelector('p');
    expect(message).not.toBeNull();
    expect(message!.textContent!.length).toBeGreaterThan(0);
  });
});
