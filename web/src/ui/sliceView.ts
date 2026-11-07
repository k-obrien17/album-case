import type { Album, RankedAlbum } from '../ranking/types';
import { mountRankList } from './rankList';

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

    container.append(wrap);
  }

  function teardown(): void {
    listController?.teardown();
    listController = null;
  }

  render();
  return { render, teardown };
}
