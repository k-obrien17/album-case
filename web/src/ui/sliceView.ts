import type { Album, RankedAlbum } from '../ranking/types';
import type { Suggestion } from '../suggestions';
import { mountRankList } from './rankList';

/** The inline discovery strip under a slice's ranked rows. Omitted for
 *  pseudo-slices with no candidate source (Year unknown, No genre yet,
 *  More genres). */
export type SliceCandidatesOptions = {
  title: string;
  /** Up to 3 slice-matching suggestions; [] shows the empty message. */
  get: () => Suggestion[];
  onRate: (album: Album, rating: number) => void;
  onWantToListen: (album: Album) => void;
  /** Skip for this visit; the caller refreshes the strip. */
  onSkip: (album: Album) => void;
  onFindMore: () => void;
};

export type SliceViewOptions = {
  /** Section label, used in the heading (e.g. "1994", "1990s", "shoegaze"). */
  label: string;
  /** The full global ranked array (index space for the editors). */
  getRanked: () => RankedAlbum[];
  /** The slice's albums, in global rating order. */
  getSliceAlbums: () => RankedAlbum[];
  /** Global-index contracts, same as artistBatchView's. */
  onSetRating: (from: number, rating: number) => void;
  onSetOverallRank: (from: number, to: number) => void;
  onRemoveRanked: (album: Album) => void;
  onUndoRemove: () => void;
  onClose: () => void;
  candidates?: SliceCandidatesOptions;
};

export type SliceViewController = {
  render: () => void;
  teardown: () => void;
};

/**
 * One browse section (a year, decade, or genre) as its own screen: the
 * slice's ranked rows rendered through rankList with reordering suppressed
 * (a drop index against a partial list would compute a wrong rating), while
 * the mbid-resolved rating/overall editors stay live. Artist sections use
 * artistBatchView instead, which already is the artist slice.
 */
export function mountSliceView(
  container: HTMLElement,
  opts: SliceViewOptions
): SliceViewController {
  let listController: ReturnType<typeof mountRankList> | null = null;

  function render(): void {
    container.textContent = '';
    listController?.teardown();
    listController = null;

    const wrap = document.createElement('div');
    wrap.className = 'lock-view slice-view';

    const header = document.createElement('div');
    header.className = 'lock-view-header';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lock-view-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => opts.onClose());
    const heading = document.createElement('h2');
    heading.className = 'lock-view-title';
    heading.textContent = opts.label;
    header.append(backBtn, heading);
    wrap.append(header);

    // The candidate strip renders below every ranked row, which in a long
    // slice puts it several screens down; this link is how anyone finds it.
    if (opts.candidates) {
      const picks = opts.candidates.get();
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'slice-candidates-jump';
      if (picks.length > 0) {
        jump.textContent = `${picks.length} unranked pick${picks.length === 1 ? '' : 's'} for ${opts.label} ↓`;
        jump.addEventListener('click', () => {
          wrap.querySelector('.slice-candidates-section')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        });
      } else {
        // Nothing to scroll to: the header control does the strip's one
        // useful action directly.
        jump.textContent = `Find more from ${opts.label}`;
        jump.addEventListener('click', opts.candidates.onFindMore);
      }
      wrap.append(jump);
    }

    const listCol = document.createElement('div');
    listCol.className = 'lock-ranked-col';
    listController = mountRankList(listCol, {
      getRanked: opts.getSliceAlbums,
      getGlobalRanked: opts.getRanked,
      getCandidate: () => null,
      hideCandidateColumn: true,
      suppressReorder: true,
      emptyRankedMessage: `Nothing ranked in ${opts.label} any more.`,
      onPlace: () => {},
      onReorder: () => {},
      onSetRating: opts.onSetRating,
      onSetOverallRank: opts.onSetOverallRank,
      onRemoveRanked: opts.onRemoveRanked,
      onUndoRemove: opts.onUndoRemove,
      onSetAside: () => {},
      onSkip: () => {},
      onBlockArtist: () => {},
    });
    wrap.append(listCol);

    if (opts.candidates) wrap.append(buildCandidateStrip(opts.candidates));

    container.append(wrap);
  }

  /** Card markup mirrors backlogView.ts's albumCard (its builder is module-
   *  private), reusing the same CSS classes so the two read as one system. */
  function buildCandidateStrip(candidates: SliceCandidatesOptions): HTMLElement {
    const strip = document.createElement('section');
    strip.className = 'slice-candidates-section';

    const heading = document.createElement('h3');
    heading.textContent = candidates.title;
    strip.append(heading);

    const picks = candidates.get();
    if (picks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'slice-candidates-empty';
      empty.textContent = 'No unranked picks for this slice yet. Fill in more albums, or cast a wider net below.';
      strip.append(empty);
    } else {
      const grid = document.createElement('ul');
      grid.className = 'backlog-grid slice-candidates';
      for (const pick of picks) grid.append(buildCandidateCard(pick, candidates));
      strip.append(grid);
    }

    const findMore = document.createElement('button');
    findMore.type = 'button';
    findMore.className = 'backlog-button slice-find-more';
    findMore.textContent = `Find more from ${opts.label}`;
    findMore.addEventListener('click', candidates.onFindMore);
    strip.append(findMore);
    return strip;
  }

  function buildCandidateCard(pick: Suggestion, candidates: SliceCandidatesOptions): HTMLLIElement {
    const { album } = pick;
    const card = document.createElement('li');
    card.className = 'backlog-card';

    const cover = document.createElement('div');
    cover.className = 'backlog-cover';
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (album.cover_url) img.src = album.cover_url;
    img.addEventListener('error', () => { img.hidden = true; });
    cover.append(img);

    const year = document.createElement('p');
    year.className = 'backlog-year';
    year.textContent = String(album.release_year ?? 'Year unknown');
    const title = document.createElement('h3');
    title.textContent = album.title;
    const artist = document.createElement('p');
    artist.className = 'backlog-artist-name';
    artist.textContent = album.primary_artist_name;
    const reason = document.createElement('p');
    reason.className = 'suggestion-reason';
    reason.textContent = pick.reason;
    card.append(cover, year, title, artist, reason);

    const actions = document.createElement('div');
    actions.className = 'backlog-card-actions';

    const form = document.createElement('form');
    form.className = 'backlog-rate';
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.max = '10';
    input.step = '0.01';
    input.required = true;
    input.placeholder = '0–10';
    input.setAttribute('aria-label', `Rating for ${album.title}`);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'backlog-button backlog-primary';
    submit.textContent = 'Rate now';
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const rating = Number(input.value);
      if (input.value.trim() && Number.isFinite(rating) && rating >= 0 && rating <= 10) {
        candidates.onRate(album, Math.round(rating * 100) / 100);
      }
    });
    form.append(input, submit);
    actions.append(form);

    const want = document.createElement('button');
    want.type = 'button';
    want.className = 'backlog-button';
    want.textContent = 'Want to listen';
    want.addEventListener('click', () => candidates.onWantToListen(album));
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'backlog-button';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => candidates.onSkip(album));
    actions.append(want, skip);

    card.append(actions);
    return card;
  }

  function teardown(): void {
    listController?.teardown();
    listController = null;
  }

  render();
  return { render, teardown };
}
