import { describe, expect, test } from 'vitest';
import { parseSpokenRating } from './parseSpokenRating';

describe('parseSpokenRating', () => {
  test('parses a bare digit', () => {
    expect(parseSpokenRating('8')).toBe(8);
  });

  test('parses a decimal digit', () => {
    expect(parseSpokenRating('7.35')).toBe(7.35);
  });

  test('parses a digit embedded in a sentence', () => {
    expect(parseSpokenRating('give it a 9')).toBe(9);
    expect(parseSpokenRating("I'd say an 8.5")).toBe(8.5);
  });

  test('parses spelled-out point-decimal form', () => {
    expect(parseSpokenRating('seven point three five')).toBe(7.35);
    expect(parseSpokenRating('seven point five')).toBe(7.5);
  });

  test('parses "and a half/quarter" fraction words', () => {
    expect(parseSpokenRating('seven and a half')).toBe(7.5);
    expect(parseSpokenRating('eight and a quarter')).toBe(8.25);
    expect(parseSpokenRating('six and three quarters')).toBe(6.75);
  });

  test('parses a plain whole-number word', () => {
    expect(parseSpokenRating('nine')).toBe(9);
    expect(parseSpokenRating('zero')).toBe(0);
    expect(parseSpokenRating('ten')).toBe(10);
  });

  test('last whole-number word wins when several appear', () => {
    expect(parseSpokenRating('maybe six, no actually nine')).toBe(9);
  });

  test('clamps out-of-range digit values to null rather than truncating', () => {
    expect(parseSpokenRating('15')).toBeNull();
    expect(parseSpokenRating('-3')).toBeNull();
  });

  test('returns null for empty or whitespace-only text', () => {
    expect(parseSpokenRating('')).toBeNull();
    expect(parseSpokenRating('   ')).toBeNull();
  });

  test('returns null when nothing recognizable is present', () => {
    expect(parseSpokenRating('skip this one')).toBeNull();
    expect(parseSpokenRating('umm not sure')).toBeNull();
  });

  test('bare "one" is never mistaken for a rating of 1 (collides with ordinary speech)', () => {
    expect(parseSpokenRating('rate this one now')).toBeNull();
    expect(parseSpokenRating('that one was great')).toBeNull();
  });

  test('"one" still works in more specific contexts', () => {
    expect(parseSpokenRating('1')).toBe(1);
    expect(parseSpokenRating('seven point one')).toBe(7.1);
  });

  test('rounds to two decimal places', () => {
    expect(parseSpokenRating('7.129')).toBe(7.13);
  });
});
