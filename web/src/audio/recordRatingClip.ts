/**
 * Records one short clip from the mic, transcribes it via the local Mimir
 * STT sidecar (`mimir stt-server`, see ~/.claude/references/voice-speed-round-pattern.md),
 * and returns the raw transcript text. Local-dev-only by design: the
 * sidecar lives at 127.0.0.1 on the machine running `npm run dev`, so this
 * has no path to work against the deployed album-case.vercel.app -- there's
 * no server-side proxy here on purpose, the browser talks to the sidecar
 * directly since both are on the same machine during local dev.
 *
 * Pure decode/encode logic (wavEncode.ts) is unit-tested; this file is
 * MediaRecorder/getUserMedia glue with no DOM-independent logic to extract,
 * manual-verified only -- same convention obsidian-interface's mic.js uses.
 */

import { downmixToMono, encodeWavMono16 } from './wavEncode';

const PARAKEET_STT_URL = 'http://127.0.0.1:8765';
const MAX_RECORD_MS = 8_000;

export class RecordingUnavailableError extends Error {}
export class SidecarUnavailableError extends Error {}

/** Records until stopped (or MAX_RECORD_MS elapses), then transcribes.
 *  Call the returned `stop()` to end recording early (e.g. a button
 *  click); the promise resolves once transcription completes. */
export function startRecording(): { stop: () => void; result: Promise<string> } {
  let stopFn: () => void = () => {};

  const result = (async (): Promise<string> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      throw new RecordingUnavailableError(
        'Mic unavailable: ' + (e instanceof Error ? e.message : 'permission denied')
      );
    }

    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw new RecordingUnavailableError(
        'Recording unavailable: ' + (e instanceof Error ? e.message : 'unsupported')
      );
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      };
    });

    stopFn = () => {
      if (recorder.state === 'recording') recorder.stop();
    };
    recorder.start();
    const timer = setTimeout(stopFn, MAX_RECORD_MS);

    const recordedBlob = await stopped;
    clearTimeout(timer);

    if (!recordedBlob.size) return '';

    const audioContext = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      const arrayBuffer = await recordedBlob.arrayBuffer();
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } finally {
      audioContext.close();
    }
    const mono = downmixToMono(audioBuffer);
    const wavBlob = encodeWavMono16(mono, audioBuffer.sampleRate);

    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(`${PARAKEET_STT_URL}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBlob,
        signal: controller.signal,
      });
    } catch (e) {
      throw new SidecarUnavailableError(
        'mimir stt-server not reachable at ' +
          PARAKEET_STT_URL +
          ' (' +
          (e instanceof Error ? e.message : 'unknown') +
          ')'
      );
    } finally {
      clearTimeout(fetchTimer);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new SidecarUnavailableError(`stt-server HTTP ${res.status}: ${body}`);
    }
    const data: { text?: string } = await res.json();
    return (data.text || '').trim();
  })();

  return { stop: () => stopFn(), result };
}
