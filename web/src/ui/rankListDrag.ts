import type { Album, RankedAlbum } from '../ranking/types';
import { subtitle } from './rankListSearch';

const EDGE = 72; // px from the viewport edge that triggers autoscroll
const SCROLL_STEP = 14; // px per animation frame while autoscrolling
const TAP_SLOP = 6; // px of movement below which a pointerdown counts as a tap

export type DragSource = { type: 'candidate' } | { type: 'row'; index: number };

export type DragState = {
  source: DragSource;
  album: Album;
  ghost: HTMLElement;
  pointerId: number;
  dropIndex: number;
  lastClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

export type RankListDragDeps = {
  listEl: HTMLOListElement;
  indicator: HTMLLIElement;
  getRanked: () => RankedAlbum[];
  /** For a row reorder starting at `from`, snap a proposed `to` to the
   *  nearest index that keeps every active lock intact. Omit when this
   *  instance's index space can never cross a lock. Same contract as
   *  RankListOptions.getNearestValidDrop. */
  getNearestValidDrop?: (from: number, to: number) => number;
  /** Insert the current candidate at `index`. */
  onPlace: (index: number) => void;
  /** Move the ranked row at `from` to `to` (post-removal index). */
  onReorder: (from: number, to: number) => void;
  /** Re-render the list, used to clear drag visuals after a no-op tap or
   *  no-op reorder (nothing actually moved). This is `mountRankList`'s
   *  hoisted `render` function declaration -- safe to reference here even
   *  though it's textually defined later in that file, the same
   *  forward-reference pattern already used for `showStatus` in
   *  createSearchSection. */
  render: () => void;
};

export type RankListDragController = {
  startDrag: (source: DragSource, album: Album, ev: PointerEvent) => void;
  teardown: () => void;
};

/**
 * Pointer-events-based drag-to-place/reorder mechanics, extracted out of
 * rankList.ts's mountRankList closure. Every function here, and the `drag`
 * state itself, is used only within this cluster plus two external call
 * sites (`startDrag`, wired to the candidate card and row grip pointerdown
 * handlers) -- no rendering/row-building logic reads drag state.
 */
export function createDragController(deps: RankListDragDeps): RankListDragController {
  let drag: DragState | null = null;
  let scrollRaf = 0;
  let scrollDir = 0;

  function positionGhost(x: number, y: number): void {
    if (!drag) return;
    drag.ghost.style.left = `${x}px`;
    drag.ghost.style.top = `${y}px`;
  }

  function rowElements(): HTMLElement[] {
    return Array.from(deps.listEl.querySelectorAll<HTMLElement>('.rank-row'));
  }

  function showIndicatorAt(index: number): void {
    const rows = rowElements();
    deps.indicator.remove();
    if (index >= rows.length) deps.listEl.append(deps.indicator);
    else deps.listEl.insertBefore(deps.indicator, rows[index]);
  }

  function computeDropIndex(
    clientY: number,
    source: DragSource | undefined = drag?.source
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
    if (!source || source.type !== 'row' || !deps.getNearestValidDrop) return raw;
    return deps.getNearestValidDrop(source.index, raw);
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
    deps.indicator.remove();
    drag = null;

    if (finished.source.type === 'candidate') {
      if (finished.moved) {
        deps.onPlace(finished.dropIndex);
        return;
      }
      // Tap-to-place fallback (only when unambiguous): empty list -> #1,
      // single item -> append below it. Otherwise a tap requires a drag.
      const len = deps.getRanked().length;
      if (len === 0) deps.onPlace(0);
      else if (len === 1) deps.onPlace(1);
      else deps.render();
      return;
    }

    // Row reorder.
    const from = finished.source.index;
    if (!finished.moved) {
      deps.render();
      return;
    }
    // dropIndex was computed with the dragged row still present; convert to a
    // post-removal target index.
    const to = finished.dropIndex > from ? finished.dropIndex - 1 : finished.dropIndex;
    if (to === from) deps.render();
    else deps.onReorder(from, to);
  }

  function startDrag(source: DragSource, album: Album, ev: PointerEvent): void {
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

  function teardown(): void {
    detachDragListeners();
    stopAutoscroll();
    if (drag) {
      drag.ghost.remove();
      drag = null;
    }
    deps.indicator.remove();
  }

  return { startDrag, teardown };
}
