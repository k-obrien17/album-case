/**
 * The one branching decision in the voice speed round loop, extracted from
 * the DOM/recording glue so it's directly unit-testable (see
 * ~/.claude/references/voice-speed-round-pattern.md, point 8).
 *
 * Deliberately does NOT treat an empty transcript as "nothing to add and
 * safe to skip" the way the source pattern's pickAction does -- there, a
 * blank recording is a valid outcome for an optional note. Here, every
 * candidate album needs a rating to leave the queue, so silence and
 * unparseable speech both fall back to the same manual-entry step rather
 * than auto-advancing without a rating.
 */

import { parseSpokenRating } from './parseSpokenRating';

export type SpeedRoundStep =
  | { kind: 'auto-rate'; rating: number }
  | { kind: 'needs-manual'; heardText: string };

export function decideSpeedRoundStep(transcript: string): SpeedRoundStep {
  const rating = parseSpokenRating(transcript);
  if (rating !== null) return { kind: 'auto-rate', rating };
  return { kind: 'needs-manual', heardText: transcript.trim() };
}
