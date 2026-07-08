import type { Album, ArtistLock } from '../ranking/types';
import type { SavedLists } from '../lists';
import { artistAlbumsFor, mapFilteredReorderToGlobal } from '../artistLockAlbums';
import { buildLock } from '../ranking/locks';
import { mountRankList } from './rankList';

export type ArtistLockViewOptions = {
  album: Album;
  getRanked: () => Album[];
  getLists: () => SavedLists;
  getPool: () => Album[];
  getArtistLocks: () => ArtistLock[];
  onReorder: (from: number, to: number) => void;
  /** Move the album at global index `from` to post-removal global index
   *  `to`. Always global-space, regardless of this view's filtered
   *  rendering -- distinct from `onReorder`, which exists for the
   *  within-artist drag path and its filtered-to-global index translation. */
  onSetOverallRank?: (from: number, to: number) => void;
  onPlace: (album: Album, globalIndex: number) => void;
  onLock: (lock: ArtistLock) => void;
  onUnlock: (artistMbid: string) => void;
  onDiscover: () => Promise<void>;
  onClose: () => void;
};

export type ArtistLockViewController = {
  render: () => void;
  teardown: () => void;
};

function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}

export function mountArtistLockView(
  container: HTMLElement,
  opts: ArtistLockViewOptions
): ArtistLockViewController {
  const artistMbid = opts.album.primary_artist_mbid;
  const artistName = opts.album.primary_artist_name;
  let ranklistController: ReturnType<typeof mountRankList> | null = null;
  let loading = true;

  function isLocked(): boolean {
    return !!artistMbid && opts.getArtistLocks().some((lock) => lock.artistMbid === artistMbid);
  }

  function buildUnrankedRow(album: Album, maxRank: number, locked: boolean): HTMLLIElement {
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

    const form = document.createElement('form');
    form.className = 'candidate-place';
    const input = document.createElement('input');
    input.className = 'candidate-place-input';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = String(maxRank);
    input.placeholder = '#';
    input.setAttribute('aria-label', `Rank position for ${album.title}`);
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'candidate-place-button';
    btn.textContent = 'Place';
    if (locked) {
      input.disabled = true;
      btn.disabled = true;
    }
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const rank = Number(input.value);
      if (!Number.isInteger(rank) || rank < 1) return;
      opts.onPlace(album, Math.min(rank, maxRank) - 1);
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
    heading.textContent = `${artistName}'s order`;
    header.append(backBtn, heading);
    wrap.append(header);

    if (!artistMbid) {
      const warning = document.createElement('p');
      warning.className = 'rank-status';
      warning.textContent = 'Refresh Album Case to lock this artist\'s order.';
      wrap.append(warning);
      container.append(wrap);
      return;
    }

    const locked = isLocked();

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'lock-view-toggle';
    if (isLocked()) {
      lockBtn.textContent = 'Unlock';
      lockBtn.addEventListener('click', () => opts.onUnlock(artistMbid));
    } else {
      lockBtn.textContent = 'Lock in order';
      lockBtn.addEventListener('click', () => opts.onLock(buildLock(artistMbid, opts.getRanked())));
    }
    wrap.append(lockBtn);

    if (locked) {
      const lockedNote = document.createElement('p');
      lockedNote.className = 'rank-status';
      lockedNote.textContent = 'Locked. Unlock to reorder or add albums.';
      wrap.append(lockedNote);
    }

    if (loading) {
      const status = document.createElement('p');
      status.className = 'rank-status';
      status.textContent = `Finding the rest of ${artistName}'s albums...`;
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
      onSetAside: () => {},
      onSkip: () => {},
      onBlockArtist: () => {},
      getNearestValidDrop: locked ? (from: number) => from : undefined,
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
      const maxRank = opts.getRanked().length + 1;
      unranked.forEach((album) => unrankedList.append(buildUnrankedRow(album, maxRank, locked)));
      wrap.append(unrankedList);
    }

    container.append(wrap);
  }

  function teardown(): void {
    ranklistController?.teardown();
    ranklistController = null;
  }

  render();
  if (artistMbid) {
    void opts.onDiscover().finally(() => {
      loading = false;
      render();
    });
  } else {
    loading = false;
  }

  return { render, teardown };
}
