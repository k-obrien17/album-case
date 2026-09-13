/**
 * One-time backfill: fetch MusicBrainz genre tags for every album in the
 * static seed pool (public/seed/albums.json), which loads on every page load
 * as the live candidate source (see src/seed.ts, main.ts) -- not just an
 * inert bootstrap, so it needs genres too.
 *
 * Rewrites the file in place for review/commit -- this only ever touches a
 * git-tracked source file (never production data), so `git diff` is the
 * safety net, same reasoning as resolve-curated-list-mbids.mjs.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/backfill-genres-seed.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchGenresForMbid, delay, MB_DELAY_MS } from './lib/musicbrainz.mjs';

const WRITE = process.argv.includes('--write');
const SEED_PATH = 'public/seed/albums.json';

const albums = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
const missing = albums.filter((a) => !a.genres?.length);

console.log(`${albums.length} seed album(s), ${missing.length} missing genres.`);

if (!WRITE) {
  console.log('Dry run complete. Nothing fetched or written. Re-run with --write to apply.');
  process.exit(0);
}

let updated = 0;
let empty = 0;
let failed = 0;

for (let i = 0; i < missing.length; i++) {
  const album = missing[i];
  process.stdout.write(`\r${i + 1}/${missing.length} (${updated} updated, ${empty} no genres, ${failed} failed)...`);

  try {
    const genres = await fetchGenresForMbid(album.mbid);
    if (genres.length) {
      album.genres = genres;
      updated++;
    } else {
      empty++;
    }
  } catch (err) {
    failed++;
    console.error(`\nFailed ${album.primary_artist_name} -- ${album.title} (${album.mbid}): ${err}`);
  }
  await delay(MB_DELAY_MS);
}
console.log();

writeFileSync(SEED_PATH, `${JSON.stringify(albums, null, 2)}\n`);
console.log(`Wrote ${SEED_PATH}. Updated: ${updated} | No genre tags upstream: ${empty} | Failed: ${failed}`);
console.log('Review with `git diff web/public/seed/albums.json` before committing.');
