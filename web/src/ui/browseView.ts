import type { GroupDimension, RankedSection } from '../ranking/groups';

export type BrowseViewOptions = {
  dimension: GroupDimension;
  sections: RankedSection[];
  onOpenSection: (section: RankedSection) => void;
  /** One-shot feedback line (e.g. a section that can't open, a bulk-discovery
   *  summary). rankList's own status can't show here: its host is detached
   *  while sections are on screen. The caller owns the one-shot clearing. */
  statusMessage?: string | null;
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

  if (opts.statusMessage) {
    const status = document.createElement('p');
    status.className = 'rank-status';
    status.setAttribute('role', 'status');
    status.textContent = opts.statusMessage;
    container.append(status);
  }

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
