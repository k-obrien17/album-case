import type { CuratedAlbumEntry, CuratedList } from '../data/curatedLists';

export type CuratedListViewOptions = {
  lists: Record<string, CuratedList>;
  selectedListId: string | null;
  /** Already filtered to the entries not in the owner's ranked list, in
   *  source rank order. Ignored while `selectedListId` is null. */
  unranked: CuratedAlbumEntry[];
  onSelectList: (listId: string) => void;
  /** Jump into the search box pre-filled with this entry's artist/title. */
  onRankAlbum: (entry: CuratedAlbumEntry) => void;
};

/**
 * Browse expert "best of" lists (curatedLists.ts) and work through whichever
 * entries aren't in the owner's ranked list yet. Stateless render over
 * `container`, same pattern as savedList.ts -- main.ts owns which list is
 * selected and recomputes `unranked` on every render.
 */
export function renderCuratedListView(container: HTMLElement, opts: CuratedListViewOptions): void {
  container.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'curated-list-view';

  const picker = document.createElement('div');
  picker.className = 'curated-list-picker';
  for (const [id, list] of Object.entries(opts.lists)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = id === opts.selectedListId ? 'view-tab view-tab-active' : 'view-tab';
    btn.textContent = list.name;
    btn.addEventListener('click', () => opts.onSelectList(id));
    picker.append(btn);
  }
  wrap.append(picker);

  if (!opts.selectedListId) {
    const prompt = document.createElement('p');
    prompt.className = 'saved-empty';
    prompt.textContent = 'Pick a list above.';
    wrap.append(prompt);
    container.append(wrap);
    return;
  }

  const selected = opts.lists[opts.selectedListId];
  const heading = document.createElement('p');
  heading.className = 'curated-list-status';
  heading.textContent = `${opts.unranked.length} of ${selected.albums.length} not yet ranked.`;
  wrap.append(heading);

  if (opts.unranked.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-empty';
    empty.textContent = "You've ranked every album on this list.";
    wrap.append(empty);
    container.append(wrap);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'saved-list';
  for (const entry of opts.unranked) {
    const item = document.createElement('li');
    item.className = 'saved-item';

    const meta = document.createElement('div');
    meta.className = 'saved-meta';
    const title = document.createElement('p');
    title.className = 'saved-title';
    title.textContent = `#${entry.rank} · ${entry.title}`;
    const artist = document.createElement('p');
    artist.className = 'saved-artist';
    artist.textContent = entry.artist;
    meta.append(title, artist);

    const rankBtn = document.createElement('button');
    rankBtn.type = 'button';
    rankBtn.className = 'saved-mark';
    rankBtn.textContent = 'Rank this';
    rankBtn.setAttribute('aria-label', `Search for ${entry.title} by ${entry.artist} to rank it`);
    rankBtn.addEventListener('click', () => opts.onRankAlbum(entry));

    item.append(meta, rankBtn);
    list.append(item);
  }
  wrap.append(list);

  container.append(wrap);
}
