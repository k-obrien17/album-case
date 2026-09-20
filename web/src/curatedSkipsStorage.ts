const CURATED_SKIPS_KEY = 'tastetest-curated-skips';

// Mirrors artistLocksStorage.ts/artistBlocks.ts: localStorage may be
// unavailable (private browsing, quota, non-browser test env) or throw. Keep
// the loop working in-memory rather than crashing; only a real reload loses
// state in that case.
let memoryCuratedSkips: string[] = [];

/** Load the curated-entry skip keys, or an empty array if nothing is stored
 *  yet or storage is unreadable. */
export function loadCuratedSkips(): string[] {
  if (typeof localStorage === 'undefined') return memoryCuratedSkips;

  try {
    const raw = localStorage.getItem(CURATED_SKIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch (err) {
    console.warn('tastetest: failed to read curated skips from localStorage, using in-memory skips', err);
    return memoryCuratedSkips;
  }
}

/** Persist the curated-entry skip keys under `tastetest-curated-skips`. */
export function saveCuratedSkips(skips: string[]): void {
  memoryCuratedSkips = skips;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(CURATED_SKIPS_KEY, JSON.stringify(skips));
  } catch (err) {
    console.warn('tastetest: failed to persist curated skips to localStorage, continuing in-memory', err);
  }
}
