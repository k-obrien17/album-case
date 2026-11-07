import type { GroupDimension, RankedSection } from '../ranking/groups';

export type BrowseViewOptions = {
  dimension: GroupDimension;
  sections: RankedSection[];
  onOpenSection: (section: RankedSection) => void;
};

const EMPTY_MESSAGES: Record<GroupDimension, string> = {
  artist: 'Rank an album to start browsing by artist.',
  year: 'Rank an album to start browsing by year.',
  decade: 'Rank an album to start browsing by decade.',
  genre: 'Rank an album to start browsing by genre.',
};

/**
 * Section-header list for one browse dimension of the ranked list. Headers
 * only -- tapping one opens the slice (the caller decides how: artist
 * sections open the artist batch view, the rest open a slice view).
 */
export function renderBrowseView(container: HTMLElement, opts: BrowseViewOptions): void {
  container.textContent = '';

  if (opts.sections.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'browse-empty';
    empty.textContent = EMPTY_MESSAGES[opts.dimension];
    container.append(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'browse-sections';
  for (const section of opts.sections) {
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'browse-section';

    const label = document.createElement('span');
    label.className = 'browse-section-label';
    label.textContent = section.label;

    const meta = document.createElement('span');
    meta.className = 'browse-section-meta';
    meta.textContent = `${section.count} album${section.count === 1 ? '' : 's'} · avg ${section.meanRating.toFixed(2)}`;

    btn.append(label, meta);
    btn.addEventListener('click', () => opts.onOpenSection(section));
    item.append(btn);
    list.append(item);
  }
  container.append(list);
}
