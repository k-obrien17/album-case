import type { Album } from '../ranking/types';
import {
  RecordingUnavailableError,
  SidecarUnavailableError,
  startRecording,
} from '../audio/recordRatingClip';
import { decideSpeedRoundStep } from '../rating/decideSpeedRoundStep';

export type SpeedRoundOptions = {
  getCandidate: () => Album | null;
  /** Rate a candidate directly (0-10, two decimal places) -- same contract
   *  as the main candidate card's "Or rate it directly" control. The caller
   *  is expected to advance to the next candidate and remount/re-render this
   *  view afterward (see rankList.ts's onDirectRate / artistBatchView.ts's
   *  onRate for the established convention this mirrors). */
  onRate: (album: Album, rating: number) => void;
  onClose: () => void;
};

export type SpeedRoundController = {
  render: () => void;
  teardown: () => void;
};

function subtitle(album: Album): string {
  const year = album.release_year != null ? String(album.release_year) : '';
  return year ? `${album.primary_artist_name} · ${year}` : album.primary_artist_name;
}

/**
 * Hands-free voice rating loop: the mic auto-arms the instant a candidate is
 * shown, hard-stops via startRecording()'s own MAX_RECORD_MS ceiling, and a
 * clean rating auto-submits and advances with no click. Ported from the
 * portable pattern at ~/.claude/references/voice-speed-round-pattern.md
 * (obsidian-interface's "Enrich Speed Round"), with one deliberate deviation:
 * that pattern treats silence as a valid "nothing to add" outcome and
 * auto-advances past it. Here every candidate needs a rating to leave the
 * queue, so silence and unparseable speech both pause on a manual fallback
 * (decideSpeedRoundStep.ts) instead of silently skipping the album.
 *
 * One mount = one candidate. The caller (main.ts) fully tears down and
 * remounts this view after each rating, the same convention artistBatchView
 * uses for its onRate/onReorder callbacks -- so there is no in-place
 * candidate-change tracking here, only an `active` flag (point 9 of the
 * source pattern) guarding the async recording result against a teardown
 * that happens mid-recording (e.g. clicking away to another nav tab).
 */
export function mountSpeedRound(
  container: HTMLElement,
  opts: SpeedRoundOptions
): SpeedRoundController {
  let active = true;
  let stopActive: (() => void) | null = null;

  type Phase =
    | { kind: 'listening' }
    | { kind: 'needs-manual'; heardText: string }
    | { kind: 'error'; message: string };
  let phase: Phase = { kind: 'listening' };

  function armMic(album: Album): void {
    const { stop, result } = startRecording();
    stopActive = stop;
    result
      .then((text) => {
        if (!active) return; // torn down (view left) while recording/transcribing
        stopActive = null;
        const step = decideSpeedRoundStep(text);
        if (step.kind === 'auto-rate') {
          opts.onRate(album, step.rating); // caller advances + remounts
          return;
        }
        phase = { kind: 'needs-manual', heardText: step.heardText };
        render();
      })
      .catch((e: unknown) => {
        if (!active) return;
        stopActive = null;
        const message =
          e instanceof RecordingUnavailableError || e instanceof SidecarUnavailableError
            ? e.message
            : 'voice rating failed';
        phase = { kind: 'error', message };
        render();
      });
  }

  function startListening(album: Album): void {
    phase = { kind: 'listening' };
    render();
    armMic(album);
  }

  /** Shown when voice rating didn't produce a usable number: a silent
   *  recording, unintelligible speech, or a real mic/sidecar failure all
   *  land here. Same manual-entry contract as buildDirectRate's fallback
   *  input (rankList.ts), plus a button to re-arm the mic for another try. */
  function buildFallback(album: Album): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'speed-round-actions';

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

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'candidate-place-button';
    submitBtn.textContent = 'Rate';
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      if (raw === '') return;
      const rating = Number(raw);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) return;
      opts.onRate(album, Math.round(rating * 100) / 100); // caller advances + remounts
    });

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'candidate-place-button candidate-mic-button';
    retryBtn.textContent = 'Try voice again';
    retryBtn.addEventListener('click', () => startListening(album));

    form.append(input, submitBtn, retryBtn);
    wrap.append(form);
    return wrap;
  }

  function render(): void {
    container.textContent = '';
    const album = opts.getCandidate();

    const wrap = document.createElement('div');
    wrap.className = 'speed-round';

    const header = document.createElement('div');
    header.className = 'lock-view-header';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lock-view-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => opts.onClose());
    const heading = document.createElement('h2');
    heading.className = 'lock-view-title';
    heading.textContent = 'Voice speed round';
    header.append(backBtn, heading);
    wrap.append(header);

    if (!album) {
      const done = document.createElement('p');
      done.className = 'candidate-done';
      done.textContent = 'You have placed every album in the pool.';
      wrap.append(done);
      container.append(wrap);
      return;
    }

    const card = document.createElement('div');
    card.className = 'candidate speed-round-card';

    const title = document.createElement('p');
    title.className = 'candidate-title';
    title.textContent = album.title;
    const sub = document.createElement('p');
    sub.className = 'candidate-sub';
    sub.textContent = subtitle(album);
    card.append(title, sub);

    const status = document.createElement('p');
    status.className = 'speed-round-status';

    if (phase.kind === 'listening') {
      status.classList.add('speed-round-status--listening');
      status.textContent = 'Listening…';
      card.append(status);
    } else if (phase.kind === 'needs-manual') {
      status.classList.add('speed-round-status--unclear');
      status.textContent = phase.heardText
        ? `Heard "${phase.heardText}" -- couldn't parse a rating.`
        : 'Nothing heard.';
      card.append(status, buildFallback(album));
    } else {
      status.classList.add('speed-round-status--error');
      status.textContent = phase.message;
      card.append(status, buildFallback(album));
    }

    wrap.append(card);
    container.append(wrap);
  }

  function teardown(): void {
    active = false;
    stopActive?.();
    stopActive = null;
  }

  render();
  const initialCandidate = opts.getCandidate();
  if (initialCandidate) armMic(initialCandidate);

  return { render, teardown };
}
