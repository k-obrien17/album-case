import type { Album } from '../ranking/types';

/**
 * Render a set-aside list (Want to listen / Haven't heard / Don't care) into
 * `container`, replacing prior content. Each row shows a cover thumbnail,
 * title, and artist, plus an inline 0-10 rate form that places the album
 * directly into the ranked list via `onRate`, and a "Remove" button that
 * discards it from the app entirely via `onRemove`. Empty state shows a
 * short message rather than a blank screen.
 */
export function renderSavedList(
  container: HTMLElement,
  albums: Album[],
  onRate: (album: Album, rating: number) => void,
  onRemove: (album: Album) => void
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

    const actions = document.createElement('div');
    actions.className = 'saved-actions';

    // Same markup/validation shape as the candidate card's "Or rate it
    // directly" control (rankList.ts's buildDirectRate), reused here rather
    // than duplicated logic.
    const form = document.createElement('form');
    form.className = 'candidate-place';
    form.noValidate = true;

    const input = document.createElement('input');
    input.className = 'candidate-place-input';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.max = '10';
    input.step = '0.01';
    input.placeholder = '0-10';
    input.setAttribute('aria-label', `Rating for ${album.title}`);

    const rateBtn = document.createElement('button');
    rateBtn.type = 'submit';
    rateBtn.className = 'candidate-place-button';
    rateBtn.textContent = 'Rate';

    const status = document.createElement('p');
    status.className = 'saved-rate-status';
    status.hidden = true;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      const rating = Number(raw);
      if (raw === '' || !Number.isFinite(rating) || rating < 0 || rating > 10) {
        status.hidden = false;
        status.textContent = 'Enter 0-10.';
        return;
      }
      onRate(album, Math.round(rating * 100) / 100);
    });

    form.append(input, rateBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'saved-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => onRemove(album));

    actions.append(form, removeBtn, status);
    item.append(thumb, meta, actions);
    list.append(item);
  }

  container.append(list);
}
