import type { Album } from '../ranking/types';
import type { ListName } from '../lists';

/**
 * Drag-to-place ranked list. Pointer-events based (works with touch AND
 * mouse; the HTML5 drag-and-drop API is unreliable on touch). The ranked
 * list is text-only (rank number + title + artist + year); a single next
 * candidate is shown as a draggable element the player drops into the list at
 * the position they want. Existing rows are draggable (via a grip handle) to
 * reorder. Safe DOM construction throughout (createElement/textContent).
 */

export type RankListOptions = {
  getRanked: () => Album[];
  getCandidate: () => Album | null;
  /** Insert the current candidate at `index`. */
  onPlace: (index: number) => void;
  /** Move the ranked row at `from` to `to` (post-removal index). */
  onReorder: (from: number, to: number) => void;
  /** Set the candidate aside into a saved list. */
  onSetAside: (album: Album, which: ListName) => void;
};

export type RankListController = {
  render: () => void;
  teardown: () => void;
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

export function mountRankList(container: HTMLElement, opts: RankListOptions): RankListController {
  const listEl = document.createElement('ol');
  listEl.className = 'rank-list';

  const indicator = document.createElement('li');
  indicator.className = 'rank-indicator';
  indicator.setAttribute('aria-hidden', 'true');

  let drag: DragState | null = null;
  let scrollRaf = 0;
  let scrollDir = 0;

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

  function computeDropIndex(clientY: number): number {
    const rows = rowElements();
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return rows.length;
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
      dropIndex: computeDropIndex(ev.clientY),
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

  function buildRow(album: Album, index: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rank-row';

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
    sub.textContent = subtitle(album);
    meta.append(title, sub);

    // A dedicated grip so the row body still flick-scrolls on touch; only the
    // grip disables native scrolling (touch-action:none via .rank-grip).
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'rank-grip';
    grip.setAttribute('aria-label', `Reorder ${album.title}`);
    grip.textContent = '⇅';
    grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));

    li.append(num, meta, grip);
    return li;
  }

  function buildCandidate(album: Album): HTMLElement {
    const card = document.createElement('div');
    card.className = 'candidate';

    const label = document.createElement('p');
    label.className = 'candidate-label';
    label.textContent = 'Next album: drag into your list';

    // The draggable body (title + artist/year). touch-action:none via CSS.
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

    const actions = document.createElement('div');
    actions.className = 'candidate-actions';
    const notHeard = document.createElement('button');
    notHeard.type = 'button';
    notHeard.className = 'candidate-action';
    notHeard.textContent = "Haven't heard";
    notHeard.addEventListener('click', () => opts.onSetAside(album, 'notHeard'));
    const want = document.createElement('button');
    want.type = 'button';
    want.className = 'candidate-action';
    want.textContent = 'Want to listen';
    want.addEventListener('click', () => opts.onSetAside(album, 'wantToListen'));
    actions.append(notHeard, want);

    card.append(label, body, actions);
    return card;
  }

  function render(): void {
    container.textContent = '';
    indicator.remove();

    const layout = document.createElement('div');
    layout.className = 'rank-layout';

    const listCol = document.createElement('div');
    listCol.className = 'rank-list-col';

    // Rebuild rows in place.
    listEl.textContent = '';
    const ranked = opts.getRanked();
    if (ranked.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'rank-empty';
      empty.textContent = 'Your ranked list is empty. Drag the next album in, or tap it to start.';
      listEl.append(empty);
    } else {
      ranked.forEach((album, i) => listEl.append(buildRow(album, i)));
    }
    listCol.append(listEl);

    const candidateCol = document.createElement('div');
    candidateCol.className = 'candidate-col';
    const candidate = opts.getCandidate();
    if (candidate) {
      candidateCol.append(buildCandidate(candidate));
    } else {
      const done = document.createElement('p');
      done.className = 'candidate-done';
      done.textContent = 'You have placed every album in the pool.';
      candidateCol.append(done);
    }

    layout.append(candidateCol, listCol);
    container.append(layout);
  }

  function teardown(): void {
    detachDragListeners();
    stopAutoscroll();
    if (drag) {
      drag.ghost.remove();
      drag = null;
    }
    indicator.remove();
  }

  render();
  return { render, teardown };
}
