import type { RankedAlbum } from './ranking/types';

/** Newest-rated first. Albums with no `rated_at` (ranked before dates were
 *  recorded) are excluded: they have no date to sort or show. */
export function recentlyRanked(ranked: RankedAlbum[], limit = 25): RankedAlbum[] {
  return ranked
    .filter((a) => typeof a.rated_at === 'number')
    .sort((a, b) => (b.rated_at as number) - (a.rated_at as number))
    .slice(0, limit);
}

export function formatRatedDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
