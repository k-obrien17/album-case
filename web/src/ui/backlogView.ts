import type { Album } from '../ranking/types';
import type { SavedLists } from '../lists';
import { decisionFor, otherReleaseReason, type ArtistGap, type ReviewDecision } from '../backlog';
import type { Suggestion } from '../suggestions';

export type BacklogShelf = 'artists' | 'readyToRank' | 'wantToListen' | 'suggestions';
export type BacklogViewOptions = {
  artists: ArtistGap[];
  lists: SavedLists;
  selectedArtistId: string | null;
  shelf: BacklogShelf;
  showOther: boolean;
  message: string;
  canUndo: boolean;
  suggestion: Suggestion | null;
  suggestionLoading: boolean;
  suggestionUnavailable: boolean;
  onSkipSuggestion: () => void;
  onShelf: (shelf: BacklogShelf) => void;
  onArtist: (id: string) => void;
  onShowOther: (show: boolean) => void;
  onDecide: (album: Album, decision: ReviewDecision | null) => void;
  onRate: (album: Album, rating: number) => void;
  onFinish: (id: string) => void;
  onUndo: () => void;
  onRankings: (album: Album) => void;
};

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.textContent = value;
  el.className = className;
  return el;
}

function button(label: string, action: () => void, focusKey = label): HTMLButtonElement {
  const el = text('button', label, 'backlog-button');
  el.type = 'button';
  el.dataset.focusKey = focusKey;
  el.addEventListener('click', action);
  return el;
}

function albumCard(album: Album, opts: BacklogViewOptions, queue: boolean): HTMLElement {
  const card = document.createElement('li');
  card.className = 'backlog-card';
  card.dataset.albumId = album.mbid;
  const cover = document.createElement('div');
  cover.className = 'backlog-cover';
  const img = new Image();
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (album.cover_url) img.src = album.cover_url;
  img.addEventListener('error', () => { img.hidden = true; });
  cover.append(img);
  card.append(cover, text('p', String(album.release_year ?? 'Year unknown'), 'backlog-year'), text('h3', album.title), text('p', album.primary_artist_name, 'backlog-artist-name'));
  const reason = otherReleaseReason(album);
  if (reason) card.append(text('p', reason, 'backlog-hint'));
  const actions = document.createElement('div');
  actions.className = 'backlog-card-actions';
  {
    const form = document.createElement('form');
    form.className = 'backlog-rate';
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.max = '10';
    input.step = '0.01';
    input.required = true;
    input.dataset.focusKey = `${album.mbid}:rating`;
    input.placeholder = '0–10';
    input.setAttribute('aria-label', `Rating for ${album.title}`);
    const submit = button('Rate now', () => {}, `${album.mbid}:rate`);
    submit.classList.add('backlog-primary');
    submit.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const rating = Number(input.value);
      if (input.value.trim() && Number.isFinite(rating) && rating >= 0 && rating <= 10) opts.onRate(album, Math.round(rating * 100) / 100);
    });
    form.append(input, submit);
    actions.append(form);
  }
  if (opts.shelf !== 'readyToRank' && opts.shelf !== 'suggestions') {
    const ready = button('Know it — rate later', () => opts.onDecide(album, 'readyToRank'), `${album.mbid}:ready`);
    actions.append(ready);
  }
  if (opts.shelf !== 'wantToListen') actions.append(button('Want to listen', () => opts.onDecide(album, 'wantToListen'), `${album.mbid}:listen`));
  if (opts.shelf === 'suggestions') {
    actions.append(button('Skip', opts.onSkipSuggestion, 'suggestion:skip'));
  } else if (!queue) {
    actions.append(button('Haven’t heard', () => opts.onDecide(album, 'notHeard'), `${album.mbid}:unheard`));
    actions.append(button('Not interested', () => opts.onDecide(album, 'dontCare'), `${album.mbid}:ignore`));
  } else {
    actions.append(button('Return to artist review', () => opts.onDecide(album, null), `${album.mbid}:return`));
  }
  card.append(actions);
  return card;
}

export function renderBacklogView(container: HTMLElement, opts: BacklogViewOptions): void {
  const activeKey = (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  const activeCard = document.activeElement?.closest('.backlog-card');
  const nextKey = activeCard?.nextElementSibling?.querySelector<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
  container.textContent = '';
  const wrap = document.createElement('section');
  wrap.className = 'backlog-view';
  wrap.append(text('h2', 'Find albums I’ve missed'));
  wrap.append(text('p', 'Scan familiar artists. Rate albums now, or save them for later.', 'backlog-intro'));
  const reviewed = opts.artists.filter((a) => a.reviewed).length;
  wrap.append(text('p', `${reviewed} of ${opts.artists.length} artists reviewed · Based on your saved catalogue and listening history`, 'backlog-progress'));
  const tabs = document.createElement('div');
  tabs.className = 'backlog-tabs';
  for (const [shelf, label] of [
    ['suggestions', 'Suggest one'],
    ['artists', 'Artist gaps'],
    ['readyToRank', `Ready to rank (${opts.lists.backlog?.readyToRank.length ?? 0})`],
    ['wantToListen', `Want to listen (${opts.lists.wantToListen.length})`],
  ] as const) {
    const tab = button(label, () => opts.onShelf(shelf), `shelf:${shelf}`);
    tab.setAttribute('aria-pressed', String(opts.shelf === shelf));
    tabs.append(tab);
  }
  wrap.append(tabs);
  const status = text('div', opts.message, 'backlog-status');
  status.setAttribute('role', 'status');
  if (opts.canUndo) status.append(button('Undo', opts.onUndo));
  if (opts.message) wrap.append(status);

  if (opts.shelf === 'suggestions') {
    wrap.append(text('h3', 'One album you might like'));
    wrap.append(text('p', 'Mostly familiar artists, with an occasional related discovery. Skip moves on for this visit.', 'backlog-hint'));
    if (opts.suggestion) {
      const grid = document.createElement('ul');
      grid.className = 'backlog-grid suggestion-grid';
      const card = albumCard(opts.suggestion.album, opts, false);
      card.prepend(text('p', opts.suggestion.kind === 'familiar' ? 'From your listening and ratings' : 'A related discovery', 'backlog-hint'));
      const reason = text('p', opts.suggestion.reason, 'suggestion-reason');
      card.insertBefore(reason, card.querySelector('.backlog-card-actions'));
      grid.append(card);
      wrap.append(grid);
    } else {
      wrap.append(text('p', opts.suggestionLoading ? 'Checking artists related to your favorites…'
        : 'No more strong matches in this pass. Try Artist gaps or add more ratings.', 'backlog-status'));
    }
    if (opts.suggestionUnavailable) wrap.append(text('p', 'Related-artist lookup is unavailable. Picks still use your ratings and listening history.', 'backlog-hint'));
  } else if (opts.shelf !== 'artists') {
    const albums = opts.shelf === 'wantToListen' ? opts.lists.wantToListen : opts.lists.backlog?.readyToRank ?? [];
    wrap.append(text('h3', opts.shelf === 'readyToRank' ? 'Familiar albums, ready for your scores' : 'Come back after a listen'));
    if (!albums.length) wrap.append(text('p', opts.shelf === 'readyToRank' ? 'Your queue is clear. Pick familiar albums from Artist gaps to fill it.' : 'Albums you want to listen to will wait here.'));
    const grid = document.createElement('ul');
    grid.className = 'backlog-grid';
    for (const a of albums) grid.append(albumCard(a, opts, true));
    wrap.append(grid);
  } else if (!opts.artists.length) {
    wrap.append(text('p', 'Rank an album or add artists from search to start finding gaps.'));
  } else {
    const selected = opts.artists.find((a) => a.id === opts.selectedArtistId) ?? opts.artists[0];
    const pickerLabel = text('label', 'Choose an artist', 'backlog-picker');
    const picker = document.createElement('select');
    picker.dataset.focusKey = 'artist-picker';
    for (const a of opts.artists) {
      const option = text('option', `${a.name} · ${a.ranked.length} ranked · ${a.remaining.length} to review${a.reviewed ? ' · reviewed' : ''}`);
      option.value = a.id;
      option.selected = a.id === selected.id;
      picker.append(option);
    }
    picker.addEventListener('change', () => opts.onArtist(picker.value));
    pickerLabel.append(picker);
    wrap.append(pickerLabel);
    const artistHeading = document.createElement('div');
    artistHeading.className = 'backlog-artist-heading';
    artistHeading.append(text('h3', selected.name));
    const index = opts.artists.indexOf(selected);
    const next = opts.artists[(index + 1) % opts.artists.length];
    artistHeading.append(button('Next artist →', () => opts.onArtist(next.id)));
    wrap.append(artistHeading);
    const other = selected.remaining.filter((a) => otherReleaseReason(a));
    const albums = selected.remaining.filter((a) => opts.showOther || !otherReleaseReason(a));
    wrap.append(text('p', `${selected.ranked.length} ranked · ${selected.remaining.length} to review${selected.reviewed ? ' · Artist reviewed' : ''}`, 'backlog-progress'));
    if (other.length) {
      const toggle = text('label', '', 'backlog-toggle');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = opts.showOther;
      checkbox.dataset.focusKey = 'show-other';
      checkbox.addEventListener('change', () => opts.onShowOther(checkbox.checked));
      toggle.append(checkbox, document.createTextNode(`Show likely other releases (${other.length})`));
      wrap.append(toggle, text('p', 'Flagged from titles; some may belong in your ranking. Nothing is removed.', 'backlog-hint'));
    }
    if (!albums.length) wrap.append(text('p', other.length && !opts.showOther ? 'No more albums in this view. You can check the other releases or move to the next artist.' : 'No unreviewed albums in your saved catalogue for this artist.'));
    const grid = document.createElement('ul');
    grid.className = 'backlog-grid';
    for (const album of albums) grid.append(albumCard(album, opts, false));
    wrap.append(grid);
    const finish = button('Finish artist & next →', () => opts.onFinish(selected.id));
    finish.classList.add('backlog-primary');
    wrap.append(finish);
    const decisions = selected.albums.filter((a) => decisionFor(opts.lists, a));
    if (selected.ranked.length || decisions.length) {
      const detail = document.createElement('details');
      detail.className = 'backlog-reviewed';
      detail.append(text('summary', `Already ranked or reviewed (${selected.ranked.length + decisions.length})`));
      const list = document.createElement('ul');
      for (const album of selected.ranked) list.append(text('li', `${album.title} · ${album.rating.toFixed(2)}`));
      for (const album of decisions) {
        const row = text('li', `${album.title} · ${decisionFor(opts.lists, album)} `);
        row.append(button('Review again', () => opts.onDecide(album, null), `${album.mbid}:again`));
        list.append(row);
      }
      detail.append(list);
      if (selected.ranked[0]?.primary_artist_mbid) detail.append(button('Edit this artist’s rankings', () => opts.onRankings(selected.ranked[0])));
      wrap.append(detail);
    }
  }
  container.append(wrap);
  if (activeKey) {
    const controls = [...wrap.querySelectorAll<HTMLElement>('[data-focus-key]')];
    const target = controls.find((el) => el.dataset.focusKey === activeKey)
      ?? (nextKey ? controls.find((el) => el.dataset.focusKey === nextKey) : undefined)
      ?? (activeCard ? wrap.querySelector<HTMLElement>('.backlog-tabs [aria-pressed="true"]') : null);
    target?.focus({ preventScroll: true });
  }
}
