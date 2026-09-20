/**
 * Parse a transcribed voice utterance into a 0-10 rating, two decimal
 * places, matching the same range/precision as the typed rating inputs
 * (artistBatchView.ts, rankList.ts).
 *
 * Tries digit form first ("7.35", "an 8", "give it a 9") since Parakeet
 * (like most modern STT) usually renders spoken numbers as digits already.
 * Falls back to a bounded word-number parser for the cases it doesn't:
 * "seven point three five", "seven and a half", "nine out of ten".
 *
 * Returns null when nothing in [0, 10] can be recovered from the text --
 * the caller's job is to leave the rating input for a human to fill in,
 * never to guess.
 */

const WORD_DIGITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Longest phrase first: "three quarters" must be checked before "quarter"
// or the substring match on "quarter" alone would fire first and misread
// "six and three quarters" as 6.25 instead of 6.75.
const FRACTION_WORDS: [phrase: string, value: number][] = [
  ['three quarters', 0.75],
  ['quarter', 0.25],
  ['half', 0.5],
];

// Number words safe to treat as a bare, standalone rating when nothing else
// matched. "one" is deliberately excluded: it collides constantly with
// ordinary speech about albums ("skip this one", "rate this one now") and a
// false-positive rating of 1 is worse than asking the person to type it. It
// still works fine in more specific contexts ("point one" -> .1, digit form
// "1") via WORD_DIGITS directly.
const BARE_WORD_DIGITS = Object.fromEntries(
  Object.entries(WORD_DIGITS).filter(([word]) => word !== 'one')
);

function clamp(n: number): number | null {
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 100) / 100;
}

function tryDigitForm(text: string): number | null {
  const matches = text.match(/-?\d+(\.\d+)?/g);
  if (!matches) return null;
  return clamp(Number(matches[matches.length - 1]));
}

function tryWordForm(text: string): number | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // "X and a half/quarter/three quarters" -- fraction word(s) anywhere
  // after "and", added to the last whole number found before it.
  const andIdx = words.indexOf('and');
  if (andIdx !== -1) {
    const wholeWord = [...words.slice(0, andIdx)].reverse().find((w) => w in WORD_DIGITS);
    const rest = words.slice(andIdx + 1).join(' ');
    if (wholeWord !== undefined) {
      for (const [phrase, value] of FRACTION_WORDS) {
        if (rest.includes(phrase)) return clamp(WORD_DIGITS[wholeWord] + value);
      }
    }
  }

  // "X point Y [Z]" -- decimal built from word-digits after "point". Only
  // the CONTIGUOUS run right after "point" counts: stop at the first word
  // that isn't a single digit (0-9), so a later, unrelated number elsewhere
  // in the sentence (e.g. an aside) never gets appended onto the decimal.
  const pointIdx = words.indexOf('point');
  if (pointIdx !== -1 && pointIdx > 0) {
    const whole = words[pointIdx - 1];
    const decimalDigits: number[] = [];
    for (const w of words.slice(pointIdx + 1)) {
      const d = WORD_DIGITS[w];
      if (d === undefined || d > 9) break;
      decimalDigits.push(d);
    }
    if (whole in WORD_DIGITS && decimalDigits.length > 0) {
      const decimalStr = decimalDigits.join('');
      return clamp(WORD_DIGITS[whole] + Number(`0.${decimalStr}`));
    }
  }

  // Plain whole number word, last one wins ("give it a nine" -> 9). Uses
  // BARE_WORD_DIGITS (excludes "one") -- see its comment above.
  const wholeWords = words.filter((w) => w in BARE_WORD_DIGITS);
  if (wholeWords.length > 0) {
    return clamp(BARE_WORD_DIGITS[wholeWords[wholeWords.length - 1]]);
  }

  return null;
}

export function parseSpokenRating(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return tryDigitForm(trimmed) ?? tryWordForm(trimmed);
}
