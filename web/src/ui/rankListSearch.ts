import type { Album, RankedAlbum } from '../ranking/types';
import type { ArtistResult } from '../artistSearch';

/** The current state of a MusicBrainz fallback search. Four distinct
 *  members (not one member with a union-typed `status`) so a sequence of
 *  `status === '...'` equality checks narrows `results` cleanly down to the
 *  `'done'` member without an explicit final guard. */
export type SearchResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; albums: Album[]; artists: ArtistResult[] };

/** Shortest query that searches new albums automatically (main.ts debounces
 *  it); anything shorter only filters your own list. */
export const MIN_AUTO_SEARCH_CHARS = 3;

export function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}

export type RankListSearchDeps = {
  getRanked: () => RankedAlbum[];
  getGlobalRanked?: () => RankedAlbum[];
  onSearchMusicBrainz?: (query: string, options?: { live?: boolean }) => void;
  getSearchResults?: () => SearchResultsState;
  onRateSearchResult?: (album: Album, rating: number) => void;
  onSelectArtist?: (artist: ArtistResult) => void;
  getSelectingArtistMbid?: () => string | null;
  getArtistSelectMessage?: () => string | null;
  /** Surfaces a transient status message (e.g. a rating-validation error) --
   *  same banner rankList.ts's row/candidate controls use. */
  showStatus: (message: string) => void;
};

export type RankListSearchSection = {
  buildSearchEmptyState: (query: string) => HTMLLIElement;
  buildSearchMoreRow: (query: string) => HTMLLIElement | null;
};

/**
 * The merged MusicBrainz search box + fallback results UI shown above/below
 * the ranked list. Extracted out of rankList.ts's mountRankList closure --
 * this cluster shares no mutable state with the rest of that file (no
 * drag/assist/row-editing involvement), only this narrow options slice, so
 * it's the first cut of the "targeted rankList.ts split". render() in
 * rankList.ts only ever calls the three functions this returns;
 * buildSearchResultRow/artistSubtitle/buildArtistResultRow/
 * buildMusicBrainzFallback are private, only reached through those three.
 */
export function createSearchSection(deps: RankListSearchDeps): RankListSearchSection {
  /** One MusicBrainz result row: title/artist/year, plus either a rating
   *  input (add-at-rating) or "Already in your list" when the album is
   *  already ranked. Checked against the GLOBAL ranked list (never the
   *  filtered one this instance renders) so a match is never missed just
   *  because the current query happens to filter it out. */
  function buildSearchResultRow(album: Album): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-search-result';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const title = document.createElement('p');
    title.className = 'rank-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = subtitle(album);
    meta.append(title, sub);
    li.append(meta);

    const globalRanked = deps.getGlobalRanked?.() ?? deps.getRanked();
    const alreadyRanked = globalRanked.some((a) => a.mbid === album.mbid);
    if (alreadyRanked) {
      const already = document.createElement('span');
      already.className = 'rank-search-already';
      already.textContent = 'Already in your list';
      li.append(already);
      return li;
    }

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

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'candidate-place-button';
    btn.textContent = 'Add';

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      if (raw === '') {
        deps.showStatus('Enter 0-10.');
        return;
      }
      const rating = Number(raw);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        deps.showStatus('Enter 0-10.');
        return;
      }
      deps.onRateSearchResult?.(album, Math.round(rating * 100) / 100);
    });

    form.append(input, btn);
    li.append(form);
    return li;
  }

  function artistSubtitle(artist: ArtistResult): string {
    const parts = [artist.disambiguation, artist.type, artist.country].filter(
      (part): part is string => !!part
    );
    return parts.join(' · ');
  }

  function buildArtistResultRow(artist: ArtistResult): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-search-result';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const name = document.createElement('p');
    name.className = 'rank-title';
    name.textContent = artist.name;
    meta.append(name);
    const sub = artistSubtitle(artist);
    if (sub) {
      const subEl = document.createElement('p');
      subEl.className = 'rank-sub';
      subEl.textContent = sub;
      meta.append(subEl);
    }
    li.append(meta);

    const selectingMbid = deps.getSelectingArtistMbid?.() ?? null;
    const isSelecting = selectingMbid === artist.mbid;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate-action';
    btn.textContent = isSelecting ? 'Loading…' : 'See albums';
    btn.disabled = selectingMbid !== null;
    btn.setAttribute('aria-label', `See albums by ${artist.name}`);
    btn.addEventListener('click', () => deps.onSelectArtist?.(artist));
    li.append(btn);

    return li;
  }

  /** The MusicBrainz fallback itself -- an idle "search" prompt, a loading
   *  state, an error + retry, or the results list. Shared by the
   *  no-local-matches empty state AND the "search for more by this artist"
   *  prompt shown below local matches, so a searched artist who already has
   *  an album ranked still has a path to discover their other albums.
   *  Returns null when `onSearchMusicBrainz` is omitted (MusicBrainz search
   *  disabled entirely). `query` is already trimmed by the caller. */
  function buildMusicBrainzFallback(query: string): HTMLElement | null {
    if (!deps.onSearchMusicBrainz) return null;

    const wrap = document.createElement('div');
    wrap.className = 'rank-search-fallback';

    const searchBtn = (label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'candidate-action';
      btn.textContent = label;
      btn.addEventListener('click', () => deps.onSearchMusicBrainz?.(query));
      return btn;
    };

    // Forces a live MusicBrainz search, bypassing the catalog: covers
    // same-day releases and anything below the catalog's popularity floor.
    const searchEverywhereBtn = (): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'candidate-action rank-search-everywhere';
      btn.textContent = 'Search everywhere';
      btn.addEventListener('click', () => deps.onSearchMusicBrainz?.(query, { live: true }));
      return btn;
    };

    const results: SearchResultsState = deps.getSearchResults?.() ?? { status: 'idle' };

    if (results.status === 'idle' && query.length < MIN_AUTO_SEARCH_CHARS) {
      const hint = document.createElement('p');
      hint.className = 'rank-search-status';
      hint.textContent = 'Keep typing to search for new albums.';
      wrap.append(hint);
      return wrap;
    }

    // Idle at full length means the debounced search is about to fire.
    if (results.status === 'idle' || results.status === 'loading') {
      const loading = document.createElement('p');
      loading.className = 'rank-search-status';
      loading.textContent = 'Searching for new albums…';
      wrap.append(loading);
      return wrap;
    }

    if (results.status === 'error') {
      const err = document.createElement('p');
      err.className = 'rank-search-status';
      err.textContent = "Couldn't reach MusicBrainz. Try again.";
      wrap.append(err, searchBtn('Try again'));
      return wrap;
    }

    // status === 'done'
    if (results.albums.length === 0 && results.artists.length === 0) {
      const none = document.createElement('p');
      none.className = 'rank-search-status';
      none.textContent = 'No albums or bands found.';
      wrap.append(none, searchEverywhereBtn());
      return wrap;
    }

    if (results.albums.length > 0) {
      const label = document.createElement('p');
      label.className = 'rank-search-section-label';
      label.textContent = 'Add to your list';
      const albumsList = document.createElement('ul');
      albumsList.className = 'rank-search-results';
      for (const album of results.albums) albumsList.append(buildSearchResultRow(album));
      wrap.append(label, albumsList);
    }

    if (results.artists.length > 0) {
      const label = document.createElement('p');
      label.className = 'rank-search-section-label';
      label.textContent = 'Bands';
      const artistsList = document.createElement('ul');
      artistsList.className = 'rank-search-results';
      for (const artist of results.artists) artistsList.append(buildArtistResultRow(artist));
      wrap.append(label, artistsList);
    }

    const selectMessage = deps.getArtistSelectMessage?.() ?? null;
    if (selectMessage) {
      const msg = document.createElement('p');
      msg.className = 'rank-search-status';
      msg.textContent = selectMessage;
      wrap.append(msg);
    }

    wrap.append(searchEverywhereBtn());
    return wrap;
  }

  /** The no-local-matches empty state: a plain message, plus the
   *  MusicBrainz fallback. `query` is already trimmed by the caller. */
  function buildSearchEmptyState(query: string): HTMLLIElement {
    const empty = document.createElement('li');
    empty.className = 'rank-empty rank-search-empty';

    const message = document.createElement('p');
    message.textContent = `No albums in your list match "${query}".`;
    empty.append(message);

    const fallback = buildMusicBrainzFallback(query);
    if (fallback) empty.append(fallback);
    return empty;
  }

  /** Shown below local matches when filtered: new-album results for `query`
   *  even though the local filter already found something -- otherwise an
   *  artist with one album already ranked could never surface their others.
   *  Returns null when MusicBrainz search is disabled. */
  function buildSearchMoreRow(query: string): HTMLLIElement | null {
    const fallback = buildMusicBrainzFallback(query);
    if (!fallback) return null;

    const li = document.createElement('li');
    li.className = 'rank-empty rank-search-more';
    li.append(fallback);
    return li;
  }

  return { buildSearchEmptyState, buildSearchMoreRow };
}
