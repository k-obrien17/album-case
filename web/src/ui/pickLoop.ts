import type { Album, Comparison, RankingState } from '../ranking/types';
import { applyPick, nextComparison } from '../ranking/insertion';
import { setAsideAlbum } from '../ranking/setAside';
import { saveRanking } from '../storage';
import type { ListName } from '../lists';

/** Given the current state, seed the next unranked candidate(s) until a real
 * comparison exists (or the pool is exhausted). Owned by main.ts, which
 * holds the cold-start bootstrap while loop; pickLoop calls back into it
 * whenever a placement finalizes mid-loop. */
export type BootstrapFn = (state: RankingState) => {
  state: RankingState;
  comparison: Comparison | null;
};

export type PickLoopController = {
  render(): void;
  /** Detach the keyboard listener without clearing `container`'s content.
   * Call this before another view (e.g. the ranked list) takes over
   * `container`, so a stray "1"/ArrowLeft keypress can't fire a phantom
   * pick while the pick loop isn't visible. */
  teardown(): void;
};

const KEY_TO_SIDE: Record<string, 'left' | 'right'> = {
  '1': 'left',
  ArrowLeft: 'left',
  '2': 'right',
  ArrowRight: 'right',
};

/** The two albums as they are physically shown, left then right. Decoupled
 * from the semantic candidate/opponent role so the pinned candidate isn't
 * glued to one side during a placement. */
type DisplayOrder = { left: Album; right: Album };

/** Randomly assign the comparison's candidate/opponent to left/right. Called
 * once per comparison instance (not per render) so a re-render can't flip the
 * sides mid-decision. Exported for unit testing. */
export function assignSides(comparison: Comparison): DisplayOrder {
  return Math.random() < 0.5
    ? { left: comparison.candidate, right: comparison.opponent }
    : { left: comparison.opponent, right: comparison.candidate };
}

/**
 * Mount the two-album pick loop into `container`. Clicking a card, or
 * pressing 1 / ArrowLeft (left card) or 2 / ArrowRight (right card), records
 * the pick via `applyPick`, persists the resulting state via `saveRanking`,
 * then asks `nextComparison` for the immediate next pair. If the placement
 * just finalized (nextComparison is null but the pool isn't exhausted), the
 * cold-start `bootstrap` chain seeds the next candidate so the player is
 * never shown a blank screen mid-loop.
 */
export function mountPickLoop(
  container: HTMLElement,
  initialState: RankingState,
  initialComparison: Comparison | null,
  bootstrap: BootstrapFn,
  onStateChange: (state: RankingState) => void,
  recordSetAside: (album: Album, which: ListName) => void
): PickLoopController {
  let state = initialState;
  let comparison = initialComparison;
  // Displayed side assignment, computed ONCE per comparison instance (see
  // assignSides) so a re-render never flips the sides mid-decision.
  let sides: DisplayOrder | null = comparison ? assignSides(comparison) : null;
  let activeKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  /** Advance to the next comparison after a state mutation, re-bootstrapping
   * (which re-reads the CURRENT exclusion set) when the current placement
   * finalized or was cancelled. Shared by pick and set-aside. */
  function advance(): void {
    let next = nextComparison(state);
    if (!next) {
      const bootstrapped = bootstrap(state);
      state = bootstrapped.state;
      next = bootstrapped.comparison;
    }
    comparison = next;
    // New comparison instance -> reassign displayed sides once, here.
    sides = comparison ? assignSides(comparison) : null;

    onStateChange(state);
    render();
  }

  function handlePick(winnerMbid: string): void {
    state = applyPick(state, winnerMbid);
    saveRanking(state);
    advance();
  }

  function handleSetAside(album: Album, which: ListName): void {
    // Record to the saved list FIRST so the album is excluded before the
    // re-bootstrap runs (bootstrap reads the current exclusion set), then
    // drop it from the ranking state (setAsideAlbum also cancels any
    // in-progress placement, which is what keeps lo/hi from dangling).
    recordSetAside(album, which);
    state = setAsideAlbum(state, album.mbid);
    saveRanking(state);
    advance();
  }

  function buildCard(album: Album, onSelect: () => void): HTMLDivElement {
    // A <div> container, not a <button>: the secondary action buttons cannot
    // be nested inside a button (invalid HTML). The cover/title/artist live
    // in their own pick button.
    const card = document.createElement('div');
    card.className = 'pick-card';

    const pickButton = document.createElement('button');
    pickButton.type = 'button';
    pickButton.className = 'pick-select';
    pickButton.addEventListener('click', onSelect);

    const coverWrap = document.createElement('div');
    coverWrap.className = 'pick-cover-wrap';

    // A neutral placeholder box (the wrap's background) shows immediately;
    // the cover streams in behind it without blocking the pick.
    const img = new Image();
    img.className = 'pick-cover';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `${album.title} by ${album.primary_artist_name}`;
    img.src = album.cover_url;
    coverWrap.append(img);

    const title = document.createElement('p');
    title.className = 'pick-title';
    title.textContent = album.title;

    const artist = document.createElement('p');
    artist.className = 'pick-artist';
    artist.textContent = album.primary_artist_name;

    pickButton.append(coverWrap, title, artist);

    const actions = document.createElement('div');
    actions.className = 'pick-actions';

    const notHeardBtn = document.createElement('button');
    notHeardBtn.type = 'button';
    notHeardBtn.className = 'pick-action';
    notHeardBtn.textContent = "Haven't heard";
    notHeardBtn.addEventListener('click', () => handleSetAside(album, 'notHeard'));

    const wantBtn = document.createElement('button');
    wantBtn.type = 'button';
    wantBtn.className = 'pick-action';
    wantBtn.textContent = 'Want to listen';
    wantBtn.addEventListener('click', () => handleSetAside(album, 'wantToListen'));

    actions.append(notHeardBtn, wantBtn);
    card.append(pickButton, actions);
    return card;
  }

  function render(): void {
    container.textContent = '';

    if (activeKeyHandler) {
      window.removeEventListener('keydown', activeKeyHandler);
      activeKeyHandler = null;
    }

    if (!comparison || !sides) {
      const done = document.createElement('p');
      done.className = 'pick-complete';
      done.textContent = 'You have ranked every album in the seed pool.';
      container.append(done);
      return;
    }

    const displayed = sides;

    // Placement context: name the album currently being placed so the
    // repeated candidate reads as purposeful progress, not a stuck loop.
    const caption = document.createElement('p');
    caption.className = 'pick-caption';
    caption.textContent = `Where does ${comparison.candidate.title} rank?`;
    container.append(caption);

    const row = document.createElement('div');
    row.className = 'pick-row';

    const leftCard = buildCard(displayed.left, () => handlePick(displayed.left.mbid));
    const rightCard = buildCard(displayed.right, () => handlePick(displayed.right.mbid));

    row.append(leftCard, rightCard);
    container.append(row);

    activeKeyHandler = (event: KeyboardEvent) => {
      const side = KEY_TO_SIDE[event.key];
      if (!side) return;
      const winner = side === 'left' ? displayed.left : displayed.right;
      handlePick(winner.mbid);
    };
    window.addEventListener('keydown', activeKeyHandler);
  }

  function teardown(): void {
    if (activeKeyHandler) {
      window.removeEventListener('keydown', activeKeyHandler);
      activeKeyHandler = null;
    }
  }

  render();
  return { render, teardown };
}
