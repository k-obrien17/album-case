import type { Album } from '../ranking/types';

/**
 * Render a set-aside list (Want to listen / Haven't heard) into `container`,
 * replacing prior content. Each row shows a cover thumbnail, title, and
 * artist, plus a "Mark as heard" button that returns the album to the
 * ranking pool via `onMarkHeard`. Empty state shows a short message rather
 * than a blank screen.
 */
export function renderSavedList(
  container: HTMLElement,
  albums: Album[],
  onMarkHeard: (album: Album) => void
): void {
  container.textContent = '';

  if (albums.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-empty';
    empty.textContent = 'Nothing here yet.';
    container.append(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'saved-list';

  for (const album of albums) {
    const item = document.createElement('li');
    item.className = 'saved-item';

    // Non-blocking image, same approach as the pick loop / ranked list.
    const thumb = new Image();
    thumb.className = 'saved-thumb';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.alt = '';
    thumb.src = album.cover_url;

    const meta = document.createElement('div');
    meta.className = 'saved-meta';

    const title = document.createElement('p');
    title.className = 'saved-title';
    title.textContent = album.title;

    const artist = document.createElement('p');
    artist.className = 'saved-artist';
    artist.textContent = album.primary_artist_name;

    meta.append(title, artist);

    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className = 'saved-mark';
    markBtn.textContent = 'Mark as heard';
    markBtn.addEventListener('click', () => onMarkHeard(album));

    item.append(thumb, meta, markBtn);
    list.append(item);
  }

  container.append(list);
}
