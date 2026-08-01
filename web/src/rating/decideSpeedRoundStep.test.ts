import { describe, expect, test } from 'vitest';
import { decideSpeedRoundStep } from './decideSpeedRoundStep';

describe('decideSpeedRoundStep', () => {
  test('a clean digit rating auto-rates', () => {
    expect(decideSpeedRoundStep('8')).toEqual({ kind: 'auto-rate', rating: 8 });
  });

  test('a clean spoken-word rating auto-rates', () => {
    expect(decideSpeedRoundStep('seven and a half')).toEqual({
      kind: 'auto-rate',
      rating: 7.5,
    });
  });

  test('an empty transcript (silence) needs manual entry, not a skip', () => {
    expect(decideSpeedRoundStep('')).toEqual({ kind: 'needs-manual', heardText: '' });
  });

  test('whitespace-only transcript needs manual entry with trimmed empty text', () => {
    expect(decideSpeedRoundStep('   ')).toEqual({ kind: 'needs-manual', heardText: '' });
  });

  test('unparseable speech needs manual entry and preserves the heard text', () => {
    expect(decideSpeedRoundStep('this album is pretty good I guess')).toEqual({
      kind: 'needs-manual',
      heardText: 'this album is pretty good I guess',
    });
  });

  test('an out-of-range number needs manual entry', () => {
    expect(decideSpeedRoundStep('fifteen')).toEqual({
      kind: 'needs-manual',
      heardText: 'fifteen',
    });
  });
});
