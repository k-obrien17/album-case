/**
 * Pure logic for the album-canon import script (web/scripts/import-album-canon.mjs).
 * No network, no filesystem, no Turso -- kept separate so it's directly testable.
 */

/** Minimal CSV parser for this file's fixed shape: Ranking,Album,Artist,Year,Rating.
 *  Handles double-quoted fields containing commas (RFC 4180 subset -- no escaped
 *  quotes inside quoted fields, since this specific source file doesn't have any). */
export function parseCanonCsv(csvText) {
  const lines = csvText.split('\n').filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines; // skip header
  return dataLines.map((line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    const [ranking, album, artist, year, rating] = fields;
    return {
      ranking: Number(ranking),
      album,
      artist,
      year: Number(year),
      rating: Number(rating),
    };
  });
}

// Matches web/api/_lp.ts's isLpReleaseGroup. Duplicated, not imported: this is
// a plain Node ESM script with no TS loader, so it can't import a .ts file.
export function isLpReleaseGroup(group) {
  return group['primary-type'] === 'Album' && (group['secondary-types']?.length ?? 0) === 0;
}

/** Confident match = exactly one candidate at MusicBrainz score >= 90.
 *  Matches the confidence rule from the (unbuilt) bulk-list-import spec. */
export function isConfidentMatch(candidates) {
  return candidates.length === 1 && candidates[0].score >= 90;
}
