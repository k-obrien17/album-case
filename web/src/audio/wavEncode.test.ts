import { describe, expect, test } from 'vitest';
import { downmixToMono, encodeWavMono16 } from './wavEncode';

async function readWavHeader(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const magic = (offset: number, len: number) =>
    String.fromCharCode(...new Uint8Array(buf, offset, len));
  return {
    riff: magic(0, 4),
    wave: magic(8, 4),
    fmtId: magic(12, 4),
    audioFormat: view.getUint16(20, true),
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataId: magic(36, 4),
    dataSize: view.getUint32(40, true),
    totalSize: buf.byteLength,
    view,
  };
}

describe('encodeWavMono16', () => {
  test('writes a valid mono 16-bit PCM WAV header', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWavMono16(samples, 44100);
    const header = await readWavHeader(blob);

    expect(header.riff).toBe('RIFF');
    expect(header.wave).toBe('WAVE');
    expect(header.fmtId).toBe('fmt ');
    expect(header.audioFormat).toBe(1); // PCM
    expect(header.numChannels).toBe(1);
    expect(header.sampleRate).toBe(44100);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataId).toBe('data');
    expect(header.dataSize).toBe(samples.length * 2);
    expect(header.totalSize).toBe(44 + samples.length * 2);
  });

  test('declares whatever sample rate is given, no forced resampling', async () => {
    const blob = encodeWavMono16(new Float32Array([0]), 16000);
    const header = await readWavHeader(blob);
    expect(header.sampleRate).toBe(16000);
  });

  test('quantizes float samples to 16-bit PCM and clamps out-of-range values', async () => {
    const samples = new Float32Array([0, 1, -1, 2, -2]); // 2/-2 are out of [-1, 1]
    const blob = encodeWavMono16(samples, 16000);
    const header = await readWavHeader(blob);

    const readSample = (i: number) => header.view.getInt16(44 + i * 2, true);
    expect(readSample(0)).toBe(0);
    expect(readSample(1)).toBe(0x7fff);
    expect(readSample(2)).toBe(-0x8000);
    expect(readSample(3)).toBe(0x7fff); // clamped from 2
    expect(readSample(4)).toBe(-0x8000); // clamped from -2
  });
});

describe('downmixToMono', () => {
  function fakeAudioBuffer(channels: number[][]): AudioBuffer {
    return {
      numberOfChannels: channels.length,
      length: channels[0].length,
      getChannelData: (ch: number) => new Float32Array(channels[ch]),
    } as AudioBuffer;
  }

  test('returns the single channel unchanged for mono input', () => {
    const buf = fakeAudioBuffer([[0.1, 0.2, 0.3]]);
    // Compare against the same Float32Array round trip the source values
    // themselves went through, not the double-precision literals -- 0.1
    // etc. aren't exactly representable in float32, so a plain toEqual
    // against [0.1, 0.2, 0.3] fails on precision, not on real behavior.
    expect(Array.from(downmixToMono(buf))).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
  });

  test('averages channels for stereo input', () => {
    const buf = fakeAudioBuffer([
      [1, 0, -1],
      [0, 1, 1],
    ]);
    const mono = downmixToMono(buf);
    expect(mono[0]).toBeCloseTo(0.5);
    expect(mono[1]).toBeCloseTo(0.5);
    expect(mono[2]).toBeCloseTo(0);
  });
});
