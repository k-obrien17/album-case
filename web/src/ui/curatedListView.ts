import type { CuratedAlbumEntry, CuratedList } from '../data/curatedLists';
import type { Album } from '../ranking/types';
import { curatedEntryKey } from '../curatedListMatch';

export { curatedEntryKey };

export type CuratedListViewOptions = {
  lists: Record<string, CuratedList>;
  selectedListId: string | null;
  /** Already filtered to the entries not in the owner's ranked list, in
   *  source rank order. Ignored while `selectedListId` is null. */
  unranked: CuratedAlbumEntry[];
  /** Entries already ranked (with the ranked rating), for the collapsed
   *  "Already ranked" section and the progress line. */
  rankedEntries: Array<{ entry: CuratedAlbumEntry; rating: number }>;
  onSelectList: (listId: string) => void;
  /** Resolve this entry via MusicBrainz search. Doesn't insert anything --
   *  the found album is held as `pendingMatch` until the owner confirms it
   *  actually is the album they meant (see `onConfirmMatch`). A raw text
   *  search's top hit is not reliably the right album (see
   *  `onConfirmMatch`'s doc comment for the incident that made this
   *  mandatory), so nothing gets written to the ranked list sight-unseen. */
  onRateAlbum: (entry: CuratedAlbumEntry, rating: number) => void;
  /** Marks this entry skipped (persisted server-side); it stops appearing
   *  in `unranked` on the next render. No confirmation -- reviewing/undoing
   *  a skip lives in the Blocked artists screen instead. */
  onSkipEntry: (entry: CuratedAlbumEntry) => void;
  /** Blocks the entry's artist entirely, same mechanism as the main
   *  discovery pool's "No more X albums". */
  onHideArtist: (entry: CuratedAlbumEntry) => void;
  /** Adds this entry to the owner's wantToListen list. A resolved entry adds
   *  straight in; an unresolved entry goes through the same search-confirm
   *  flow as `onRateAlbum` first (see `pendingMatch`). */
  onWantToListen: (entry: CuratedAlbumEntry) => void;
  /** Opens the artist-batch view for this entry's artist (reorder/rate/
   *  discover, same view used elsewhere in the app). Only offered for
   *  entries with a `resolved` MBID -- there's no artist to look up
   *  without one. */
  onViewArtist: (entry: CuratedAlbumEntry) => void;
  /** curatedEntryKey() of the row currently resolving/awaiting confirmation, if any. */
  ratingEntryKey: string | null;
  /** A one-shot message tied to a specific row (e.g. "couldn't find X"),
   *  shown only next to that row. */
  rateMessage: { key: string; text: string } | null;
  /** A search match awaiting owner confirmation before it's inserted --
   *  `kind` picks the destination (a rating insert or a plain wantToListen add). */
  pendingMatch:
    | { key: string; album: Album; kind: 'rate'; rating: number }
    | { key: string; album: Album; kind: 'wantToListen' }
    | null;
  /** Owner confirmed `pendingMatch` is the right album -- insert it now. */
  onConfirmMatch: () => void;
  /** Owner rejected `pendingMatch` -- discard it, row goes back to the rating form. */
  onCancelMatch: () => void;
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

  const picker = document.createElement('select');
  picker.className = 'curated-list-picker';
  picker.setAttribute('aria-label', 'Curated list');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Pick a list…';
  placeholder.selected = !opts.selectedListId;
  picker.append(placeholder);
  for (const [id, list] of Object.entries(opts.lists)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = list.name;
    option.selected = id === opts.selectedListId;
    picker.append(option);
  }
  picker.addEventListener('change', () => {
    if (picker.value) opts.onSelectList(picker.value);
  });
  wrap.append(picker);

  if (!opts.selectedListId) {
    const prompt = document.createElement('p');
    prompt.className = 'saved-empty';
    prompt.textContent = 'Pick a list above.';
    wrap.append(prompt);
    container.append(wrap);
    return;
  }
  const selectedListId = opts.selectedListId;

  const selected = opts.lists[selectedListId];
  const head = document.createElement('div');
  head.className = 'curated-list-head';
  const total = selected.albums.length;
  const rankedCount = opts.rankedEntries.length;
  const hidden = total - rankedCount - opts.unranked.length;
  const heading = document.createElement('p');
  heading.className = 'curated-list-status';
  heading.textContent =
    `${rankedCount} ranked · ${opts.unranked.length} to go` + (hidden > 0 ? ` · ${hidden} skipped or hidden` : '');
  const source = document.createElement('a');
  source.className = 'curated-list-source';
  source.href = selected.source;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.textContent = 'Source';
  const bar = document.createElement('div');
  bar.className = 'curated-list-progress';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${rankedCount} of ${total} ranked`);
  const fill = document.createElement('div');
  fill.className = 'curated-list-progress-fill';
  fill.style.width = `${total ? Math.round((rankedCount / total) * 100) : 0}%`;
  bar.append(fill);
  const headRow = document.createElement('div');
  headRow.className = 'curated-list-head-row';
  headRow.append(heading, source);
  head.append(headRow, bar);
  wrap.append(head);

  if (opts.unranked.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-empty';
    empty.textContent = "You've ranked every album on this list.";
    wrap.append(empty);
    appendRankedSection(wrap, opts);
    container.append(wrap);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'saved-list';
  for (const entry of opts.unranked) {
    const entryKey = curatedEntryKey(selectedListId, entry);
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

    if (opts.rateMessage?.key === entryKey) {
      const msg = document.createElement('p');
      msg.className = 'curated-list-row-status';
      msg.textContent = opts.rateMessage.text;
      meta.append(msg);
    }

    item.append(meta);

    if (opts.pendingMatch?.key === entryKey) {
      const match = opts.pendingMatch;
      const { album } = match;
      const year = album.release_year ?? '?';
      const question =
        match.kind === 'rate' ? `Rate it ${match.rating}?` : 'Add it to Want to listen?';
      const found = document.createElement('p');
      found.className = 'curated-list-match-text';
      found.textContent = `Found: ${album.title} by ${album.primary_artist_name} (${year}). ${question}`;

      const confirmForm = document.createElement('div');
      confirmForm.className = 'candidate-place';

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'candidate-place-button';
      confirmBtn.textContent = 'Yes, that one';
      confirmBtn.addEventListener('click', () => opts.onConfirmMatch());

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'candidate-place-button';
      cancelBtn.textContent = 'Not this one';
      cancelBtn.addEventListener('click', () => opts.onCancelMatch());

      confirmForm.append(confirmBtn, cancelBtn);
      item.append(found, confirmForm);
      list.append(item);
      continue;
    }

    const isRating = opts.ratingEntryKey === entryKey;
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
    input.disabled = opts.ratingEntryKey !== null;
    input.setAttribute('aria-label', `Rating for ${entry.title}`);

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'candidate-place-button';
    btn.textContent = isRating ? 'Searching…' : 'Rate';
    btn.disabled = opts.ratingEntryKey !== null;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      const rating = Number(raw);
      if (raw === '' || !Number.isFinite(rating) || rating < 0 || rating > 10) {
        // Native constraint-validation UI is off (noValidate, above), so an
        // out-of-range/unparseable value used to fail with zero feedback --
        // read as "rating a curated album doesn't save". Same message
        // rankList.ts's equivalent rating input shows via showStatus.
        let invalidMsg = form.querySelector<HTMLParagraphElement>('.curated-list-row-status');
        if (!invalidMsg) {
          invalidMsg = document.createElement('p');
          invalidMsg.className = 'curated-list-row-status';
          form.append(invalidMsg);
        }
        invalidMsg.textContent = 'Enter 0-10.';
        return;
      }
      opts.onRateAlbum(entry, Math.round(rating * 100) / 100);
    });

    form.append(input, btn);
    item.append(form);

    const actions = document.createElement('div');
    actions.className = 'candidate-place';

    const wantBtn = document.createElement('button');
    wantBtn.type = 'button';
    wantBtn.className = 'candidate-place-button';
    wantBtn.textContent = 'Want to listen';
    wantBtn.disabled = opts.ratingEntryKey !== null;
    wantBtn.addEventListener('click', () => opts.onWantToListen(entry));
    actions.append(wantBtn);

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'candidate-place-button';
    skipBtn.textContent = 'Skip for now';
    skipBtn.disabled = opts.ratingEntryKey !== null;
    skipBtn.addEventListener('click', () => opts.onSkipEntry(entry));
    actions.append(skipBtn);

    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'candidate-place-button';
    hideBtn.textContent = `No more ${entry.artist}`;
    hideBtn.disabled = opts.ratingEntryKey !== null;
    hideBtn.addEventListener('click', () => opts.onHideArtist(entry));
    actions.append(hideBtn);

    if (entry.resolved) {
      const viewArtistBtn = document.createElement('button');
      viewArtistBtn.type = 'button';
      viewArtistBtn.className = 'candidate-place-button';
      viewArtistBtn.textContent = `All ${entry.artist} albums`;
      viewArtistBtn.disabled = opts.ratingEntryKey !== null;
      viewArtistBtn.addEventListener('click', () => opts.onViewArtist(entry));
      actions.append(viewArtistBtn);
    }

    item.append(actions);
    list.append(item);
  }
  wrap.append(list);
  appendRankedSection(wrap, opts);

  container.append(wrap);
}

/** Collapsed list of entries already ranked, so progress is visible without
 *  crowding the to-do rows. */
function appendRankedSection(wrap: HTMLElement, opts: CuratedListViewOptions): void {
  if (opts.rankedEntries.length === 0) return;
  const details = document.createElement('details');
  details.className = 'curated-list-ranked';
  const summary = document.createElement('summary');
  summary.textContent = `Already ranked (${opts.rankedEntries.length})`;
  const ul = document.createElement('ul');
  ul.className = 'saved-list';
  for (const { entry, rating } of opts.rankedEntries) {
    const li = document.createElement('li');
    li.className = 'saved-item';
    const meta = document.createElement('div');
    meta.className = 'saved-meta';
    const title = document.createElement('p');
    title.className = 'saved-title';
    title.textContent = `#${entry.rank} · ${entry.title}`;
    const artist = document.createElement('p');
    artist.className = 'saved-artist';
    artist.textContent = `${entry.artist} · you rated ${rating.toFixed(2)}`;
    meta.append(title, artist);
    li.append(meta);
    ul.append(li);
  }
  details.append(summary, ul);
  wrap.append(details);
}
