import type { Album } from '../ranking/types';

/**
 * Render the player's current ranked list (index 0 = most preferred) into
 * `container`, replacing prior content. Each row shows a cover thumbnail,
 * title, and artist. Empty list shows a short explanatory line instead of a
 * blank screen.
 */
export function renderRankedList(container: HTMLElement, ranked: Album[]): void {
  container.textContent = '';

  if (ranked.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ranked-empty';
    empty.textContent = 'No albums ranked yet -- keep picking.';
    container.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'ranked-list';

  for (const album of ranked) {
    const item = document.createElement('li');
    item.className = 'ranked-item';

    const thumb = new Image();
    thumb.className = 'ranked-thumb';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.alt = '';
    thumb.src = album.cover_url;

    const meta = document.createElement('div');
    meta.className = 'ranked-meta';

    const title = document.createElement('p');
    title.className = 'ranked-title';
    title.textContent = album.title;

    const artist = document.createElement('p');
    artist.className = 'ranked-artist';
    artist.textContent = album.primary_artist_name;

    meta.append(title, artist);
    item.append(thumb, meta);
    list.append(item);
  }

  container.append(list);
}
