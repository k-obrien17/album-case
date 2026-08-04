import type { ArtistResult } from '../artistSearch';

export type ArtistSearchResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; artists: ArtistResult[] };

export type ArtistSelectResult =
  | { status: 'ok' }
  | { status: 'locked' | 'empty' | 'error' };

export type ArtistSearchViewOptions = {
  getQuery: () => string;
  onQueryChange: (query: string) => void;
  getResults: () => ArtistSearchResultsState;
  onSelectArtist: (artist: ArtistResult) => Promise<ArtistSelectResult>;
  onClose: () => void;
};

export type ArtistSearchViewController = {
  render: () => void;
  teardown: () => void;
};

function subtitle(artist: ArtistResult): string {
  const parts = [artist.disambiguation, artist.type, artist.country].filter(
    (part): part is string => !!part
  );
  return parts.join(' · ');
}

/**
 * Dedicated artist-name search ("Add a band"), separate from the existing
 * album-title search in rankList.ts. Selecting a result triggers discovery
 * and, on success, the caller (main.ts) navigates straight into the
 * existing artist-batch view -- this module only ever needs to render the
 * search UI and the failure states that keep the owner here to retry.
 */
export function mountArtistSearchView(
  container: HTMLElement,
  opts: ArtistSearchViewOptions
): ArtistSearchViewController {
  let selectingMbid: string | null = null;
  let selectMessage: string | null = null;
  let torn = false;

  async function handleSelect(artist: ArtistResult): Promise<void> {
    if (selectingMbid) return; // a selection is already in flight
    selectingMbid = artist.mbid;
    selectMessage = null;
    render();

    const result = await opts.onSelectArtist(artist);
    if (torn) return; // view left (e.g. "Back") while the select was in flight
    selectingMbid = null;

    if (result.status === 'locked') {
      selectMessage = 'Unlock writes to add a band.';
    } else if (result.status === 'empty') {
      selectMessage = `No albums found for ${artist.name}.`;
    } else if (result.status === 'error') {
      selectMessage = `Could not load ${artist.name}'s albums.`;
    } else {
      return; // 'ok' -- caller is navigating away, nothing left to render
    }
    render();
  }

  function buildResultRow(artist: ArtistResult): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-search-result';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const name = document.createElement('p');
    name.className = 'rank-title';
    name.textContent = artist.name;
    meta.append(name);
    const sub = subtitle(artist);
    if (sub) {
      const subEl = document.createElement('p');
      subEl.className = 'rank-sub';
      subEl.textContent = sub;
      meta.append(subEl);
    }
    li.append(meta);

    const isSelecting = selectingMbid === artist.mbid;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate-action';
    btn.textContent = isSelecting ? 'Loading…' : 'Rank all albums';
    btn.disabled = selectingMbid !== null;
    btn.setAttribute('aria-label', `Rank all of ${artist.name}'s albums`);
    btn.addEventListener('click', () => {
      void handleSelect(artist);
    });
    li.append(btn);

    return li;
  }

  function buildResults(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rank-search-fallback';
    const results = opts.getResults();

    if (results.status === 'loading') {
      const p = document.createElement('p');
      p.className = 'rank-search-status';
      p.textContent = 'Searching…';
      wrap.append(p);
      return wrap;
    }
    if (results.status === 'error') {
      const p = document.createElement('p');
      p.className = 'rank-search-status';
      p.textContent = "Couldn't reach MusicBrainz. Try again.";
      wrap.append(p);
      return wrap;
    }
    if (results.status === 'done') {
      if (results.artists.length === 0) {
        const p = document.createElement('p');
        p.className = 'rank-search-status';
        p.textContent = 'No bands found.';
        wrap.append(p);
        return wrap;
      }
      const list = document.createElement('ul');
      list.className = 'rank-search-results';
      for (const artist of results.artists) list.append(buildResultRow(artist));
      wrap.append(list);
      return wrap;
    }
    return wrap; // 'idle' -- nothing typed yet
  }

  function render(): void {
    if (torn) return; // stray call after teardown -- nothing left to draw into

    // Same focus/caret preservation as rankList.ts's own search box: capture
    // BEFORE clearing the container, since removing a focused element fires
    // a synchronous blur that would otherwise clear this first.
    const prevInput = container.querySelector<HTMLInputElement>('.rank-search-input');
    const wasFocused = !!prevInput && document.activeElement === prevInput;
    const caret = wasFocused ? prevInput!.selectionStart : null;

    container.textContent = '';

    const wrap = document.createElement('div');
    wrap.className = 'lock-view';

    const header = document.createElement('div');
    header.className = 'lock-view-header';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lock-view-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => opts.onClose());
    const heading = document.createElement('h2');
    heading.className = 'lock-view-title';
    heading.textContent = 'Add a band';
    header.append(backBtn, heading);
    wrap.append(header);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'rank-search';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'rank-search-input';
    input.placeholder = 'Search for a band';
    input.setAttribute('aria-label', 'Search for a band');
    input.value = opts.getQuery();
    input.addEventListener('input', () => opts.onQueryChange(input.value));
    searchWrap.append(input);
    wrap.append(searchWrap);

    if (selectMessage) {
      const msg = document.createElement('p');
      msg.className = 'rank-search-status';
      msg.textContent = selectMessage;
      wrap.append(msg);
    }

    wrap.append(buildResults());
    container.append(wrap);

    if (wasFocused) {
      const mounted = container.querySelector<HTMLInputElement>('.rank-search-input');
      if (mounted) {
        mounted.focus();
        if (caret != null) mounted.setSelectionRange(caret, caret);
      }
    }
  }

  function teardown(): void {
    // handleSelect's onSelectArtist await can outlive the mount if the owner
    // navigates away (e.g. "Back") before it resolves; `torn` stops that
    // stale continuation from writing selectMessage/render()-ing into a
    // container another view now owns. Mirrors speedRound.ts's `active` flag.
    torn = true;
  }

  render();
  return { render, teardown };
}
