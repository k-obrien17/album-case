import type { Album, RankedAlbum } from '../ranking/types';
import type { SavedLists } from '../lists';
import { artistAlbumsFor, mapFilteredReorderToGlobal } from '../artistLockAlbums';
import { mountRankList } from './rankList';

export type ArtistDiscoverViewResult =
  | { status: 'found'; count: number }
  | { status: 'empty' | 'locked' | 'error' };

export type ArtistBatchViewOptions = {
  album: Album;
  getRanked: () => RankedAlbum[];
  getLists: () => SavedLists;
  getPool: () => Album[];
  onReorder: (from: number, to: number) => void;
  onRemoveRanked?: (album: Album) => void;
  /** Move the album at global index `from` to post-removal global index
   *  `to`. Always global-space, regardless of this view's filtered
   *  rendering -- distinct from `onReorder`, which exists for the
   *  within-artist drag path and its filtered-to-global index translation. */
  onSetOverallRank?: (from: number, to: number) => void;
  /** Set the rating of the ranked album at global index `from` directly.
   *  Same global-index contract as `onSetOverallRank`. */
  onSetRating?: (from: number, rating: number) => void;
  /** Rate a not-yet-ranked album directly (0-10, two decimal places) --
   *  inserts it wherever that rating lands it, same as the main candidate
   *  card's "Or rate it directly" control. */
  onRate: (album: Album, rating: number) => void;
  onDiscover: () => Promise<ArtistDiscoverViewResult>;
  onClose: () => void;
};

export type ArtistBatchViewController = {
  render: () => void;
  teardown: () => void;
};

function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}

/**
 * Stacked, single-artist view: this artist's ranked albums in their own
 * mini-list (drag to reorder among just each other), plus every not-yet-
 * ranked album by them below, each with a type-a-rank-and-Place control.
 * Lets one artist's whole catalog be placed in one sitting instead of
 * one-at-a-time through the normal candidate queue.
 *
 * This is the surviving half of what was `artistLockView.ts`: the lock/
 * enforcement half (freezing an artist's relative order as a drag
 * constraint) is paused (see `ranking/locks.ts`'s header comment) and is
 * NOT reintroduced here. There is no locked/arranged state in this view --
 * every ranked/unranked row is always editable.
 */
export function mountArtistBatchView(
  container: HTMLElement,
  opts: ArtistBatchViewOptions
): ArtistBatchViewController {
  const artistMbid = opts.album.primary_artist_mbid;
  const artistName = opts.album.primary_artist_name;
  let ranklistController: ReturnType<typeof mountRankList> | null = null;
  let discovering = false;
  let discoverMessage: string | null = null;

  function buildUnrankedRow(album: Album): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'lock-unranked-row';

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const title = document.createElement('p');
    title.className = 'rank-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = subtitle(album);
    meta.append(title, sub);

    // Same 0-10, two-decimal direct-rating control as the main candidate
    // card's "Or rate it directly" -- rate it and it lands wherever that
    // rating sorts it, no need to know its exact position among 490+ albums.
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
    btn.textContent = 'Rate';
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      if (raw === '') return;
      const rating = Number(raw);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) return;
      opts.onRate(album, Math.round(rating * 100) / 100);
    });
    form.append(input, btn);

    li.append(meta, form);
    return li;
  }

  function render(): void {
    container.textContent = '';
    ranklistController?.teardown();
    ranklistController = null;

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
    heading.textContent = `${artistName}'s albums`;
    header.append(backBtn, heading);
    wrap.append(header);

    if (!artistMbid) {
      const warning = document.createElement('p');
      warning.className = 'rank-status';
      warning.textContent = `Refresh Album Case to view ${artistName}'s albums.`;
      wrap.append(warning);
      container.append(wrap);
      return;
    }

    const actions = document.createElement('div');
    actions.className = 'lock-view-actions';

    const discoverBtn = document.createElement('button');
    discoverBtn.type = 'button';
    discoverBtn.className = 'lock-view-discover';
    discoverBtn.textContent = discovering ? 'Finding albums...' : 'Find more albums';
    discoverBtn.disabled = discovering;
    discoverBtn.addEventListener('click', () => {
      void discoverAlbums();
    });
    actions.append(discoverBtn);
    wrap.append(actions);

    if (discovering || discoverMessage) {
      const status = document.createElement('p');
      status.className = 'rank-status';
      status.textContent = discovering
        ? `Finding more ${artistName} albums...`
        : (discoverMessage as string);
      wrap.append(status);
    }

    const rankedCol = document.createElement('div');
    rankedCol.className = 'lock-ranked-col';
    ranklistController = mountRankList(rankedCol, {
      getRanked: () => artistAlbumsFor(artistMbid, opts.getRanked(), opts.getLists(), opts.getPool()).ranked,
      getGlobalRanked: () => opts.getRanked(),
      getCandidate: () => null,
      hideCandidateColumn: true,
      emptyRankedMessage: `None of ${artistName}'s albums are ranked yet.`,
      onPlace: () => {},
      onReorder: (from, to) => {
        const mapped = mapFilteredReorderToGlobal(opts.getRanked(), artistMbid, from, to);
        if (mapped) opts.onReorder(mapped.from, mapped.to);
      },
      onSetOverallRank: (from, to) => {
        opts.onSetOverallRank?.(from, to);
      },
      onSetRating: (from, rating) => {
        opts.onSetRating?.(from, rating);
      },
      onRemoveRanked: opts.onRemoveRanked,
      onSetAside: () => {},
      onSkip: () => {},
      onBlockArtist: () => {},
    });
    wrap.append(rankedCol);

    const unranked = artistAlbumsFor(artistMbid, opts.getRanked(), opts.getLists(), opts.getPool()).unranked;
    if (unranked.length > 0) {
      const unrankedHeading = document.createElement('p');
      unrankedHeading.className = 'lock-unranked-heading';
      unrankedHeading.textContent = 'Not yet ranked:';
      wrap.append(unrankedHeading);

      const unrankedList = document.createElement('ol');
      unrankedList.className = 'lock-unranked-list';
      unranked.forEach((album) => unrankedList.append(buildUnrankedRow(album)));
      wrap.append(unrankedList);
    }

    container.append(wrap);
  }

  function teardown(): void {
    ranklistController?.teardown();
    ranklistController = null;
  }

  async function discoverAlbums(): Promise<void> {
    if (!artistMbid || discovering) return;
    discovering = true;
    discoverMessage = null;
    render();
    const result = await opts.onDiscover();
    discovering = false;
    if (result.status === 'found') {
      discoverMessage =
        result.count > 0
          ? `Found ${result.count} more ${artistName} album${result.count === 1 ? '' : 's'}.`
          : `No new ${artistName} albums found.`;
    } else if (result.status === 'locked') {
      discoverMessage = 'Unlock writes to discover more albums.';
    } else if (result.status === 'empty') {
      discoverMessage = `No more ${artistName} albums found.`;
    } else {
      discoverMessage = `Could not discover more ${artistName} albums.`;
    }
    render();
  }

  render();
  void discoverAlbums();

  return { render, teardown };
}
