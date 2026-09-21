import type { Album, RankedAlbum } from '../ranking/types';
import { computeSubRanks, type SubRank } from '../ranking/subRank';
import type { ListName } from '../lists';
import type { ArtistResult } from '../artistSearch';
import {
  startAssist,
  assistOpponent,
  assistResolved,
  assistPick,
  assistIndex,
  type AssistPlacement,
} from '../ranking/assist';
import { RecordingUnavailableError, startRecording } from '../audio/speechToRating';
import { parseSpokenRating } from '../rating/parseSpokenRating';
import { createSearchSection, subtitle, type SearchResultsState } from './rankListSearch';
import { createDragController } from './rankListDrag';

/**
 * Drag-to-place ranked list. Pointer-events based (works with touch AND
 * mouse; the HTML5 drag-and-drop API is unreliable on touch). The ranked
 * list is text-only (rank number + title + artist + year); a single next
 * candidate is shown as a draggable element the player drops into the list at
 * the position they want. Existing rows are draggable (via a grip handle) to
 * reorder. Safe DOM construction throughout (createElement/textContent).
 */

export type { SearchResultsState };

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
  /** Open the artist-batch view (all of this row's artist's albums, ranked
   *  and unranked, in one stacked screen) for this candidate's artist. Omit
   *  to hide the button entirely (used by the batch view's own inner list,
   *  which has no batch-within-a-batch flow). */
  onOpenArtistBatch?: (album: Album) => void;
  /** Total known albums (ranked + unranked) by this candidate's artist, for
   *  deciding whether the "View all N <Artist> albums" button is worth
   *  showing. Only consulted when `onOpenArtistBatch` is also present. */
  getArtistAlbumCount?: (album: Album) => number;
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
  /** The live search query. When non-empty, this instance is rendering a
   *  FILTERED subset: row grips and the candidate card are suppressed, because
   *  a drop index computed against a partial list would produce a wrong rating.
   *  The rating and overall-rank editors remain available -- both resolve a
   *  filtered row back to its global index by mbid, so they are index-safe.
   *  Omit to disable search entirely. */
  getSearchQuery?: () => string;
  /** Fired on every keystroke of the search input. */
  onSearchQueryChange?: (query: string) => void;
  /** Fired when the user taps "Search MusicBrainz" -- from the no-local-
   *  matches empty state, or from the "search for more" prompt shown below
   *  local matches (so an artist with one album already ranked can still be
   *  searched for their others). Omit to hide the MusicBrainz fallback
   *  entirely (plain "no matches" text only, and no prompt below matches). */
  onSearchMusicBrainz?: (query: string) => void;
  /** The current MusicBrainz result state for the empty state to render.
   *  Omit (or return 'idle') to show only the initial "Search MusicBrainz"
   *  prompt. */
  getSearchResults?: () => SearchResultsState;
  /** Add a MusicBrainz search result to the ranked list at a typed 0-10
   *  rating. No comparison happened, so unlike onPlace this never fires a
   *  pairwise atom -- same precedent as onDirectRate. */
  onRateSearchResult?: (album: Album, rating: number) => void;
  /** Tapped "See albums" on a band hit from the merged MusicBrainz search --
   *  album hits rate directly via onRateSearchResult above; band hits go
   *  through this instead. The caller owns the discovery fetch and any
   *  resulting view navigation. Omit to hide band-hit rows entirely. */
  onSelectArtist?: (artist: ArtistResult) => void;
  /** mbid of the band-hit row currently fetching its albums, for the
   *  "Loading…" button state. Omit (or return null) when nothing is in
   *  flight. */
  getSelectingArtistMbid?: () => string | null;
  /** A one-shot message to show below the results after a band-hit
   *  selection resolves (e.g. "No albums found for X."). Omit (or return
   *  null) to show nothing. */
  getArtistSelectMessage?: () => string | null;
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

/**
 * Whether the active assist run must restart: a different candidate, or the
 * ranked list mutated underneath it (another row edited/reordered/removed
 * while a comparison was in flight). `assist.state.ranked` stays
 * reference-equal to the array `startAssist` captured until the run
 * resolves (insertion.ts never touches `ranked` mid-placement), so any real
 * mutation produces a new array -- comparing references catches it. Without
 * this check, a stale assist keeps comparing against a frozen snapshot and
 * its binary-search indices silently misplace the candidate into the
 * CURRENT list once resolved.
 */
export function assistNeedsRestart(
  assist: AssistPlacement | null,
  candidate: Album,
  ranked: RankedAlbum[]
): boolean {
  return !assist || assist.album.mbid !== candidate.mbid || assist.state.ranked !== ranked;
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

  let statusMessage: string | null = null;
  // Active assisted this-or-that placement (long lists only). Reset whenever
  // the candidate changes or the list drops below the assist threshold.
  let assist: AssistPlacement | null = null;
  // Comparisons answered / estimated total for the current `assist` run, for
  // the "Step N of ~M" progress line. `assistTotal` is the binary-search
  // upper bound (ceil(log2(n+1))) computed once when the run starts against
  // the window size at that point; it stays fixed even as `lo`/`hi` narrow.
  let assistStep = 0;
  let assistTotal = 0;
  // mbid of the row whose "Overall" rank is being typed, if any. Only one
  // row can be in edit mode at a time.
  let editingOverallMbid: string | null = null;
  // mbid of the row whose rating is being typed, if any. Independent of
  // editingOverallMbid -- the two controls edit the same underlying value
  // via different inputs, but only one control (of either kind) should
  // realistically be open at once; nothing here enforces that beyond the
  // fact that opening one re-renders and doesn't touch the other's state.
  let editingRatingMbid: string | null = null;
  // Handle to stop the in-flight mic recording (buildDirectRate's "Or rate
  // it directly" mic button), if any, callable from teardown(). Previously
  // this lived only in a local variable scoped to buildDirectRate's own
  // closure, so an unrelated re-render (e.g. editing a different row's
  // rating triggers render()) discarded the only reference able to stop it
  // -- the underlying SpeechRecognition kept listening until its own
  // MAX_RECORD_MS timer expired. Lifted to this mount-level closure and
  // mirrors speedRound.ts's `stopActive`. At most one candidate card (and
  // thus one mic button) is ever rendered at a time, so a single handle
  // suffices.
  let activeMicStop: (() => void) | null = null;

  // showStatus is a hoisted function declaration (defined further down in
  // this closure) -- referencing it here just stores the callback, it isn't
  // invoked until a search-result rating fails validation, well after
  // mountRankList has finished running.
  const { buildSearchBox, buildSearchEmptyState, buildSearchMoreRow } = createSearchSection({
    getRanked: opts.getRanked,
    getGlobalRanked: opts.getGlobalRanked,
    getSearchQuery: opts.getSearchQuery,
    onSearchQueryChange: opts.onSearchQueryChange,
    onSearchMusicBrainz: opts.onSearchMusicBrainz,
    getSearchResults: opts.getSearchResults,
    onRateSearchResult: opts.onRateSearchResult,
    onSelectArtist: opts.onSelectArtist,
    getSelectingArtistMbid: opts.getSelectingArtistMbid,
    getArtistSelectMessage: opts.getArtistSelectMessage,
    showStatus,
  });

  // render is a hoisted function declaration (defined further down in this
  // closure) -- referencing it here is safe the same way showStatus is
  // above; see rankListDrag.ts's RankListDragDeps.render doc comment.
  const { startDrag, teardown: teardownDrag } = createDragController({
    listEl,
    indicator,
    getRanked: opts.getRanked,
    getNearestValidDrop: opts.getNearestValidDrop,
    onPlace: opts.onPlace,
    onReorder: opts.onReorder,
    render,
  });

  function buildRow(
    album: RankedAlbum,
    index: number,
    subRanks: Map<string, SubRank>,
    lockedArtists: Set<string>,
    filtered: boolean
  ): HTMLLIElement {
    const isArranged = lockedArtists.has(album.primary_artist_mbid ?? '');
    const li = document.createElement('li');
    li.className = isArranged ? 'rank-row rank-row-arranged' : 'rank-row';

    const num = document.createElement('span');
    num.className = 'rank-num';
    // While filtered (searching), `index` is only this row's position in the
    // FILTERED array -- rendering that as the big rank number would show a
    // globally #201 album as "1". Prefer the true global overall rank
    // whenever it's known (subRanks is always computed from the global list;
    // see render()'s `computeSubRanks(opts.getGlobalRanked?.() ?? ranked)`),
    // falling back to the filtered index only when no subRank is available.
    num.textContent = String(subRanks.get(album.mbid)?.overallRank ?? index + 1);

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
      // A single tap here used to remove-and-blacklist immediately with no
      // way back short of hunting through the "Don't care" tab. Require
      // confirmation so a mis-tap can't silently exile an album.
      removeBtn.addEventListener('click', () => {
        if (!window.confirm(`Remove "${album.title}" from your ranked list?`)) return;
        opts.onRemoveRanked?.(album);
        showStatus(`Removed "${album.title}". Find it under Don't care to rate it back in.`);
      });
      li.append(removeBtn);
    }

    if (!filtered) {
      // A dedicated grip so the row body still flick-scrolls on touch; only the
      // grip disables native scrolling (touch-action:none via .rank-grip).
      // Suppressed while filtered: a drop index computed against a partial
      // list would produce a wrong rating.
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'rank-grip';
      grip.setAttribute('aria-label', `Reorder ${album.title}`);
      grip.textContent = '⇅';
      grip.addEventListener('pointerdown', (ev) => startDrag({ type: 'row', index }, album, ev));
      li.append(grip);
    }

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
      // Close the sibling editor. Opening one re-renders synchronously, which
      // destroys the other's form before its deferred blur-cancel can fire --
      // so that cancel bails on `!form.isConnected` and never clears its state,
      // leaving both editors stuck open on the same row.
      editingRatingMbid = null;
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
      // See the note in the overall-rank control: close the sibling editor, or
      // both end up stuck open on the same row.
      editingOverallMbid = null;
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

    // Voice rating via the browser's built-in speech recognition (see
    // speechToRating.ts). Fills the input rather than auto-submitting: a
    // misheard number silently landing in the canonical Turso rating is a
    // worse failure than one extra tap to confirm. Same pattern as
    // artistBatchView.ts's per-row mic button.
    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'candidate-place-button candidate-mic-button';
    micBtn.textContent = 'Mic';
    micBtn.setAttribute('aria-label', `Speak a rating for ${album.title}`);
    micBtn.addEventListener('click', () => {
      if (activeMicStop) {
        activeMicStop();
        return;
      }
      const { stop, result } = startRecording();
      activeMicStop = stop;
      micBtn.textContent = 'Stop';
      micBtn.classList.add('candidate-mic-active');
      result
        .then((text) => {
          if (!document.contains(input)) return; // card was rebuilt mid-recording
          const rating = parseSpokenRating(text);
          if (rating === null) {
            input.placeholder = text ? `heard "${text}"` : 'nothing heard';
            return;
          }
          input.value = String(rating);
          input.focus();
          input.select();
        })
        .catch((e: unknown) => {
          if (!document.contains(input)) return;
          const message = e instanceof RecordingUnavailableError ? e.message : 'voice rating failed';
          input.placeholder = message;
        })
        .finally(() => {
          activeMicStop = null;
          micBtn.textContent = 'Mic';
          micBtn.classList.remove('candidate-mic-active');
        });
    });

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

    form.append(input, micBtn, btn);
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
    if (opts.onOpenArtistBatch && opts.getArtistAlbumCount) {
      const count = opts.getArtistAlbumCount(album);
      if (count >= 2) {
        actions.append(
          actionButton(`View all ${count} ${album.primary_artist_name} albums`, () =>
            opts.onOpenArtistBatch?.(album)
          )
        );
      }
    }
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
      assistStep += 1;
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

    const progress = document.createElement('p');
    progress.className = 'assist-progress';
    progress.textContent = `Step ${assistStep + 1} of ~${assistTotal}`;

    const hint = document.createElement('p');
    hint.className = 'assist-hint';
    hint.textContent = 'or drag to place';

    const directRate = buildDirectRate(album);
    card.append(
      label,
      progress,
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
    // Capture focus/caret state BEFORE clearing the container. render()
    // rebuilds the DOM from scratch, so the search input is destroyed and
    // recreated on every call (onSearchQueryChange triggers a re-render on
    // every keystroke). Naively tracking focus via the input's
    // own focus/blur listeners doesn't work: removing a focused element from
    // the DOM (the `container.textContent = ''` below) fires a synchronous
    // blur first, which would clear that state before it's ever read. Reading
    // `document.activeElement` here, before anything is torn down, sidesteps
    // that ordering problem entirely.
    const prevSearchInput = container.querySelector<HTMLInputElement>('.rank-search-input');
    const searchWasFocused = !!prevSearchInput && document.activeElement === prevSearchInput;
    const searchCaret = searchWasFocused ? prevSearchInput!.selectionStart : null;

    container.textContent = '';
    indicator.remove();

    // Non-empty (trimmed) query -> this instance is rendering a FILTERED
    // subset. Row grips and the candidate card are suppressed: a drop index
    // computed against a partial list would produce a wrong rating. The
    // rating/overall-rank editors stay available -- both resolve a filtered
    // row back to its global index by mbid.
    const query = opts.getSearchQuery?.() ?? '';
    const filtered = query.trim() !== '';

    const layout = document.createElement('div');
    layout.className = 'rank-layout';

    if (statusMessage) {
      const status = document.createElement('p');
      status.className = 'rank-status';
      status.textContent = statusMessage;
      layout.append(status);
      statusMessage = null;
    }

    const searchBox = buildSearchBox();
    if (searchBox) layout.append(searchBox);

    const listCol = document.createElement('div');
    listCol.className = 'rank-list-col';

    // Rebuild rows in place.
    listEl.textContent = '';
    const ranked = opts.getRanked();
    if (ranked.length === 0) {
      if (filtered) {
        listEl.append(buildSearchEmptyState(query.trim()));
      } else {
        const empty = document.createElement('li');
        empty.className = 'rank-empty';
        empty.textContent =
          opts.emptyRankedMessage ??
          'Your ranked list is empty. Drag the next album in, or tap it to start.';
        listEl.append(empty);
      }
    } else {
      const subRanks = computeSubRanks(opts.getGlobalRanked?.() ?? ranked);
      const lockedArtists = new Set(opts.getLockedArtistMbids?.() ?? []);
      ranked.forEach((album, i) =>
        listEl.append(buildRow(album, i, subRanks, lockedArtists, filtered))
      );
      if (filtered) {
        const moreRow = buildSearchMoreRow(query.trim());
        if (moreRow) listEl.append(moreRow);
      }
    }
    listCol.append(listEl);

    const candidateCol = document.createElement('div');
    candidateCol.className = 'candidate-col';
    if (!opts.hideCandidateColumn && !filtered) {
      const candidate = opts.getCandidate();
      if (candidate) {
        // Long list -> assisted this-or-that by default; short list -> drag/tap.
        if (ranked.length >= ASSIST_THRESHOLD) {
          if (assistNeedsRestart(assist, candidate, ranked)) {
            assist = startAssist(ranked, candidate);
            assistStep = 0;
            assistTotal = Math.max(1, Math.ceil(Math.log2(ranked.length + 1)));
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

    layout.append(
      ...(opts.hideCandidateColumn || filtered ? [listCol] : [candidateCol, listCol])
    );
    container.append(layout);

    // Restore focus + caret to the search input, which render() just
    // recreated from scratch. Without this, a keystroke-triggered re-render
    // (onSearchQueryChange triggers one) drops focus after a single
    // character and the box becomes unusable.
    if (searchWasFocused) {
      const input = container.querySelector<HTMLInputElement>('.rank-search-input');
      if (input) {
        input.focus();
        if (searchCaret != null) input.setSelectionRange(searchCaret, searchCaret);
      }
    }
  }

  function teardown(): void {
    teardownDrag();
    assist = null;
    assistStep = 0;
    assistTotal = 0;
    activeMicStop?.();
    activeMicStop = null;
  }

  function showStatus(message: string): void {
    statusMessage = message;
    render();
  }

  render();
  return { render, teardown, showStatus };
}
