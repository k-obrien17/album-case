/**
 * Captures one short spoken utterance via the browser's built-in speech
 * recognition (SpeechRecognition / webkitSpeechRecognition) and resolves
 * with the raw transcript text. Runs entirely client-side against the
 * browser's own recognition service -- no local sidecar, no server proxy,
 * works the same on the deployed site as it does locally.
 *
 * webkitSpeechRecognition is a vendor prefix TypeScript never knows about,
 * and this project's DOM lib (target es2023) doesn't have the unprefixed
 * SpeechRecognition constructor either (confirmed against this repo's own
 * tsconfig.json before writing this), so the constructor is looked up
 * defensively at runtime through a small hand-rolled interface rather than
 * typed against the ambient globals.
 *
 * Pure glue with no DOM-independent logic to extract, manual-verified only
 * -- same convention this file's predecessor (recordRatingClip.ts) used,
 * and the one obsidian-interface's mic.js follows (see
 * ~/.claude/references/voice-speed-round-pattern.md).
 */

const MAX_RECORD_MS = 8_000;

export class RecordingUnavailableError extends Error {}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function describeSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Mic permission denied.';
    case 'audio-capture':
      return 'No microphone found.';
    case 'network':
      return 'Speech recognition needs an internet connection.';
    default:
      return `Voice rating failed (${code}).`;
  }
}

/** Starts listening immediately. Call the returned `stop()` to end early
 *  (e.g. a button click) and resolve with whatever was heard so far; the
 *  recognizer also hard-stops on its own after MAX_RECORD_MS. */
export function startRecording(): { stop: () => void; result: Promise<string> } {
  let recognition: SpeechRecognitionLike | null = null;
  let settled = false;

  const result = new Promise<string>((resolve, reject) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      reject(
        new RecordingUnavailableError(
          'Voice rating needs a browser with speech recognition support (Chrome, Edge, or Safari).'
        )
      );
      return;
    }

    try {
      recognition = new Ctor();
    } catch (e) {
      reject(
        new RecordingUnavailableError(
          'Recording unavailable: ' + (e instanceof Error ? e.message : 'unsupported')
        )
      );
      return;
    }

    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };

    recognition.onresult = (event) => {
      finish(() => resolve(event.results[0]?.[0]?.transcript ?? ''));
    };
    recognition.onerror = (event) => {
      finish(() => {
        // Silence is a valid outcome, not an error -- same treatment as an
        // empty recording resolving to '' rather than rejecting.
        if (event.error === 'no-speech' || event.error === 'aborted') {
          resolve('');
        } else {
          reject(new RecordingUnavailableError(describeSpeechError(event.error)));
        }
      });
    };
    recognition.onend = () => {
      finish(() => resolve(''));
    };

    try {
      recognition.start();
    } catch (e) {
      finish(() =>
        reject(
          new RecordingUnavailableError(
            'Recording unavailable: ' + (e instanceof Error ? e.message : 'unsupported')
          )
        )
      );
      return;
    }

    timer = setTimeout(() => {
      if (!settled) recognition?.stop();
    }, MAX_RECORD_MS);
  });

  return {
    stop: () => {
      if (!settled) recognition?.stop();
    },
    result,
  };
}
