import type { Album, RankedAlbum } from '../ranking/types';
import { computeSubRanks, type SubRank } from '../ranking/subRank';
import type { ListName } from '../lists';
import {
  startAssist,
  assistOpponent,
  assistResolved,
  assistPick,
  assistIndex,
  type AssistPlacement,
} from '../ranking/assist';

/**
 * Drag-to-place ranked list. Pointer-events based (works with touch AND
 * mouse; the HTML5 drag-and-drop API is unreliable on touch). The ranked
 * list is text-only (rank number + title + artist + year); a single next
 * candidate is shown as a draggable element the player drops into the list at
 * the position they want. Existing rows are draggable (via a grip handle) to
 * reorder. Safe DOM construction throughout (createElement/textContent).
 */

export type RankListOptions = {
  getRanked: () => RankedAlbum[];
  /** The full global ranked array, for computing correct year-rank and
   *  overall-rank when this instance renders a filtered subset (e.g. the
   *  artist-lock scoped view). Omit when `getRanked` already returns the
   *  full global list -- the main ranked-list view does. */
  getGlobalRanked?: () => RankedAlbum[];
  getCandidate: () => Album | null;
  /** Insert the current candidate at `index`. */
  onPlace: (index: number) => void;
  /** Move the ranked row at `from` to `to` (post-removal index). */
  onReorder: (from: number, to: number) => void;
  /** Remove a ranked album from the list and keep it out of future candidates. */
  onRemoveRanked?: (album: Album) => void;
  /** Move the album currently at global index `from` to post-removal global
   *  index `to`. Unlike `onReorder`, both indices are always in the full
   *  global ranked array's space, never a filtered subset's -- this powers
   *  the tap-to-edit "Overall" rank control, never drag. The caller is
   *  responsible for any lock-safety clamping before acting on this; this
   *  component does not clamp it (this instance's own `getNearestValidDrop`,
   *  when present, is scoped to a different, incompatible purpose). Omit to
   *  render the "Overall" figure as plain non-interactive text. */
  onSetOverallRank?: (from: number, to: number) => void;
  /** Rate the current candidate directly (0-10) instead of dragging or
   *  comparing it into place. An additional entry path, not a replacement --
   *  drag-to-place and assisted this-or-that keep working regardless. Omit
   *  to hide the direct-entry input entirely. */
  onDirectRate?: (rating: number) => void;
  /** Set the rating of the ranked album currently at global index `from`
   *  directly (0-10), re-sorting it to wherever that rating lands it. Same
   *  global-index contract as `onSetOverallRank`. Omit to render the row's
   *  rating as plain non-interactive text. */
  onSetRating?: (from: number, rating: number) => void;
  /** Set the candidate aside into a saved list. */
  onSetAside: (album: Album, which: ListName) => void;
  /** Defer the candidate for this session without saving it anywhere. */
  onSkip: (album: Album) => void;
  /** Hide this artist's remaining albums from future candidate selection. */
  onBlockArtist: (album: Album) => void;
  /** Record a single assisted this-or-that answer as a pairwise atom. */
  onCompare?: (winnerMbid: string, loserMbid: string) => void;
  /** Discover and queue the rest of this album's artist's other LPs. */
  onDiscoverArtist?: (album: Album) => void;
  /** Open the artist-lock scoped view for this row's artist. Omit to hide
   *  the lock icon entirely (used by the scoped view's own inner list, which
   *  has no lock-within-a-lock flow). */
  onOpenArtistLock?: (album: Album) => void;
  /** Artist mbids with an active lock, for the lock icon's visual state. */
  getLockedArtistMbids?: () => string[];
  /** For a row reorder starting at `from`, snap a proposed `to` to the
   *  nearest index that keeps every active lock intact. Omit when this
   *  instance's index space can never cross a lock (e.g. an artist-filtered
   *  sub-list, where a within-artist reorder can never violate any lock). */
  getNearestValidDrop?: (from: number, to: number) => number;
  /** Suppress the next-candidate column entirely (no card, no "done"
   *  message). Used by the artist-scoped sub-view, which has no candidate
   *  flow of its own -- unranked albums get their own list instead. */
  hideCandidateColumn?: boolean;
  /** Override the empty-ranked-list message. */
  emptyRankedMessage?: string;
};

/**
 * At/above this ranked-list length, assisted this-or-that placement is the
 * default (a few log2(n) taps instead of dragging across a long list). Below
 * it, manual drag/tap is fine. Drag + row grips stay available in both modes.
 */
const ASSIST_THRESHOLD = 8;

export type RankListController = {
  render: () => void;
  teardown: () => void;
  showStatus: (message: string) => void;
};

const EDGE = 72; // px from the viewport edge that triggers autoscroll
const SCROLL_STEP = 14; // px per animation frame while autoscrolling
const TAP_SLOP = 6; // px of movement below which a pointerdown counts as a tap

type DragState = {
  source: { type: 'candidate' } | { type: 'row'; index: number };
  album: Album;
  ghost: HTMLElement;
  pointerId: number;
  dropIndex: number;
  lastClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}

function rankedSubtitle(album: Album, subRank: SubRank | undefined): string {
  const base = subtitle(album);
  if (!subRank) return base;

  const parts = [`Band ${subRank.artistRank}/${subRank.artistTotal}`];
  if (subRank.yearRank != null && subRank.yearTotal != null) {
    parts.push(`Year ${subRank.yearRank}/${subRank.yearTotal}`);
  }
  return `${base} · ${parts.join(' · ')}`;
}

export function mountRankList(container: HTMLElement, opts: RankListOptions): RankListController {
  const listEl = document.createElement('ol');
  listEl.className = 'rank-list';

  const indicator = document.createElement('li');
  indicator.className = 'rank-indicator';
  indicator.setAttribute('aria-hidden', 'true');

  let drag: DragState | null = null;
  let scrollRaf = 0;
  let scrollDir = 0;
  let statusMessage: string | null = null;
  // Active assisted this-or-that placement (long lists only). Reset whenever
  // the candidate changes or the list drops below the assist threshold.
  let assist: AssistPlacement | null = null;
  // mbid of the row whose "Overall" rank is being typed, if any. Only one
  // row can be in edit mode at a time.
  let editingOverallMbid: string | null = null;
  // mbid of the row whose rating is being typed, if any. Independent of
  // editingOverallMbid -- the two controls edit the same underlying value
  // via different inputs, but only one control (of either kind) should
  // realistically be open at once; nothing here enforces that beyond the
  // fact that opening one re-renders and doesn't touch the other's state.
  let editingRatingMbid: string | null = null;

  function positionGhost(x: number, y: number): void {
    if (!drag) return;
    drag.ghost.style.left = `${x}px`;
    drag.ghost.style.top = `${y}px`;
  }

  function rowElements(): HTMLElement[] {
    return Array.from(listEl.querySelectorAll<HTMLElement>('.rank-row'));
  }

  function showIndicatorAt(index: number): void {
    const rows = rowElements();
    indicator.remove();
    if (index >= rows.length) listEl.append(indicator);
    else listEl.insertBefore(indicator, rows[index]);
  }

  function computeDropIndex(
    clientY: number,
    source: DragState['source'] | undefined = drag?.source
  ): number {
    const rows = rowElements();
    let raw = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        raw = i;
        break;
      }
    }
    if (!source || source.type !== 'row' || !opts.getNearestValidDrop) return raw;
    return opts.getNearestValidDrop(source.index, raw);
  }

  function updateIndicator(clientY: number): void {
    if (!drag) return;
    drag.dropIndex = computeDropIndex(clientY);
    showIndicatorAt(drag.dropIndex);
  }

  function stopAutoscroll(): void {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
    scrollDir = 0;
  }

  function autoscrollFrame(): void {
    if (!drag || scrollDir === 0) {
      stopAutoscroll();
      return;
    }
    window.scrollBy(0, scrollDir * SCROLL_STEP);
    updateIndicator(drag.lastClientY); // list scrolled under the pointer
    scrollRaf = requestAnimationFrame(autoscrollFrame);
  }

  function maybeAutoscroll(clientY: number): void {
    let dir = 0;
    if (clientY < EDGE) dir = -1;
    else if (clientY > window.innerHeight - EDGE) dir = 1;

    if (dir === scrollDir) return; // already scrolling that way (or stopped)
    scrollDir = dir;
    if (dir === 0) {
      stopAutoscroll();
    } else if (!scrollRaf) {
      scrollRaf = requestAnimationFrame(autoscrollFrame);
    }
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    ev.preventDefault();
    if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) > TAP_SLOP) {
      drag.moved = true;
    }
    drag.lastClientY = ev.clientY;
    positionGhost(ev.clientX, ev.clientY);
    updateIndicator(ev.clientY);
    maybeAutoscroll(ev.clientY);
  }

  function detachDragListeners(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const finished = drag;
    detachDragListeners();
    stopAutoscroll();
    finished.ghost.remove();
    indicator.remove();
    drag = null;

    if (finished.source.type === 'candidate') {
      if (finished.moved) {
        opts.onPlace(finished.dropIndex);
        return;
      }
      // Tap-to-place fallback (only when unambiguous): empty list -> #1,
      // single item -> append below it. Otherwise a tap requires a drag.
      const len = opts.getRanked().length;
      if (len === 0) opts.onPlace(0);
      else if (len === 1) opts.onPlace(1);
      else render();
      return;
    }

    // Row reorder.
    const from = finished.source.index;
    if (!finished.moved) {
      render();
      return;
    }
    // dropIndex was computed with the dragged row still present; convert to a
    // post-removal target index.
    const to = finished.dropIndex > from ? finished.dropIndex - 1 : finished.dropIndex;
    if (to === from) render();
    else opts.onReorder(from, to);
  }

  function startDrag(source: DragState['source'], album: Album, ev: PointerEvent): void {
    if (drag) return;
    ev.preventDefault();

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const gTitle = document.createElement('span');
    gTitle.className = 'drag-ghost-title';
    gTitle.textContent = album.title;
    const gSub = document.createElement('span');
    gSub.className = 'drag-ghost-sub';
    gSub.textContent = subtitle(album);
    ghost.append(gTitle, gSub);
    document.body.append(ghost);

    drag = {
      source,
      album,
      ghost,
      pointerId: ev.pointerId,
      dropIndex: computeDropIndex(ev.clientY, source),
      lastClientY: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
    };
    positionGhost(ev.clientX, ev.clientY);
    showIndicatorAt(drag.dropIndex);

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function buildRow(
    album: RankedAlbum,
    index: number,
    subRanks: Map<string, SubRank>,
    lockedArtists: Set<string>
  ): HTMLLIElement {
    const isArranged = lockedArtists.has(album.primary_artist_mbid ?? '');
    const li = document.createElement('li');
    li.className = isArranged ? 'rank-row rank-row-arranged' : 'rank-row';

    const num = document.createElement('span');
    num.className = 'rank-num';
    num.textContent = String(index + 1);

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    const title = document.createElement('p');
    title.className = 'rank-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'rank-sub';
    sub.textContent = rankedSubtitle(album, subRanks.get(album.mbid));
    meta.append(title, sub);

    if (isArranged) {
      const arranged = document.createElement('span');
      arranged.className = 'rank-arranged';
      arranged.textContent = 'Arranged';
      meta.append(arranged);
    }

    const ratingEl = buildRatingControl(album);

    const overallControl = buildOverallControl(album, subRanks.get(album.mbid));
    if (overallControl) {
      const overallRow = document.createElement('div');
      overallRow.className = 'rank-overall-row';
      overallRow.append(overallControl, ratingEl);
      meta.append(overallRow);
    } else {
      meta.append(ratingEl);
    }

    li.append(num, meta);

    if (opts.onDiscoverArtist) {
      const discoverBtn = document.createElement('button');
      discoverBtn.type = 'button';
      discoverBtn.className = 'rank-discover';
      discoverBtn.setAttribute('aria-label', `Rank the rest of ${album.primary_artist_name}'s albums`);
      discoverBtn.textContent = '▶';
      discoverBtn.addEventListener('click', () => opts.onDiscoverArtist?.(album));
      li.append(discoverBtn);
    }

    if (opts.onOpenArtistLock) {
      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = isArranged ? 'rank-lock rank-lock-active' : 'rank-lock';
      lockBtn.setAttribute(
        'aria-label',
        isArranged
          ? `${album.primary_artist_name}'s order is locked`
          : `Lock ${album.primary_artist_name}'s order`
      );
      lockBtn.textContent = '⚷';
      lockBtn.addEventListener('click', () => opts.onOpenArtistLock?.(album));
      li.append(lockBtn);
    }

    if (opts.onRemoveRanked) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'rank-remove';
      removeBtn.setAttribute('aria-label', `Remove ${album.title} from ranked list`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => opts.onRemoveRanked?.(album));
      li.append(removeBtn);
    }

    // A dedicated grip so the row body still flick-scrolls on touch; only the
    // grip disables native scrolling (touch-action:none via .rank-grip).
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'rank-grip';
    grip.setAttribute('aria-label', `Reorder ${album.title}`);
    grip.textContent = '⇅';
    grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));
    li.append(grip);

    return li;
  }

  function buildOverallControl(album: Album, subRank: SubRank | undefined): HTMLElement | null {
    if (!subRank) return null;

    if (editingOverallMbid === album.mbid) {
      const form = document.createElement('form');
      form.className = 'candidate-place rank-overall-edit';
      form.noValidate = true;
      let submittingOverall = false;

      const input = document.createElement('input');
      input.className = 'candidate-place-input';
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(subRank.overallTotal);
      input.value = String(subRank.overallRank);
      input.setAttribute('aria-label', `Overall rank for ${album.title}`);

      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'candidate-place-button';
      btn.textContent = 'Set';
      btn.addEventListener('pointerdown', () => {
        submittingOverall = true;
      });

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        submittingOverall = false;
        const rank = Number(input.value);
        if (!Number.isInteger(rank) || rank < 1 || rank > subRank.overallTotal) {
          showStatus(`Enter 1-${subRank.overallTotal}.`);
          return;
        }
        editingOverallMbid = null;
        const globalRanked = opts.getGlobalRanked?.() ?? opts.getRanked();
        const from = globalRanked.findIndex((a) => a.mbid === album.mbid);
        if (from === -1) return;
        opts.onSetOverallRank?.(from, rank - 1);
      });

      // Cancel on blur, unless focus just moved from the input to this same
      // form's own submit button (a deferred check lets that focus change
      // land first).
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!form.isConnected) return;
          if (
            editingOverallMbid === album.mbid &&
            !submittingOverall &&
            !form.contains(document.activeElement)
          ) {
            editingOverallMbid = null;
            render();
          }
        }, 100);
      });

      form.append(input, btn);
      return form;
    }

    if (!opts.onSetOverallRank) {
      const span = document.createElement('span');
      span.className = 'rank-overall';
      span.textContent = `Overall ${subRank.overallRank}/${subRank.overallTotal}`;
      return span;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rank-overall';
    btn.textContent = `Overall ${subRank.overallRank}/${subRank.overallTotal}`;
    btn.setAttribute('aria-label', `Edit overall rank for ${album.title}`);
    btn.addEventListener('click', () => {
      editingOverallMbid = album.mbid;
      render();
      const input = container.querySelector<HTMLInputElement>('.rank-overall-edit .candidate-place-input');
      input?.focus();
      input?.select();
    });
    return btn;
  }

  /** The row's rating, tappable to edit directly (0-10). Mirrors
   *  buildOverallControl's tap-to-edit pattern exactly: static text ->
   *  numeric input -> validate -> callback -> revert to text. */
  function buildRatingControl(album: RankedAlbum): HTMLElement {
    if (editingRatingMbid === album.mbid) {
      const form = document.createElement('form');
      form.className = 'candidate-place rank-rating-edit';
      form.noValidate = true;
      let submittingRating = false;

      const input = document.createElement('input');
      input.className = 'candidate-place-input';
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = '0';
      input.max = '10';
      input.step = '0.01';
      input.value = album.rating.toFixed(2);
      input.setAttribute('aria-label', `Rating for ${album.title}`);

      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'candidate-place-button';
      btn.textContent = 'Set';
      btn.addEventListener('pointerdown', () => {
        submittingRating = true;
      });

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        submittingRating = false;
        const raw = input.value.trim();
        if (raw === '') {
          showStatus('Enter 0-10.');
          return;
        }
        const rating = Number(raw);
        if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
          showStatus('Enter 0-10.');
          return;
        }
        editingRatingMbid = null;
        const globalRanked = opts.getGlobalRanked?.() ?? opts.getRanked();
        const from = globalRanked.findIndex((a) => a.mbid === album.mbid);
        if (from === -1) return;
        opts.onSetRating?.(from, Math.round(rating * 100) / 100);
      });

      // Cancel on blur, unless focus just moved from the input to this same
      // form's own submit button (a deferred check lets that focus change
      // land first).
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!form.isConnected) return;
          if (
            editingRatingMbid === album.mbid &&
            !submittingRating &&
            !form.contains(document.activeElement)
          ) {
            editingRatingMbid = null;
            render();
          }
        }, 100);
      });

      form.append(input, btn);
      return form;
    }

    if (!opts.onSetRating) {
      const span = document.createElement('span');
      span.className = 'rank-rating';
      span.textContent = album.rating.toFixed(2);
      return span;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rank-rating';
    btn.textContent = album.rating.toFixed(2);
    btn.setAttribute('aria-label', `Edit rating for ${album.title}`);
    btn.addEventListener('click', () => {
      editingRatingMbid = album.mbid;
      render();
      const input = container.querySelector<HTMLInputElement>('.rank-rating-edit .candidate-place-input');
      input?.focus();
      input?.select();
    });
    return btn;
  }

  function actionButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate-action';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildNumberPlace(): HTMLElement {
    const maxRank = opts.getRanked().length + 1;
    const form = document.createElement('form');
    form.className = 'candidate-place';

    const input = document.createElement('input');
    input.className = 'candidate-place-input';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = String(maxRank);
    input.placeholder = '#';
    input.setAttribute('aria-label', 'Rank position');

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'candidate-place-button';
    btn.textContent = 'Place';

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const rank = Number(input.value);
      if (!Number.isInteger(rank) || rank < 1) {
        showStatus(`Enter 1-${maxRank}.`);
        return;
      }
      opts.onPlace(Math.min(rank, maxRank) - 1);
    });

    form.append(input, btn);
    return form;
  }

  /** "Or rate it directly:" -- types a rating (0-10) instead of dragging or
   *  comparing. Returns null when `onDirectRate` is omitted (hides the
   *  control entirely), matching the optional-prop pattern used elsewhere
   *  in this file (e.g. onSetOverallRank, onDiscoverArtist). */
  function buildDirectRate(album: Album): HTMLElement | null {
    if (!opts.onDirectRate) return null;

    const wrap = document.createElement('div');
    wrap.className = 'candidate-direct-rate';

    const label = document.createElement('p');
    label.className = 'candidate-direct-rate-label';
    label.textContent = 'Or rate it directly:';

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
    input.setAttribute('aria-label', `Direct rating for ${album.title}`);

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'candidate-place-button';
    btn.textContent = 'Rate';

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      if (raw === '') {
        showStatus('Enter 0-10.');
        return;
      }
      const rating = Number(raw);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        showStatus('Enter 0-10.');
        return;
      }
      opts.onDirectRate?.(Math.round(rating * 100) / 100);
    });

    form.append(input, btn);
    wrap.append(label, form);
    return wrap;
  }

  /** The set-aside + skip row, shared by the drag card and the assisted card. */
  function buildActions(album: Album): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'candidate-actions';
    actions.append(
      actionButton("Haven't heard", () => opts.onSetAside(album, 'notHeard')),
      actionButton('Want to listen', () => opts.onSetAside(album, 'wantToListen')),
      actionButton("Don't care to rank", () => opts.onSetAside(album, 'dontCare')),
      actionButton(`No more ${album.primary_artist_name}`, () => opts.onBlockArtist(album)),
      actionButton('Skip for now', () => opts.onSkip(album))
    );
    return actions;
  }

  /** A draggable candidate body (title + artist/year). touch-action:none via CSS. */
  function buildDragBody(album: Album): HTMLElement {
    const body = document.createElement('div');
    body.className = 'candidate-drag';
    const title = document.createElement('p');
    title.className = 'candidate-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'candidate-sub';
    sub.textContent = subtitle(album);
    body.append(title, sub);
    body.addEventListener('pointerdown', (ev) => startDrag({ type: 'candidate' }, album, ev));
    return body;
  }

  function buildCandidate(album: Album): HTMLElement {
    const card = document.createElement('div');
    card.className = 'candidate';

    const label = document.createElement('p');
    label.className = 'candidate-label';
    label.textContent = 'Next album: drag into your list';

    const directRate = buildDirectRate(album);
    card.append(
      label,
      buildDragBody(album),
      buildNumberPlace(),
      ...(directRate ? [directRate] : []),
      buildActions(album)
    );
    return card;
  }

  function answerAssist(winnerMbid: string): void {
    if (!assist) return;
    const opponent = assistOpponent(assist);
    if (opponent) {
      const loserMbid = winnerMbid === assist.album.mbid ? opponent.mbid : assist.album.mbid;
      opts.onCompare?.(winnerMbid, loserMbid);
    }
    assist = assistPick(assist, winnerMbid);
    if (assistResolved(assist)) {
      const index = assistIndex(assist);
      assist = null;
      opts.onPlace(index); // fires neighbor atoms, reselects, re-renders
    } else {
      render();
    }
  }

  /** Assisted this-or-that card: candidate vs the current search-window album. */
  function buildAssisted(album: Album): HTMLElement {
    const card = document.createElement('div');
    card.className = 'candidate';

    const label = document.createElement('p');
    label.className = 'candidate-label';
    label.textContent = 'Which do you prefer?';

    const opponent = assist ? assistOpponent(assist) : null;
    if (!opponent) {
      // Resolved with nothing to compare (e.g. empty list): place at the end.
      const index = assist ? assistIndex(assist) : opts.getRanked().length;
      assist = null;
      opts.onPlace(index);
      return card;
    }

    const choose = document.createElement('div');
    choose.className = 'assist-choose';

    const preferCandidate = document.createElement('button');
    preferCandidate.type = 'button';
    preferCandidate.className = 'assist-choice';
    preferCandidate.textContent = album.title;
    preferCandidate.addEventListener('click', () => answerAssist(album.mbid));

    const preferOpponent = document.createElement('button');
    preferOpponent.type = 'button';
    preferOpponent.className = 'assist-choice';
    preferOpponent.textContent = opponent.title;
    preferOpponent.addEventListener('click', () => answerAssist(opponent.mbid));

    choose.append(preferCandidate, preferOpponent);

    const hint = document.createElement('p');
    hint.className = 'assist-hint';
    hint.textContent = 'or drag to place';

    const directRate = buildDirectRate(album);
    card.append(
      label,
      choose,
      buildDragBody(album),
      hint,
      buildNumberPlace(),
      ...(directRate ? [directRate] : []),
      buildActions(album)
    );
    return card;
  }

  function render(): void {
    container.textContent = '';
    indicator.remove();

    const layout = document.createElement('div');
    layout.className = 'rank-layout';

    if (statusMessage) {
      const status = document.createElement('p');
      status.className = 'rank-status';
      status.textContent = statusMessage;
      layout.append(status);
      statusMessage = null;
    }

    const listCol = document.createElement('div');
    listCol.className = 'rank-list-col';

    // Rebuild rows in place.
    listEl.textContent = '';
    const ranked = opts.getRanked();
    if (ranked.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'rank-empty';
      empty.textContent =
        opts.emptyRankedMessage ??
        'Your ranked list is empty. Drag the next album in, or tap it to start.';
      listEl.append(empty);
    } else {
      const subRanks = computeSubRanks(opts.getGlobalRanked?.() ?? ranked);
      const lockedArtists = new Set(opts.getLockedArtistMbids?.() ?? []);
      ranked.forEach((album, i) => listEl.append(buildRow(album, i, subRanks, lockedArtists)));
    }
    listCol.append(listEl);

    const candidateCol = document.createElement('div');
    candidateCol.className = 'candidate-col';
    if (!opts.hideCandidateColumn) {
      const candidate = opts.getCandidate();
      if (candidate) {
        // Long list -> assisted this-or-that by default; short list -> drag/tap.
        if (ranked.length >= ASSIST_THRESHOLD) {
          if (!assist || assist.album.mbid !== candidate.mbid) {
            assist = startAssist(ranked, candidate);
          }
          candidateCol.append(buildAssisted(candidate));
        } else {
          assist = null;
          candidateCol.append(buildCandidate(candidate));
        }
      } else {
        assist = null;
        const done = document.createElement('p');
        done.className = 'candidate-done';
        done.textContent = 'You have placed every album in the pool.';
        candidateCol.append(done);
      }
    }

    layout.append(...(opts.hideCandidateColumn ? [listCol] : [candidateCol, listCol]));
    container.append(layout);
  }

  function teardown(): void {
    detachDragListeners();
    stopAutoscroll();
    if (drag) {
      drag.ghost.remove();
      drag = null;
    }
    assist = null;
    indicator.remove();
  }

  function showStatus(message: string): void {
    statusMessage = message;
    render();
  }

  render();
  return { render, teardown, showStatus };
}
